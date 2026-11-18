"""提取流水线：链接解析 → 视频/音频/封面下载 → 语音识别 → 文案整理。"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Callable

import yt_dlp

from . import asr, config, platforms, scrapers, subtitles, textproc
from .errors import Cancelled, FriendlyError

Emit = Callable[[int, str, str], None]

log = logging.getLogger("framepick.pipeline")

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov", ".flv", ".avi", ".m4v", ".ts"}
MIME_BY_EXT = {
    "mp4": "video/mp4",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "wav": "audio/wav",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


class _QuietLogger:
    def debug(self, msg: str) -> None:  # noqa: D102
        pass

    def info(self, msg: str) -> None:  # noqa: D102
        pass

    def warning(self, msg: str) -> None:  # noqa: D102
        pass

    def error(self, msg: str) -> None:  # noqa: D102
        pass


def _cookies_file() -> str | None:
    path = config.COOKIES_FILE
    if path.exists() and path.stat().st_size > 0:
        return str(path)
    return None


def _proxy() -> str | None:
    for key in ("ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return None


def _common_opts() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _QuietLogger(),
        "socket_timeout": 25,
        "retries": 3,
        "noplaylist": True,
        "extract_flat": False,
    }


def _with_optional_opts(opts: dict) -> dict:
    cookies = _cookies_file()
    if cookies:
        opts["cookiefile"] = cookies
    return opts


def _ydl_info(url: str, opts: dict) -> dict:
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


def fetch_info(url: str, retry_with_proxy: bool = True) -> dict:
    platform_key, _label = platforms.detect_platform(url)
    if platform_key == "douyin":
        # yt-dlp 的抖音提取器强依赖 cookies；直接用本机浏览器解析分享页
        return scrapers.douyin_info(url)

    opts = _with_optional_opts(_common_opts())
    first_error: Exception | None = None
    try:
        info = _ydl_info(url, opts)
    except Exception as exc:  # noqa: BLE001
        first_error = exc
        if platform_key == "xiaohongshu":
            try:
                return scrapers.xiaohongshu_info(url)
            except Exception as scrape_exc:  # noqa: BLE001
                log.info("xhs scrape failed: %s", scrape_exc)
        proxy = _proxy() if retry_with_proxy else None
        if proxy:
            retry = dict(opts)
            retry["proxy"] = proxy
            try:
                info = _ydl_info(url, retry)
            except Exception:
                raise first_error
        else:
            raise first_error

    if not info:
        raise FriendlyError("没有解析到视频信息", "请确认链接可以直接打开。")
    if info.get("_type") == "playlist" or info.get("entries"):
        entries = [e for e in (info.get("entries") or []) if e]
        if not entries:
            raise FriendlyError("链接里没有找到视频", "如果是合集链接，请粘贴单个视频的链接。")
        info = entries[0]
    return info


def _pick_source(info: dict, url: str, platform_key: str, platform_label: str) -> dict:
    """把 yt-dlp / 自研解析器的 info 归一化成前端需要的 source 结构。"""
    label = info.get("platform_label") or platform_label
    platform_key = info.get("platform") or platform_key
    ext_label = platforms.EXTRACTOR_LABELS.get(info.get("extractor_key", ""))
    if label == "通用链接" and ext_label:
        label = ext_label
    upload_date = info.get("upload_date") or ""
    if len(upload_date) == 8:
        upload_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    thumb = info.get("thumbnail")
    if not thumb:
        thumbs = info.get("thumbnails") or []
        if thumbs:
            thumb = thumbs[-1].get("url")
    tags = [str(tag).strip() for tag in (info.get("tags") or []) if str(tag).strip()]
    description = (info.get("description") or "").strip()
    if description in {"-", "—", "–", "无", "暂无", "暂无简介", "暂无描述", "."}:
        description = ""
    return {
        "url": info.get("webpage_url") or url,
        "title": (info.get("title") or "未命名视频").strip(),
        "uploader": info.get("uploader") or info.get("channel") or info.get("creator") or "",
        "thumbnail": thumb or "",
        "duration": float(info.get("duration") or info.get("duration_float") or 0),
        "platform": platform_key,
        "platform_label": label,
        "upload_date": upload_date,
        "view_count": info.get("view_count"),
        "like_count": info.get("like_count"),
        "comment_count": info.get("comment_count"),
        "repost_count": info.get("repost_count"),
        "description": description,
        "tags": tags[:20],
    }


def _trim_segments(segments: list[dict], duration: float) -> list[dict]:
    out = []
    for seg in segments:
        if duration and seg["start"] > duration + 3:
            continue
        if seg["end"] > seg["start"] + 0.2:
            out.append(seg)
    return out


# --------------------------------------------------------------------------
# 下载
# --------------------------------------------------------------------------


def _download_with_retry(opts: dict, url: str, *, stage: str, emit: Emit, cancel_check: Callable[[], bool]) -> None:
    """直连失败时依次尝试系统代理、再重试直连；用户取消立即抛出 Cancelled。"""
    def attempt(extra: dict) -> None:
        merged = dict(opts)
        merged.update(extra)
        with yt_dlp.YoutubeDL(merged) as ydl:
            ydl.download([url])

    try:
        attempt({})
        return
    except Cancelled:
        raise
    except Exception as first_error:  # noqa: BLE001
        if cancel_check():
            raise Cancelled() from first_error
        proxy = _proxy()
        if proxy:
            emit(1, stage, "直连失败，正在尝试代理…")
            try:
                attempt({"proxy": proxy})
                return
            except Cancelled:
                raise
            except Exception:
                log.warning("proxy attempt failed for %s", url)
        if cancel_check():
            raise Cancelled()
        emit(1, stage, "下载中断，正在重试…")
        try:
            attempt({})
        except Cancelled:
            raise
        except Exception:
            raise first_error


def _download_direct(
    url: str,
    dest: Path,
    headers: dict,
    *,
    emit: Emit,
    cancel_check: Callable[[], bool],
) -> Path:
    """下载解析器给出的直链（抖音/小红书）。直链有时效，必须拿到后立即使用。"""
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if "text/html" in content_type:
                raise FriendlyError("下载地址已失效", "平台返回了网页而不是视频，请重新复制分享链接。")
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            with dest.open("wb") as fh:
                while True:
                    if cancel_check():
                        raise Cancelled()
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    fh.write(chunk)
                    done += len(chunk)
                    if total:
                        emit(
                            10 + int(min(0.999, done / total) * 36),
                            "下载视频",
                            f"已下载 {done / 1048576:.1f} / {total / 1048576:.1f} MB",
                        )
    except FriendlyError:
        dest.unlink(missing_ok=True)
        raise
    except Cancelled:
        dest.unlink(missing_ok=True)
        raise
    except Exception as exc:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        raise FriendlyError("视频下载失败", f"直链下载失败：{str(exc)[:160]}") from exc
    if not dest.exists() or dest.stat().st_size < 1024:
        raise FriendlyError("视频下载失败", "下载到的文件为空，请重试。")
    return dest


def _find_media(directory: Path, stem: str) -> Path | None:
    files = sorted(
        [p for p in directory.glob(f"{stem}.*") if p.suffix not in (".part", ".ytdl")],
        key=lambda p: p.stat().st_size,
        reverse=True,
    )
    return files[0] if files else None


def _download_video(
    directory: Path,
    url: str,
    quality: str,
    *,
    emit: Emit,
    cancel_check: Callable[[], bool],
) -> Path:
    height = {"720": 720, "1080": 1080}.get(quality, 0)
    # 优先 H.264：浏览器（尤其 Safari）对 AV1 支持不完整，而用户需要在页面内直接播放。
    # 后面的 / 表示逐级回退，保证总有一个可用格式。
    if height:
        fmt = (
            f"bv*[height<={height}][vcodec^=avc1]+ba[ext=m4a]/"
            f"bv*[height<={height}][vcodec^=avc1]+ba/"
            f"bv*[height<={height}]+ba/b[height<={height}]/bv*+ba/b"
        )
    else:
        fmt = "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b"

    def hook(d: dict) -> None:
        if cancel_check():
            raise Cancelled()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if not total:
                return
            is_audio = ((d.get("info_dict") or {}).get("vcodec") == "none")
            if is_audio:
                emit(44 + int(min(0.999, done / total) * 4), "下载音频", f"音轨 {done / 1048576:.1f} / {total / 1048576:.1f} MB")
            else:
                emit(10 + int(min(0.999, done / total) * 34), "下载视频", f"已下载 {done / 1048576:.1f} / {total / 1048576:.1f} MB")

    opts = _with_optional_opts(_common_opts())
    opts.update(
        {
            "format": fmt,
            "merge_output_format": "mp4",
            "outtmpl": str(directory / "video.%(ext)s"),
            "progress_hooks": [hook],
            "overwrites": True,
            "noprogress": True,
        }
    )
    _download_with_retry(opts, url, stage="下载视频", emit=emit, cancel_check=cancel_check)
    path = _find_media(directory, "video")
    if not path:
        raise FriendlyError("视频下载失败", "该平台可能限制了视频下载，可尝试切换清晰度或导入 cookies。")
    return path


def _download_audio_only(
    directory: Path,
    url: str,
    *,
    emit: Emit,
    cancel_check: Callable[[], bool],
) -> Path:
    def hook(d: dict) -> None:
        if cancel_check():
            raise Cancelled()
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                emit(
                    10 + int(min(0.999, done / total) * 38),
                    "下载音频",
                    f"已下载 {done / 1048576:.1f} / {total / 1048576:.1f} MB",
                )

    opts = _with_optional_opts(_common_opts())
    opts.update(
        {
            "format": "bestaudio/best",
            "outtmpl": str(directory / "sourceaudio.%(ext)s"),
            "progress_hooks": [hook],
            "overwrites": True,
            "noprogress": True,
        }
    )
    _download_with_retry(opts, url, stage="下载音频", emit=emit, cancel_check=cancel_check)
    path = _find_media(directory, "sourceaudio")
    if not path:
        raise FriendlyError("音频下载失败", "该平台可能需要登录，可在设置中导入 cookies 后重试。")
    return path


# --------------------------------------------------------------------------
# 媒体处理
# --------------------------------------------------------------------------


def _ffmpeg_run(args: list[str], what: str) -> None:
    if not config.FFMPEG:
        raise FriendlyError(f"缺少 ffmpeg，无法{what}", "请先安装 ffmpeg：brew install ffmpeg")
    proc = subprocess.run(
        [config.FFMPEG, "-nostdin", "-loglevel", "error", "-y", *args],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()[-1:] or ["未知错误"]
        raise FriendlyError(f"{what}失败", detail[0][:200])


def extract_audio(video: Path, out: Path) -> Path:
    _ffmpeg_run(["-i", str(video), "-vn", "-c:a", "libmp3lame", "-q:a", "2", str(out)], "提取音频")
    if not out.exists() or out.stat().st_size == 0:
        raise FriendlyError("提取音频失败", "视频里可能没有音频轨。")
    return out


def extract_frame(video: Path, out: Path, seconds: float = 1.0) -> Path | None:
    try:
        _ffmpeg_run(
            ["-ss", f"{max(0.0, seconds):.2f}", "-i", str(video), "-frames:v", "1", "-q:v", "2", str(out)],
            "截取封面",
        )
    except FriendlyError:
        return None
    return out if out.exists() and out.stat().st_size > 0 else None


def _probe_video_size(path: Path) -> tuple[int, int]:
    if not config.FFPROBE:
        return 0, 0
    try:
        proc = subprocess.run(
            [
                config.FFPROBE, "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "json", str(path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        stream = (json.loads(proc.stdout or "{}").get("streams") or [{}])[0]
        return int(stream.get("width") or 0), int(stream.get("height") or 0)
    except Exception:
        return 0, 0


def _download_thumbnail(url: str, referer: str, directory: Path) -> Path | None:
    if not url:
        return None
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "Referer": referer or "https://www.bilibili.com/",
                "Accept": "image/avif,image/webp,image/*,*/*;q=0.8",
            },
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = resp.read(6 * 1024 * 1024)
            content_type = (resp.headers.get("Content-Type") or "").lower()
        if len(data) < 200:
            return None
        suffix = ".png" if "png" in content_type else ".webp" if "webp" in content_type else ".jpg"
        path = directory / f"cover{suffix}"
        path.write_bytes(data)
        return path
    except Exception as exc:  # noqa: BLE001
        log.info("thumbnail download failed: %s", exc)
        return None


def _make_cover(directory: Path, thumb_url: str, referer: str, video: Path | None, duration: float) -> Path | None:
    cover = _download_thumbnail(thumb_url, referer, directory)
    if cover:
        return cover
    if video:
        seconds = min(1.0, max(0.0, (duration or 2.0) * 0.1))
        return extract_frame(video, directory / "cover.jpg", seconds)
    return None


def _asset(path: Path, kind: str, title: str) -> dict:
    """登记一个素材文件：扩展名、大小、MIME、下载文件名、视频分辨率。"""
    ext = path.suffix.lstrip(".").lower()
    size = path.stat().st_size
    info = {
        "kind": kind,
        "ext": ext,
        "size": size,
        "mime": MIME_BY_EXT.get(ext, "application/octet-stream"),
        "filename": f"{title}.{ext}",
    }
    if kind == "video":
        width, height = _probe_video_size(path)
        if width and height:
            info["width"] = width
            info["height"] = height
    return info


def _safe_title(name: str) -> str:
    name = (name or "").strip()
    for ch in '\\/:*?"<>|\n\r\t':
        name = name.replace(ch, " ")
    name = " ".join(name.split())
    return name[:80] or "视频"


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------


def run_url(
    *,
    task_id: str,
    url: str,
    options: dict,
    task_dir: Path,
    emit: Emit,
    cancel_check: Callable[[], bool],
) -> dict:
    started = time.time()
    platform_key, platform_label = platforms.detect_platform(url)
    assets_dir = config.ASSETS_DIR / task_id
    assets_dir.mkdir(parents=True, exist_ok=True)

    emit(2, "解析链接", "正在解析视频信息…")
    info = fetch_info(url)
    source = _pick_source(info, url, platform_key, platform_label)
    title = _safe_title(source["title"])
    duration = source["duration"]
    emit(6, "解析链接", f"《{source['title']}》")

    segments: list[dict] | None = None
    engine = ""
    language = ""

    # 字幕路径最便宜：拿到就不需要 Whisper。失败则静默回退到音频转写。
    if options.get("prefer_subtitles", True):
        entry = subtitles.pick_subtitle(info)
        if entry:
            emit(8, "获取字幕", "发现平台字幕，正在下载…")
            try:
                cues = subtitles.fetch_subtitle(
                    entry["url"],
                    prefer_proxy=platform_key in ("youtube", "tiktok", "instagram", "twitter", "vimeo"),
                )
                cues = _trim_segments(cues, duration)
                if cues and (not duration or cues[-1]["end"] >= duration * 0.4):
                    segments = cues
                    engine = "platform-subtitles"
                    language = (entry.get("name") or entry.get("lang") or "")[:12]
                    emit(9, "获取字幕", f"已使用平台字幕，共 {len(cues)} 句")
            except Exception as exc:  # noqa: BLE001
                log.info("subtitle fetch failed, fallback to ASR: %s", exc)

    assets: dict[str, dict] = {}
    video_path: Path | None = None
    audio_path: Path | None = None
    audio_source: Path | None = None
    download_media = bool(options.get("download_media", True))
    quality = options.get("quality", "720")
    direct_url = info.get("_direct_url") or ""

    # 抖音/小红书走直链；B站/YouTube 交给 yt-dlp 合并音视频
    if direct_url:
        emit(10, "下载视频", "正在下载视频…")
        video_path = _download_direct(
            direct_url,
            assets_dir / "video.mp4",
            info.get("_headers") or {},
            emit=emit,
            cancel_check=cancel_check,
        )
        if not duration:
            duration = asr.probe_duration(video_path)
            if duration:
                source["duration"] = round(duration, 1)
        if download_media:
            assets["video"] = _asset(video_path, "video", title)
        emit(48, "提取音频", "正在从视频中提取音频…")
        try:
            audio_path = extract_audio(video_path, assets_dir / "audio.mp3")
            assets["audio"] = _asset(audio_path, "audio", title)
        except FriendlyError as exc:
            log.warning("audio extraction failed: %s", exc)
            audio_path = None
    elif download_media:
        emit(10, "下载视频", "正在下载视频…")
        video_path = _download_video(assets_dir, url, quality, emit=emit, cancel_check=cancel_check)
        if not duration:
            duration = asr.probe_duration(video_path)
            if duration:
                source["duration"] = round(duration, 1)
        assets["video"] = _asset(video_path, "video", title)
        emit(48, "提取音频", "正在从视频中提取音频…")
        try:
            audio_path = extract_audio(video_path, assets_dir / "audio.mp3")
            assets["audio"] = _asset(audio_path, "audio", title)
        except FriendlyError as exc:
            log.warning("audio extraction failed: %s", exc)
            audio_path = None
    else:
        emit(10, "下载音频", "正在下载音频…")
        downloaded = _download_audio_only(assets_dir, url, emit=emit, cancel_check=cancel_check)
        try:
            audio_path = extract_audio(downloaded, assets_dir / "audio.mp3")
            assets["audio"] = _asset(audio_path, "audio", title)
            downloaded.unlink(missing_ok=True)
        except FriendlyError:
            audio_path = downloaded
            assets["audio"] = _asset(audio_path, "audio", title)

    if video_path and video_path.exists():
        emit(51, "生成封面", "正在准备封面…")
    audio_source = audio_path or video_path

    # 封面优先用平台图（需带 Referer），拿不到再从视频第 1 秒截一帧
    cover = _make_cover(
        assets_dir,
        source.get("thumbnail") or "",
        source.get("url") or "",
        video_path,
        duration,
    )
    if cover:
        assets["cover"] = _asset(cover, "cover", title)
        source["thumbnail"] = f"/api/tasks/{task_id}/asset/cover"
    elif not source.get("thumbnail", "").startswith("/api/"):
        source["thumbnail"] = ""

    if direct_url and not download_media and video_path:
        video_path.unlink(missing_ok=True)
        video_path = None

    if segments is None:
        if not audio_source:
            raise FriendlyError("没有可用的音频", "视频下载失败，无法继续转写。")
        emit(56, "处理音频", "正在解码为 16kHz 单声道…")
        audio, audio_duration = asr.decode_media(audio_source, assets_dir / "audio16k.wav")
        if not duration:
            duration = audio_duration
            source["duration"] = round(duration, 1)
        emit(58, "语音识别", f"音频已就绪（{audio_duration:.0f} 秒），开始转写…")

        seen = {"fraction": 0.0}

        def on_progress(fraction: float) -> None:
            seen["fraction"] = max(seen["fraction"], fraction)
            emit(int(58 + seen["fraction"] * 38), "语音识别", f"转写进度 {int(seen['fraction'] * 100)}%")

        segments, meta = asr.transcribe(
            audio,
            model_key=options.get("model", "standard"),
            language=options.get("language", "auto"),
            duration=audio_duration,
            on_progress=on_progress,
            on_log=lambda msg: emit(58, "语音识别", msg),
            cancel_check=cancel_check,
        )
        engine = meta.get("engine", "")
        language = meta.get("language", "")

    segments = textproc.split_long_segments(textproc.dedupe_segments(segments), limit=60)
    if not segments:
        raise FriendlyError(
            "没有识别到人声",
            "这段视频可能没有人声（纯音乐/BGM），或音轨静音。",
        )
    emit(98, "整理文案", "正在分段与排版…")

    _cleanup_temp(assets_dir)
    result = textproc.build_result(
        task_id=task_id,
        kind="url",
        source=source,
        segments=segments,
        engine=engine,
        language=language,
        options=options,
        elapsed=time.time() - started,
    )
    result["source"]["duration"] = round(duration or (segments[-1]["end"] if segments else 0), 1)
    result["assets"] = assets
    return result


def run_file(
    *,
    task_id: str,
    file_path: Path,
    filename: str,
    options: dict,
    task_dir: Path,
    emit: Emit,
    cancel_check: Callable[[], bool],
) -> dict:
    started = time.time()
    assets_dir = config.ASSETS_DIR / task_id
    assets_dir.mkdir(parents=True, exist_ok=True)
    title = _safe_title(Path(filename).stem or filename)
    emit(3, "读取文件", f"正在读取 {filename}…")
    suffix = file_path.suffix.lower()
    is_video = suffix in VIDEO_EXTS
    target = assets_dir / f"source{suffix}"
    try:
        file_path.replace(target)
    except OSError:
        target.write_bytes(file_path.read_bytes())
        file_path.unlink(missing_ok=True)

    duration = asr.probe_duration(target)
    source = {
        "url": "",
        "title": Path(filename).stem or filename,
        "uploader": "",
        "thumbnail": "",
        "duration": duration,
        "platform": "local",
        "platform_label": "本地文件",
        "upload_date": "",
        "view_count": None,
        "like_count": None,
        "comment_count": None,
        "repost_count": None,
        "description": "",
        "tags": [],
    }
    assets: dict[str, dict] = {}

    if is_video:
        assets["video"] = _asset(target, "video", title)
        try:
            audio_path = extract_audio(target, assets_dir / "audio.mp3")
            assets["audio"] = _asset(audio_path, "audio", title)
        except FriendlyError as exc:
            log.warning("audio extraction failed: %s", exc)
        cover = extract_frame(target, assets_dir / "cover.jpg", min(1.0, max(0.0, duration * 0.1)))
        if cover:
            assets["cover"] = _asset(cover, "cover", title)
            source["thumbnail"] = f"/api/tasks/{task_id}/asset/cover"
        audio_source = assets_dir / "audio.mp3" if "audio" in assets else target
    else:
        audio_asset = assets_dir / f"audio{suffix}"
        if audio_asset != target:
            target.replace(audio_asset)
        assets["audio"] = _asset(audio_asset, "audio", title)
        audio_source = audio_asset

    emit(6, "处理音频", "正在解码为 16kHz 单声道…")
    audio, audio_duration = asr.decode_media(audio_source, assets_dir / "audio16k.wav")
    if not duration:
        duration = audio_duration
        source["duration"] = round(duration, 1)
    if cancel_check():
        raise Cancelled()
    emit(10, "语音识别", f"音频已就绪（{audio_duration:.0f} 秒），开始转写…")

    seen = {"fraction": 0.0}

    def on_progress(fraction: float) -> None:
        seen["fraction"] = max(seen["fraction"], fraction)
        emit(int(10 + seen["fraction"] * 86), "语音识别", f"转写进度 {int(seen['fraction'] * 100)}%")

    segments_raw, meta = asr.transcribe(
        audio,
        model_key=options.get("model", "standard"),
        language=options.get("language", "auto"),
        duration=audio_duration,
        on_progress=on_progress,
        on_log=lambda msg: emit(10, "语音识别", msg),
        cancel_check=cancel_check,
    )
    segments = textproc.dedupe_segments(segments_raw)
    if not segments:
        raise FriendlyError("没有识别到人声", "这个文件里没有检测到清晰的语音内容。")
    emit(98, "整理文案", "正在分段与排版…")
    _cleanup_temp(assets_dir)
    result = textproc.build_result(
        task_id=task_id,
        kind="file",
        source=source,
        segments=segments,
        engine=meta.get("engine", ""),
        language=meta.get("language", ""),
        options=options,
        elapsed=time.time() - started,
    )
    result["assets"] = assets
    return result


def _cleanup_temp(assets_dir: Path) -> None:
    """只清理转写用的临时 WAV，保留视频/音频/封面三个可下载素材。"""
    for name in ("audio16k.wav",):
        try:
            (assets_dir / name).unlink(missing_ok=True)
        except OSError:
            pass
    for path in assets_dir.glob("*.part"):
        try:
            path.unlink()
        except OSError:
            pass


def friendly_error(exc: BaseException) -> tuple[str, str]:
    """把底层异常翻译成中文提示。

    yt-dlp / ffmpeg 的报错又长又偏英文，直接展示体验很差，
    这里按常见错误归类，并给出下一步建议（例如导入 cookies）。
    """
    if isinstance(exc, FriendlyError):
        return exc.message, exc.hint
    raw = str(exc).replace("ERROR: ", "").strip()
    low = raw.lower()
    if "sign in to confirm" in low or "not a bot" in low:
        return "平台要求验证", "YouTube 判定为机器人请求。请在「设置」中导入浏览器 cookies 后重试。"
    if "private video" in low or "is private" in low:
        return "视频是私密的", "请替换为公开可访问的视频链接。"
    if "members only" in low:
        return "会员专属视频", "需要登录且有会员权限，导入 cookies 后重试。"
    if "unsupported url" in low:
        return "暂不支持这个链接", "请粘贴视频详情页链接，而不是主页、合集或搜索结果页。"
    if "http error 403" in low or "forbidden" in low:
        return "平台拒绝了下载请求", "可能是地区限制或需要登录，导入 cookies 后重试。"
    if "http error 429" in low or "too many requests" in low:
        return "请求过于频繁", "稍等几分钟再试，或在设置中导入 cookies。"
    if "unable to download webpage" in low or "failed to resolve" in low or "connection" in low or "timed out" in low:
        return "网络连接失败", "无法访问目标平台，请检查网络或稍后重试。"
    if "video unavailable" in low or "unavailable" in low:
        return "视频不可用", "视频可能已被删除、设为私密或地区受限。"
    if "player response" in low or "extract any" in low:
        return "无法获取视频播放信息", "平台可能触发了风控或临时限制，稍后重试；YouTube 可尝试导入 cookies。"
    if "requested format is not available" in low:
        return "无法获取音视频流", "该视频可能受版权或 DRM 保护，或清晰度选项不可用。"
    if "no space left" in low:
        return "磁盘空间不足", "请清理磁盘后重试。"
    if "ffmpeg" in low and "not found" in low:
        return "缺少 ffmpeg", "请先安装 ffmpeg：brew install ffmpeg。"
    message = raw.splitlines()[0] if raw else "未知错误"
    return "提取失败", message[:220]
