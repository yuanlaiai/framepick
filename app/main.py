"""FastAPI 应用：REST API + 静态前端。"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import asr, config, platforms, textproc
from .tasks import TaskManager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("framepick")

APP_VERSION = "1.0.0"
ALLOWED_UPLOAD_EXT = {
    ".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".flv", ".wmv", ".mpg", ".mpeg", ".3gp", ".ts",
    ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".amr", ".aiff", ".aif",
}

manager = TaskManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.ensure_dirs()
    manager.start()
    log.info("帧采 FramePick 已启动 · ffmpeg=%s · 模型目录=%s", config.FFMPEG or "缺失", config.MODELS_DIR)
    yield


app = FastAPI(title="帧采 FramePick", version=APP_VERSION, lifespan=lifespan)


class CreateTaskRequest(BaseModel):
    url: str
    model: str = "standard"
    language: str = "auto"
    prefer_subtitles: bool = True
    download_media: bool = True
    quality: str = "720"


class CookiesRequest(BaseModel):
    text: str


def _validate_options(model: str, language: str, prefer_subtitles: bool, download_media: bool = True, quality: str = "720") -> dict:
    if model not in config.MODEL_CHOICES:
        raise HTTPException(400, detail={"message": "不支持的模型档位", "hint": f"可选：{', '.join(config.MODEL_CHOICES)}"})
    if language not in config.LANGUAGES:
        raise HTTPException(400, detail={"message": "不支持的语言", "hint": f"可选：{', '.join(config.LANGUAGES)}"})
    if quality not in config.QUALITY_CHOICES:
        raise HTTPException(400, detail={"message": "不支持的清晰度", "hint": f"可选：{', '.join(config.QUALITY_CHOICES)}"})
    return {
        "model": model,
        "language": language,
        "prefer_subtitles": bool(prefer_subtitles),
        "download_media": bool(download_media),
        "quality": quality,
    }


def _api_health() -> dict:
    return {
        "ok": True,
        "version": APP_VERSION,
        "device": asr.device_info(),
        "ffmpeg": bool(config.FFMPEG),
    }


@app.get("/api/health")
def health() -> dict:
    return _api_health()


@app.get("/api/settings")
def get_settings() -> dict:
    return {
        "has_cookies": manager.has_cookies(),
        "cookies_updated_at": manager.cookies_updated_at(),
        "models": [
            {"key": key, "label": value["label"], "hint": value["hint"]}
            for key, value in config.MODEL_CHOICES.items()
        ],
        "languages": [{"key": key, "label": label} for key, label in config.LANGUAGES.items()],
        "qualities": [{"key": key, "label": label} for key, label in config.QUALITY_CHOICES.items()],
        "defaults": {"model": "standard", "language": "auto", "prefer_subtitles": True},
        "max_upload_mb": config.MAX_UPLOAD_BYTES // (1024 * 1024),
        "device": asr.device_info(),
        "version": APP_VERSION,
        "ffmpeg": bool(config.FFMPEG),
    }


@app.post("/api/settings/cookies")
def save_cookies(payload: CookiesRequest) -> dict:
    try:
        lines = manager.save_cookies(payload.text)
    except ValueError as exc:
        raise HTTPException(400, detail={"message": "cookies 格式无法识别", "hint": str(exc)}) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail={"message": "cookies 保存失败", "hint": str(exc)[:200]}) from exc
    return {"ok": True, "lines": lines}


@app.delete("/api/settings/cookies")
def clear_cookies() -> dict:
    manager.clear_cookies()
    return {"ok": True}


@app.post("/api/tasks")
def create_task(payload: CreateTaskRequest) -> dict:
    url = platforms.extract_url(payload.url)
    if not url:
        raise HTTPException(
            400,
            detail={"message": "没有找到视频链接", "hint": "可以直接粘贴抖音/B站的分享文案，会自动识别其中的链接。"},
        )
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(400, detail={"message": "链接格式不对", "hint": "仅支持 http/https 链接。"})
    options = _validate_options(
        payload.model, payload.language, payload.prefer_subtitles, payload.download_media, payload.quality
    )
    task = manager.create_url(url, options)
    return {"ok": True, "id": task.id, "task": task.summary()}


@app.post("/api/tasks/upload")
async def upload_task(
    file: UploadFile = File(...),
    model: str = Form("standard"),
    language: str = Form("auto"),
    prefer_subtitles: str = Form("true"),
) -> dict:
    options = _validate_options(model, language, prefer_subtitles.lower() in ("1", "true", "on", "yes"), True, "720")
    name = Path(file.filename or "upload").name
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_UPLOAD_EXT:
        raise HTTPException(
            400,
            detail={
                "message": f"不支持的文件类型：{suffix or '未知'}",
                "hint": "支持 mp4 / mov / mkv / webm / mp3 / m4a / wav / flac 等常见音视频格式。",
            },
        )
    config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    dest = config.UPLOADS_DIR / f"{uuid.uuid4().hex}{suffix}"
    # 流式写盘并累计大小，避免把大文件整个读进内存，也防止超出上限
    total = 0
    try:
        with dest.open("wb") as fh:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        413,
                        detail={
                            "message": "文件太大",
                            "hint": f"最大支持 {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB，可先压缩或截取片段。",
                        },
                    )
                fh.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        raise HTTPException(500, detail={"message": "文件上传失败", "hint": str(exc)[:200]}) from exc
    if total == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, detail={"message": "文件是空的", "hint": "请重新选择文件。"})
    task = manager.create_file(dest, name, options)
    return {"ok": True, "id": task.id, "task": task.summary()}


@app.get("/api/tasks")
def list_tasks(limit: int = 12) -> dict:
    limit = max(1, min(50, limit))
    return {"tasks": manager.recent(limit)}


@app.get("/api/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    task = manager.get(task_id)
    if not task:
        raise HTTPException(404, detail={"message": "任务不存在", "hint": "可能已被删除，请重新提取。"})
    return task.public()


@app.post("/api/tasks/{task_id}/cancel")
def cancel_task(task_id: str) -> dict:
    task = manager.cancel(task_id)
    if not task:
        raise HTTPException(404, detail={"message": "任务不存在", "hint": ""})
    return {"ok": True, "status": task.status}


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: str) -> dict:
    if not manager.delete(task_id):
        raise HTTPException(404, detail={"message": "任务不存在", "hint": ""})
    return {"ok": True}


@app.get("/api/thumb/{name}")
def get_thumb(name: str) -> FileResponse:
    if "/" in name or "\\" in name or not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        raise HTTPException(404, detail={"message": "封面不存在", "hint": ""})
    path = config.THUMBS_DIR / name
    if not path.is_file():
        raise HTTPException(404, detail={"message": "封面不存在", "hint": ""})
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


def _safe_filename(name: str) -> str:
    name = (name or "文案").strip()
    name = "".join(ch for ch in name if ch.isprintable())
    for ch in '\\/:*?"<>|\n\r\t':
        name = name.replace(ch, " ")
    name = " ".join(name.split())
    return (name[:60] or "文案").strip()


@app.get("/api/tasks/{task_id}/file")
def download_file(task_id: str, format: str = "txt") -> Response:
    task = manager.get(task_id)
    if not task or task.status != "done" or not task.result:
        raise HTTPException(409, detail={"message": "任务还没有完成", "hint": "请等待提取完成后再下载。"})
    result = task.result
    fmt = format.lower().strip()
    if fmt == "txt":
        content = textproc.to_txt(result["paragraphs"])
        ext, media = "txt", "text/plain; charset=utf-8"
    elif fmt == "timeline":
        content = textproc.to_txt(result["paragraphs"], with_time=True)
        ext, media = "txt", "text/plain; charset=utf-8"
    elif fmt == "srt":
        content = textproc.to_srt(result["segments"])
        ext, media = "srt", "application/x-subrip; charset=utf-8"
    elif fmt == "md":
        content = textproc.to_markdown(result)
        ext, media = "md", "text/markdown; charset=utf-8"
    elif fmt == "json":
        content = json.dumps(result, ensure_ascii=False, indent=2)
        ext, media = "json", "application/json; charset=utf-8"
    else:
        raise HTTPException(400, detail={"message": "不支持的导出格式", "hint": "可选：txt / timeline / srt / md / json"})
    filename = f"{_safe_filename(result['source'].get('title') or '文案')}.{ext}"
    headers = {
        "Content-Disposition": f"attachment; filename=\"transcript.{ext}\"; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "no-store",
    }
    return Response(content=content, media_type=media, headers=headers)




def _get_done_result(task_id: str) -> tuple:
    task = manager.get(task_id)
    if not task or task.status != "done" or not task.result:
        raise HTTPException(409, detail={"message": "任务还没有完成", "hint": "请等待提取完成后再下载。"})
    return task, task.result


def _resolve_asset(task, kind: str) -> tuple[Path, dict]:
    assets = (task.result or {}).get("assets") or {}
    asset = assets.get(kind)
    if not asset:
        raise HTTPException(404, detail={"message": "这个任务没有该素材", "hint": ""})
    path = config.ASSETS_DIR / task.id / f"{kind}.{asset['ext']}"
    if not path.is_file():
        raise HTTPException(404, detail={"message": "素材文件已丢失", "hint": "请重新提取一次。"})
    return path, asset


def _content_disposition(disposition: str, filename: str) -> str:
    ascii_fallback = "".join(ch if ord(ch) < 128 else "_" for ch in filename)
    return f"{disposition}; filename=\"{ascii_fallback}\"; filename*=UTF-8''{quote(filename)}"


@app.get("/api/tasks/{task_id}/asset/{kind}")
def download_asset(task_id: str, kind: str, download: bool = False) -> FileResponse:
    """素材下载。

    不加 download 时返回 inline，供 <video>/<audio> 直接播放（支持 Range）；
    加 ?download=1 才用 attachment，避免点击卡片时浏览器直接打开播放器。
    """
    task, _result = _get_done_result(task_id)
    if kind not in ("video", "audio", "cover"):
        raise HTTPException(404, detail={"message": "未知素材类型", "hint": "可选：video / audio / cover"})
    path, asset = _resolve_asset(task, kind)
    disposition = "attachment" if download else "inline"
    headers = {
        "Content-Disposition": _content_disposition(disposition, asset["filename"]),
        "Cache-Control": "public, max-age=3600",
        "Accept-Ranges": "bytes",
    }
    return FileResponse(path, media_type=asset["mime"], headers=headers)


@app.get("/api/tasks/{task_id}/package")
def download_package(task_id: str) -> FileResponse:
    """打包：视频 + 音频 + 封面 + 文案 + SRT + 信息表，一次性下载。"""
    task, result = _get_done_result(task_id)
    assets = result.get("assets") or {}
    base = _safe_filename(result["source"].get("title") or "视频素材")
    tmpdir = tempfile.mkdtemp(prefix="framepick-pkg-")
    zip_path = Path(tmpdir) / f"{base}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for kind in ("video", "audio", "cover"):
            if kind not in assets:
                continue
            try:
                path, asset = _resolve_asset(task, kind)
            except HTTPException:
                continue
            zf.write(path, arcname=f"{base}/{base}.{asset['ext']}")
        zf.writestr(f"{base}/{base}-文案.txt", textproc.to_txt(result.get("paragraphs") or []))
        zf.writestr(f"{base}/{base}-字幕.srt", textproc.to_srt(result.get("segments") or []))
        meta = {
            "title": result["source"].get("title"),
            "url": result["source"].get("url"),
            "platform": result["source"].get("platform_label"),
            "uploader": result["source"].get("uploader"),
            "duration": result["source"].get("duration"),
            "upload_date": result["source"].get("upload_date"),
            "description": result["source"].get("description"),
            "tags": result["source"].get("tags"),
            "stats": result.get("stats"),
            "engine": result.get("engine"),
            "assets": assets,
        }
        zf.writestr(f"{base}/{base}-信息.json", json.dumps(meta, ensure_ascii=False, indent=2))
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"{base}.zip",
        headers={"Content-Disposition": _content_disposition("attachment", f"{base}.zip")},
        background=BackgroundTask(shutil.rmtree, tmpdir, True),
    )

config.STATIC_DIR.mkdir(parents=True, exist_ok=True)
if not (config.STATIC_DIR / "index.html").exists():
    log.warning("前端尚未构建：请执行 cd web && npm install && npm run build")
app.mount("/", StaticFiles(directory=str(config.STATIC_DIR), html=True), name="web")
