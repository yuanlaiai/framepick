"""全局路径与常量配置。"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
APP_DIR = BASE_DIR / "app"
STATIC_DIR = BASE_DIR / "web" / "dist"
def _env(name: str, legacy: str, default: str) -> str:
    """读取新变量名，兼容 1.0 之前的 VIDSCRIPT_* 旧名字。"""
    return os.environ.get(name) or os.environ.get(legacy) or default


DATA_DIR = Path(_env("FRAMEPICK_DATA_DIR", "VIDSCRIPT_DATA_DIR", str(BASE_DIR / "data")))
TASKS_DIR = DATA_DIR / "tasks"
ASSETS_DIR = DATA_DIR / "assets"
UPLOADS_DIR = DATA_DIR / "uploads"
THUMBS_DIR = DATA_DIR / "thumbs"
COOKIES_FILE = DATA_DIR / "cookies.txt"
CHROME_PROFILE_DIR = DATA_DIR / "chrome-profile"

# 模型缓存：新目录不存在时复用旧版本目录，避免老用户重新下载几百 MB 模型
_model_dir = Path(
    _env("FRAMEPICK_MODEL_DIR", "VIDSCRIPT_MODEL_DIR", str(Path.home() / ".cache" / "framepick-models"))
)
if not _model_dir.exists():
    _legacy_models = Path.home() / ".cache" / "vidscript-models"
    if _legacy_models.exists():
        _model_dir = _legacy_models
MODELS_DIR = _model_dir

FFMPEG = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg") or ""
FFPROBE = os.environ.get("FFPROBE_BIN") or shutil.which("ffprobe") or ""

MAX_UPLOAD_BYTES = int(_env("FRAMEPICK_MAX_UPLOAD_MB", "VIDSCRIPT_MAX_UPLOAD_MB", "600")) * 1024 * 1024

# 模型档位：前端传 key，后端映射到 whisper 模型名
MODEL_CHOICES: dict[str, dict[str, str]] = {
    "fast": {"whisper": "base", "label": "极速", "hint": "base · 最快，适合短视频"},
    "standard": {"whisper": "small", "label": "标准", "hint": "small · 速度与准确度平衡"},
    "accurate": {"whisper": "medium", "label": "精准", "hint": "medium · 长视频/专业场景"},
}

QUALITY_CHOICES: dict[str, str] = {
    "720": "720p 高清（推荐，体积小）",
    "1080": "1080p 超清（需要平台权限）",
    "best": "原始画质（体积最大）",
}

LANGUAGES: dict[str, str] = {
    "auto": "自动检测",
    "zh": "中文",
    "en": "英语",
    "ja": "日语",
    "ko": "韩语",
}

ZH_PROMPT = "以下是普通话的句子，请使用简体中文并加上标点。"


def ensure_dirs() -> None:
    for d in (DATA_DIR, TASKS_DIR, ASSETS_DIR, UPLOADS_DIR, THUMBS_DIR, MODELS_DIR):
        d.mkdir(parents=True, exist_ok=True)
