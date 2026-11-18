"""语音识别：ffmpeg 解码 + faster-whisper 本地转写。"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import wave
from pathlib import Path

import numpy as np

from . import config
from .errors import Cancelled

log = logging.getLogger("framepick.asr")

_models: dict[str, object] = {}
_model_lock = threading.Lock()
_env_ready = False
_device_info: dict[str, str] = {}


def _ensure_hf_env() -> None:
    """官方 HF 不可达时自动切换到国内镜像，避免首次下载模型卡住。

    只需探测一次；HF_ENDPOINT 必须赶在 import huggingface_hub 之前设置。
    """
    global _env_ready
    if _env_ready:
        return
    _env_ready = True
    if os.environ.get("HF_ENDPOINT"):
        return
    endpoint = "https://hf-mirror.com"
    try:
        import urllib.request

        request = urllib.request.Request("https://huggingface.co", method="HEAD")
        with urllib.request.urlopen(request, timeout=4):
            endpoint = "https://huggingface.co"
    except Exception:
        pass
    os.environ["HF_ENDPOINT"] = endpoint
    log.info("HF_ENDPOINT=%s", endpoint)


def _detect_device() -> tuple[str, str]:
    """优先 Apple Silicon 的 MPS（实测比 CPU 快 3 倍以上），否则退回 CPU int8。"""
    if _device_info.get("device"):
        return _device_info["device"], _device_info["compute_type"]
    device, compute_type = "cpu", "int8"
    try:
        import ctranslate2

        if ctranslate2.get_supported_compute_types("mps"):
            device, compute_type = "mps", "float16"
    except Exception:
        pass
    _device_info.update({"device": device, "compute_type": compute_type})
    return device, compute_type


def device_info() -> dict[str, str]:
    device, compute_type = _detect_device()
    return {"device": device, "compute_type": compute_type}


def get_model(size: str, on_log=None):
    """按模型名懒加载并缓存 WhisperModel；首次调用可能触发模型下载。"""
    _ensure_hf_env()
    with _model_lock:
        if size in _models:
            return _models[size]
        from faster_whisper import WhisperModel

        device, compute_type = _detect_device()
        if on_log:
            on_log(f"正在加载 Whisper 模型 {size}（{device}，首次使用需要下载模型）…")
        ticker = threading.Event()
        stopped = False

        def keep_alive() -> None:
            while not ticker.wait(3):
                if not stopped and on_log:
                    on_log(f"模型 {size} 下载 / 加载中，请稍候…")

        thread = threading.Thread(target=keep_alive, daemon=True)
        thread.start()
        try:
            model = WhisperModel(
                size,
                device=device,
                compute_type=compute_type,
                download_root=str(config.MODELS_DIR),
                cpu_threads=max(1, (os.cpu_count() or 4) // 2),
            )
        finally:
            stopped = True
            ticker.set()
        _models[size] = model
        return model


def decode_media(path: Path, out_wav: Path, ffmpeg: str | None = None) -> tuple[np.ndarray, float]:
    ffmpeg = ffmpeg or config.FFMPEG
    if not ffmpeg:
        raise RuntimeError("未找到 ffmpeg，请先安装：brew install ffmpeg")
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg, "-nostdin", "-loglevel", "error", "-y",
        "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(out_wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()[-1:] or ["未知错误"]
        raise RuntimeError(f"音视频解码失败：{detail[0][:200]}")
    with wave.open(str(out_wav), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        rate = wf.getframerate()
        channels = wf.getnchannels()
        width = wf.getsampwidth()
    if width != 2 or channels != 1 or rate != 16000:
        raise RuntimeError("音频格式异常，解码结果不是 16kHz 单声道 PCM")
    audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    return audio, len(audio) / 16000.0


def probe_duration(path: Path, ffprobe: str | None = None) -> float:
    ffprobe = ffprobe or config.FFPROBE
    if not ffprobe:
        return 0.0
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=20,
        )
        return round(float((out.stdout or "0").strip() or 0), 2)
    except Exception:
        return 0.0


def detect_language(model, audio: np.ndarray) -> str | None:
    try:
        result = model.detect_language(audio, vad_filter=True)
        if isinstance(result, (tuple, list)) and len(result) >= 2:
            lang, prob = result[0], result[1]
            if lang and (not prob or prob >= 0.4):
                return lang
    except Exception as exc:  # pragma: no cover - 检测失败时回退到自动
        log.warning("language detect failed: %s", exc)
    return None


def transcribe(
    audio: np.ndarray,
    *,
    model_key: str,
    language: str,
    duration: float,
    on_progress=None,
    on_log=None,
    cancel_check=None,
) -> tuple[list[dict], dict]:
    """返回 (segments, meta)。on_progress 传入 0~1 的相对进度。"""
    size = config.MODEL_CHOICES.get(model_key, config.MODEL_CHOICES["standard"])["whisper"]
    model = get_model(size, on_log=on_log)

    lang = language if language and language != "auto" else None
    if lang is None:
        started = time.time()
        if on_log:
            on_log("正在检测语言…")
        lang = detect_language(model, audio)
        log.info("detected language %s in %.1fs", lang, time.time() - started)
        if on_log:
            on_log(f"语言：{lang or '自动'}")

    prompt = config.ZH_PROMPT if (lang or "").startswith("zh") else None
    total = duration or 1.0

    def run(vad_filter: bool) -> tuple[list[dict], object]:
        started = time.time()
        segments, info = model.transcribe(
            audio,
            language=lang,
            beam_size=5,
            vad_filter=vad_filter,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 200},
            condition_on_previous_text=False,
            initial_prompt=prompt,
            word_timestamps=False,
            hallucination_silence_threshold=2.0,
        )
        collected: list[dict] = []
        for seg in segments:
            if cancel_check and cancel_check():
                raise Cancelled()
            text = (seg.text or "").strip()
            if text:
                collected.append(
                    {"start": round(float(seg.start), 2), "end": round(float(seg.end), 2), "text": text}
                )
            if on_progress:
                on_progress(min(0.99, float(seg.end) / total if total else 0.5))
        log.info("transcribe(vad=%s) -> %d segments in %.1fs", vad_filter, len(collected), time.time() - started)
        return collected, info

    if on_log:
        on_log(f"正在转写 {duration:.1f} 秒音频…")
    segments_out, info = run(True)
    if not segments_out:
        # 纯音乐/演唱类视频经常被 Silero VAD 整段判成无人声，关闭 VAD 再转一次。
        # 只有结果为空时才重试，正常短视频不会付出额外成本。
        if on_log:
            on_log("人声检测未命中，改用整段转写重试…")
        segments_out, info = run(False)

    meta = {
        "language": lang or getattr(info, "language", "") or "auto",
        "language_probability": round(float(getattr(info, "language_probability", 0) or 0), 3),
        "engine": f"whisper-{size}",
    }
    return segments_out, meta
