"""链接识别：从分享文案中提取 URL，并判断所属平台。"""
from __future__ import annotations

import re
from urllib.parse import urlparse

URL_RE = re.compile(r"https?://[^\s\u4e00-\u9fff，。！？、；：""''（）《》【】]+", re.IGNORECASE)

PLATFORM_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"(^|\.)douyin\.com$"), "douyin", "抖音"),
    (re.compile(r"(^|\.)iesdouyin\.com$"), "douyin", "抖音"),
    (re.compile(r"(^|\.)bilibili\.com$|(^|\.)b23\.tv$"), "bilibili", "B站"),
    (re.compile(r"(^|\.)youtube\.com$|(^|\.)youtu\.be$"), "youtube", "YouTube"),
    (re.compile(r"(^|\.)tiktok\.com$"), "tiktok", "TikTok"),
    (re.compile(r"(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$"), "xiaohongshu", "小红书"),
    (re.compile(r"(^|\.)kuaishou\.com$|(^|\.)chenzhongtech\.com$"), "kuaishou", "快手"),
    (re.compile(r"(^|\.)weibo\.com$|(^|\.)weibo\.cn$"), "weibo", "微博"),
    (re.compile(r"(^|\.)twitter\.com$|(^|\.)x\.com$"), "twitter", "X"),
    (re.compile(r"(^|\.)instagram\.com$"), "instagram", "Instagram"),
    (re.compile(r"(^|\.)vimeo\.com$"), "vimeo", "Vimeo"),
    (re.compile(r"(^|\.)ixigua\.com$"), "ixigua", "西瓜视频"),
    (re.compile(r"(^|\.)zhihu\.com$"), "zhihu", "知乎"),
    (re.compile(r"(^|\.)mp\.weixin\.qq\.com$"), "wechat", "微信视频"),
]


def extract_url(text: str) -> str | None:
    """从一段分享文案里找出第一个 http(s) 链接。

    抖音/B站的分享文本通常是「复制打开抖音… https://v.douyin.com/xxx/ …」，
    这里允许中文与标点混杂，并去掉结尾的全角标点。
    """
    if not text:
        return None
    text = text.strip()
    if re.fullmatch(r"https?://\S+", text):
        return text
    m = URL_RE.search(text)
    if m:
        return m.group(0).rstrip(".,;!?)]}，。；！？）】")
    return None


def detect_platform(url: str) -> tuple[str, str]:
    """按域名判断平台；匹配不到时返回通用链接，交给 yt-dlp 尝试。"""
    try:
        host = (urlparse(url).hostname or "").lower()
    except ValueError:
        return "unknown", "通用链接"
    host_no_www = host[4:] if host.startswith("www.") else host
    for pattern, key, label in PLATFORM_RULES:
        if pattern.search(host_no_www):
            return key, label
    return "generic", "通用链接"


EXTRACTOR_LABELS = {
    "Youtube": "YouTube",
    "BiliBili": "B站",
    "Douyin": "抖音",
    "TikTok": "TikTok",
    "Twitter": "X",
    "Vimeo": "Vimeo",
}
