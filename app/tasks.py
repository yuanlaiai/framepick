"""任务队列与状态管理。"""

from __future__ import annotations

import json
import logging
import queue
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from . import config, pipeline
from .errors import Cancelled

log = logging.getLogger("framepick.tasks")


@dataclass
class Task:
    id: str
    kind: str
    url: str = ""
    filename: str = ""
    status: str = "queued"
    progress: int = 0
    stage: str = "排队中"
    message: str = ""
    options: dict = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    source: dict = field(default_factory=dict)
    result: dict | None = None
    error: str = ""
    error_hint: str = ""
    file_path: str = ""
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def summary(self) -> dict:
        source = self.source or (self.result or {}).get("source") or {}
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": self.progress,
            "stage": self.stage,
            "message": self.message,
            "title": source.get("title") or self.filename or self.url,
            "platform_label": source.get("platform_label") or "",
            "thumbnail": source.get("thumbnail") or "",
            "duration": source.get("duration") or 0,
            "chars": ((self.result or {}).get("stats") or {}).get("chars", 0),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "error": self.error,
            "error_hint": self.error_hint,
        }

    def public(self) -> dict:
        data = self.summary()
        data.update(
            {
                "url": self.url,
                "filename": self.filename,
                "options": self.options,
                "source": self.source,
                "result": self.result if self.status == "done" else None,
            }
        )
        return data


class TaskManager:
    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}
        self._lock = threading.RLock()
        self._queue: queue.Queue[str] = queue.Queue()
        self._worker = threading.Thread(target=self._loop, name="framepick-worker", daemon=True)
        self._started = False

    # ---------- 生命周期 ----------
    def start(self) -> None:
        if self._started:
            return
        config.ensure_dirs()
        self._load_persisted()
        self._worker.start()
        self._started = True

    def _load_persisted(self) -> None:
        files = sorted(config.TASKS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in files[:40]:
            try:
                data = json.loads(path.read_text("utf-8"))
                task = Task(
                    id=data["id"],
                    kind=data.get("kind", "url"),
                    url=data.get("url", ""),
                    filename=data.get("filename", ""),
                    status=data.get("status", "done"),
                    progress=100 if data.get("status") == "done" else 0,
                    stage="完成",
                    options=data.get("options", {}),
                    created_at=data.get("created_at", path.stat().st_mtime),
                    updated_at=data.get("updated_at", path.stat().st_mtime),
                    source=data.get("source", {}),
                    result=data.get("result"),
                    error=data.get("error", ""),
                    error_hint=data.get("error_hint", ""),
                )
                if task.status in ("queued", "running"):
                    task.status = "error"
                    task.error = "任务被中断"
                    task.error_hint = "服务重启导致任务中断，请重新提取。"
                    task.stage = "已中断"
                self._tasks[task.id] = task
            except Exception as exc:
                log.warning("skip persisted task %s: %s", path.name, exc)

    # ---------- 创建任务 ----------
    def create_url(self, url: str, options: dict) -> Task:
        task = Task(id=uuid.uuid4().hex[:12], kind="url", url=url, options=options)
        with self._lock:
            self._tasks[task.id] = task
        self._queue.put(task.id)
        return task

    def create_file(self, file_path: Path, filename: str, options: dict) -> Task:
        task = Task(
            id=uuid.uuid4().hex[:12],
            kind="file",
            filename=filename,
            file_path=str(file_path),
            options=options,
        )
        with self._lock:
            self._tasks[task.id] = task
        self._queue.put(task.id)
        return task

    # ---------- 查询 ----------
    def get(self, task_id: str) -> Task | None:
        with self._lock:
            return self._tasks.get(task_id)

    def recent(self, limit: int = 12) -> list[dict]:
        with self._lock:
            tasks = sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)
        return [t.summary() for t in tasks[:limit]]

    def cancel(self, task_id: str) -> Task | None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return None
            task.cancel_event.set()
            # 排队中的任务直接标记取消，Worker 取出时会跳过；
            # 正在运行的任务由 cancel_event 在 pipeline 的下一个检查点中断。
            if task.status == "queued":
                task.status = "canceled"
                task.stage = "已取消"
                task.message = "任务已取消"
                task.updated_at = time.time()
            return task

    def delete(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.pop(task_id, None)
        if not task:
            return False
        task.cancel_event.set()
        self._remove_files(task_id)
        return True

    def _remove_files(self, task_id: str) -> None:
        try:
            (config.TASKS_DIR / f"{task_id}.json").unlink(missing_ok=True)
            shutil.rmtree(config.TASKS_DIR / task_id, ignore_errors=True)
            shutil.rmtree(config.ASSETS_DIR / task_id, ignore_errors=True)
        except OSError:
            pass

    # ---------- 设置 ----------
    def has_cookies(self) -> bool:
        path = config.COOKIES_FILE
        return path.exists() and path.stat().st_size > 0

    def cookies_updated_at(self) -> float:
        try:
            return config.COOKIES_FILE.stat().st_mtime
        except OSError:
            return 0.0

    def save_cookies(self, text: str) -> int:
        text = (text or "").strip()
        if not text:
            raise ValueError("cookies 内容为空")
        if text.startswith("[") or text.startswith("{"):
            text = _json_cookies_to_netscape(text)
        lines = [ln for ln in text.splitlines() if ln.strip()]
        if len(lines) < 1:
            raise ValueError("cookies 格式无法识别")
        config.COOKIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        config.COOKIES_FILE.write_text("\n".join(lines) + "\n", "utf-8")
        return len(lines)

    def clear_cookies(self) -> None:
        config.COOKIES_FILE.unlink(missing_ok=True)

    # ---------- 工作线程 ----------
    # 单 Worker 串行消费队列：Whisper 推理本身就会吃满 CPU/GPU，
    # 并发只会让多个任务一起变慢，还容易触发平台风控。
    def _loop(self) -> None:
        while True:
            task_id = self._queue.get()
            if task_id is None:
                return
            task = self.get(task_id)
            if not task:
                continue
            if task.cancel_event.is_set():
                continue
            self._run(task)

    def _run(self, task: Task) -> None:
        task.status = "running"
        task.progress = 1
        task.stage = "准备中"
        task.message = "任务开始"
        task.updated_at = time.time()

        def emit(progress: int, stage: str, message: str) -> None:
            if task.cancel_event.is_set():
                raise Cancelled()
            task.progress = max(task.progress, min(99, int(progress)))
            task.stage = stage
            task.message = message
            task.updated_at = time.time()

        task_dir = config.TASKS_DIR / task.id
        task_dir.mkdir(parents=True, exist_ok=True)
        try:
            # 素材目录与任务 JSON 分开存：结果可持久化，临时音视频处理完即删
            if task.kind == "url":
                result = pipeline.run_url(
                    task_id=task.id,
                    url=task.url,
                    options=task.options,
                    task_dir=task_dir,
                    emit=emit,
                    cancel_check=lambda: task.cancel_event.is_set(),
                )
            else:
                result = pipeline.run_file(
                    task_id=task.id,
                    file_path=Path(task.file_path),
                    filename=task.filename,
                    options=task.options,
                    task_dir=task_dir,
                    emit=emit,
                    cancel_check=lambda: task.cancel_event.is_set(),
                )
        except Cancelled:
            task.status = "canceled"
            task.stage = "已取消"
            task.message = "任务已取消"
        except Exception as exc:  # noqa: BLE001
            log.exception("task %s failed", task.id)
            message, hint = pipeline.friendly_error(exc)
            task.status = "error"
            task.stage = "失败"
            task.error = message
            task.error_hint = hint
            task.message = message
        else:
            task.status = "done"
            task.progress = 100
            task.stage = "完成"
            task.message = (
                f"完成，共 {result['stats']['chars']} 字，用时 {result['elapsed']:.0f} 秒"
            )
            result.setdefault("created_at", task.created_at)
            task.source = result["source"]
            task.result = result
            self._persist(task)
        finally:
            task.updated_at = time.time()
            shutil.rmtree(task_dir, ignore_errors=True)
            if task.kind == "file" and task.status != "done":
                try:
                    Path(task.file_path).unlink(missing_ok=True)
                except OSError:
                    pass

    def _persist(self, task: Task) -> None:
        payload = {
            "id": task.id,
            "kind": task.kind,
            "url": task.url,
            "filename": task.filename,
            "status": task.status,
            "options": task.options,
            "created_at": task.created_at,
            "updated_at": task.updated_at,
            "source": task.source,
            "result": task.result,
            "error": task.error,
            "error_hint": task.error_hint,
        }
        path = config.TASKS_DIR / f"{task.id}.json"
        tmp = path.with_suffix(".json.tmp")
        try:
            tmp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
            tmp.replace(path)
        except OSError as exc:
            log.warning("persist task failed: %s", exc)


def _json_cookies_to_netscape(text: str) -> str:
    """把浏览器扩展导出的 JSON cookies 转成 yt-dlp 需要的 Netscape 格式。"""
    data = json.loads(text)
    if isinstance(data, dict):
        data = data.get("cookies") or []
    lines = ["# Netscape HTTP Cookie File"]
    for item in data:
        domain = item.get("domain") or ""
        if not domain:
            continue
        include_sub = "TRUE" if domain.startswith(".") else "FALSE"
        expires = int(item.get("expirationDate") or item.get("expires") or 0)
        secure = "TRUE" if item.get("secure") else "FALSE"
        name = item.get("name") or ""
        value = item.get("value") or ""
        path = item.get("path") or "/"
        if name:
            lines.append("\t".join([domain, include_sub, path, secure, str(expires), name, value]))
    return "\n".join(lines)
