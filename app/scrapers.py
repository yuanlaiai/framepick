"""免登录页面解析：抖音 / 小红书。

yt-dlp 的抖音提取器强制要求 cookies；这里改用本机 Chrome（Playwright 驱动）
匿名打开分享页，直接读取页面自己发出的详情接口响应，拿到视频地址、封面、
作者、文案与互动数据。小红书同样先试 yt-dlp，失败时用浏览器兜底。
"""

from __future__ import annotations

import datetime as dt
import html as html_lib
import os
import re
import shutil
import time
import urllib.request
from pathlib import Path
from typing import Any

from .errors import FriendlyError

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

DOUYIN_ID_RE = re.compile(r"/(?:video|share/video|note)/(\d{8,})")
XHS_ID_RE = re.compile(r"/(?:explore|discovery/item|red_video)/([0-9a-fA-F]{16,})")


def _find_chrome() -> str | None:
    candidates = [
        os.environ.get("CHROME_BIN", ""),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        shutil.which("google-chrome") or "",
        shutil.which("google-chrome-stable") or "",
        shutil.which("chromium") or "",
        shutil.which("chrome") or "",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def chrome_available() -> bool:
    return _find_chrome() is not None


def _fetch_redirect(url: str, timeout: float = 15.0) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.geturl() or url
    except Exception:
        return url


def _launch(p):
    chrome = _find_chrome()
    kwargs: dict[str, Any] = {
        "headless": True,
        "args": [
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
            "--disable-blink-features=AutomationControlled",
            "--disable-background-networking",
        ],
    }
    if chrome:
        kwargs["executable_path"] = chrome
    try:
        return p.chromium.launch(**kwargs)
    except Exception as exc:  # noqa: BLE001
        raise FriendlyError(
            "解析抖音/小红书需要 Chrome",
            "请安装 Google Chrome，或设置 CHROME_BIN 指向浏览器可执行文件。",
        ) from exc


def _open_page(url: str, *, api_hints: tuple[str, ...] = (), wait_api_ms: int = 12000, wait_ms: int = 5000):
    """打开页面，收集匹配 api_hints 的接口 JSON 响应。"""
    if not chrome_available():
        raise FriendlyError(
            "解析抖音/小红书需要 Chrome",
            "请安装 Google Chrome，或设置环境变量 CHROME_BIN。",
        )
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001
        raise FriendlyError(
            "缺少 Playwright 依赖",
            "请执行 .venv/bin/pip install playwright 后重启服务。",
        ) from exc

    captured: list[dict] = []
    with sync_playwright() as p:
        browser = _launch(p)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=UA,
            locale="zh-CN",
            timezone_id="Asia/Shanghai",
        )
        page = context.new_page()

        def on_response(response) -> None:
            if api_hints and not any(hint in response.url for hint in api_hints):
                return
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                return
            if isinstance(payload, (dict, list)):
                captured.append(payload)

        page.on("response", on_response)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:  # noqa: BLE001
            browser.close()
            raise FriendlyError("页面打开失败", f"{str(exc)[:160]}，请稍后重试。") from exc

        deadline = time.time() + wait_api_ms / 1000
        while time.time() < deadline and not captured:
            page.wait_for_timeout(300)
        _dismiss_overlays(page)
        page.wait_for_timeout(800)

        html = page.content()
        state = None
        try:
            state = page.evaluate("() => window.__INITIAL_STATE__ || null")
        except Exception:  # noqa: BLE001
            state = None
        browser.close()
    return html, captured, state


def _dismiss_overlays(page) -> None:
    """关掉登录弹窗/遮罩：抖音匿名访问会提示登录，但不影响取数据。"""
    selectors = [
        '[data-e2e="login-close"]',
        ".dy-account-close",
        'button[aria-label="关闭"]',
        '[aria-label="关闭"]',
        ".close-btn",
        ".xgplayer-close",
    ]
    for selector in selectors:
        try:
            handle = page.query_selector(selector)
            if handle and handle.is_visible():
                handle.click(timeout=800)
        except Exception:  # noqa: BLE001
            pass
    try:
        page.keyboard.press("Escape")
    except Exception:  # noqa: BLE001
        pass
    try:
        page.evaluate(
            """() => {
                document.querySelectorAll(
                  '[class*="login-mask"], [class*="loginMask"], [class*="login-panel"], [id*="login-panel"], [class*="login-container"]'
                ).forEach((node) => {
                  const style = getComputedStyle(node);
                  if (style.position === 'fixed' || style.zIndex > 100) node.remove();
                });
            }"""
        )
    except Exception:  # noqa: BLE001
        pass


def _title(html: str) -> str:
    match = re.search(r"<title[^>]*>(.*?)</title>", html, re.S)
    if not match:
        return ""
    text = html_lib.unescape(re.sub(r"\s+", " ", match.group(1))).strip()
    for suffix in (" - 抖音", "- 抖音", " - 小红书", "- 小红书"):
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip()
    return text


def _meta(html: str, name: str) -> str:
    for tag in re.finditer(r"<meta\b[^>]*>", html):
        chunk = tag.group(0)
        if re.search(rf'(?:name|property)="{re.escape(name)}"', chunk):
            content = re.search(r'content="([^"]*)"', chunk)
            if content:
                return html_lib.unescape(content.group(1))
    return ""


def _hashtags(text: str) -> list[str]:
    tags = [tag.strip() for tag in re.findall(r"#([^#\s,，。；;]+)", text) if tag.strip()]
    seen: list[str] = []
    for tag in tags:
        if tag not in seen:
            seen.append(tag)
    return seen[:20]


def _count(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).replace(",", "").strip()
    match = re.match(r"([\d.]+)\s*(万|亿)?", text)
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2)
    if unit == "万":
        number *= 10000
    elif unit == "亿":
        number *= 100000000
    return int(number)


def _first_url(container: Any) -> str:
    if isinstance(container, dict):
        urls = container.get("url_list") or container.get("urlList") or []
        if urls:
            return str(urls[0])
    return ""


def _date(ts: Any) -> str:
    try:
        return dt.datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return ""


def douyin_id(url: str) -> str | None:
    match = DOUYIN_ID_RE.search(url)
    if match:
        return match.group(1)
    if "douyin.com" in url or "iesdouyin.com" in url:
        resolved = _fetch_redirect(url)
        match = DOUYIN_ID_RE.search(resolved)
        if match:
            return match.group(1)
    return None


def _pick_aweme(payloads: list[dict]) -> dict | None:
    for payload in payloads:
        if isinstance(payload, dict) and payload.get("aweme_detail"):
            return payload["aweme_detail"]
        if isinstance(payload, dict) and payload.get("aweme_id") and payload.get("video"):
            return payload
    return None


def douyin_info(url: str) -> dict:
    vid = douyin_id(url)
    if not vid:
        raise FriendlyError("没有识别出抖音视频 ID", "请粘贴视频详情页链接，或 App 里的分享链接。")
    page_url = f"https://www.douyin.com/video/{vid}"
    html, payloads, _state = _open_page(
        page_url,
        api_hints=("aweme/detail", "aweme/v1/web/aweme"),
        wait_api_ms=15000,
    )
    aweme = _pick_aweme(payloads)
    if not aweme:
        raise FriendlyError(
            "没有拿到抖音视频信息",
            "页面已打开但没有拿到详情数据，请重试；若持续失败可在设置中导入 cookies。",
        )
    if aweme.get("aweme_type") in (68, 150) or not aweme.get("video"):
        raise FriendlyError("这是图文作品", "当前版本只支持抖音视频作品。")

    video = aweme.get("video") or {}
    play_url = _first_url(video.get("play_addr"))
    if not play_url:
        for rate in video.get("bit_rate") or []:
            play_url = _first_url(rate.get("play_addr"))
            if play_url:
                break
    if not play_url:
        raise FriendlyError("没有拿到抖音视频地址", "视频可能受保护，请稍后重试。")

    desc = (aweme.get("desc") or "").strip()
    tags = [item.get("hashtag_name") for item in (aweme.get("text_extra") or []) if item.get("hashtag_name")]
    if not tags:
        tags = _hashtags(desc)
    author = aweme.get("author") or {}
    stats = aweme.get("statistics") or {}
    cover = _first_url(video.get("cover")) or _first_url(video.get("origin_cover")) or _first_url(video.get("dynamic_cover"))
    if not cover:
        cover = _meta(html, "og:image")
    duration = 0.0
    try:
        duration = round(float(video.get("duration") or 0) / 1000.0, 2)
    except (TypeError, ValueError):
        duration = 0.0
    caption = desc or _title(html)
    clean_title = re.sub(r"\s*#[^#\s]+", "", caption).strip() or caption or page_url
    return {
        "id": vid,
        "title": clean_title,
        "description": caption,
        "uploader": author.get("nickname") or "",
        "thumbnail": cover,
        "duration": duration,
        "webpage_url": page_url,
        "extractor_key": "DouyinPage",
        "upload_date": _date(aweme.get("create_time")),
        "like_count": stats.get("digg_count"),
        "view_count": stats.get("play_count"),
        "comment_count": stats.get("comment_count"),
        "repost_count": stats.get("share_count"),
        "tags": tags[:20],
        "platform": "douyin",
        "platform_label": "抖音",
        "_direct_url": play_url,
        "_headers": {"User-Agent": UA, "Referer": "https://www.douyin.com/"},
    }


def _looks_like_note(obj: dict) -> bool:
    return isinstance(obj, dict) and any(k in obj for k in ("video", "desc", "title", "noteId")) and (
        "video" in obj or "desc" in obj
    )


def _search_note(obj: Any, depth: int = 0) -> dict | None:
    if depth > 6:
        return None
    if isinstance(obj, dict):
        if _looks_like_note(obj) and (obj.get("video") or obj.get("desc")):
            return obj
        for value in obj.values():
            found = _search_note(value, depth + 1)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _search_note(item, depth + 1)
            if found:
                return found
    return None


def _find_note(state: Any) -> dict | None:
    if not isinstance(state, dict):
        return None
    detail = ((state.get("note") or {}).get("noteDetailMap") or {})
    for value in detail.values():
        if isinstance(value, dict) and isinstance(value.get("note"), dict):
            return value["note"]
    return _search_note(state)


def _note_video_url(note: dict) -> str:
    video = note.get("video") or {}
    streams = ((video.get("media") or {}).get("stream") or {})
    for codec in ("h264", "h265", "av1", "h266"):
        items = streams.get(codec) or []
        if items:
            first = items[0] or {}
            url = first.get("masterUrl") or (first.get("backupUrls") or [""])[0]
            if url:
                return url
    return ""


def xiaohongshu_info(url: str) -> dict:
    page_url = _fetch_redirect(url)
    match = XHS_ID_RE.search(page_url)
    note_id = match.group(1) if match else ""
    html, payloads, state = _open_page(
        page_url,
        api_hints=("v1/feed", "note_detail", "note_info"),
        wait_api_ms=8000,
    )
    if "你访问的页面不见了" in html or "页面不存在" in html:
        raise FriendlyError(
            "小红书链接已失效",
            "笔记可能被删除，或分享 token 已过期。请在 App 里重新复制分享链接（带 xsec_token）后再试。",
        )
    note = _find_note(state)
    if not note:
        for payload in payloads:
            note = _search_note(payload)
            if note:
                break
    if not note:
        raise FriendlyError(
            "小红书页面解析失败",
            "页面没有返回笔记数据。请确认链接来自 App 分享（带 xsec_token），且没有过期。",
        )
    video_url = _note_video_url(note)
    if not video_url:
        raise FriendlyError("这是小红书图文笔记", "当前版本只处理视频笔记，图片笔记暂不支持。")
    images = note.get("imageList") or []
    cover = ""
    if images:
        cover = images[0].get("urlDefault") or images[0].get("urlPre") or ""
    desc = note.get("desc") or ""
    tags = [item.get("name") for item in (note.get("tagList") or []) if item.get("name")]
    if not tags:
        tags = _hashtags(desc)
    user = note.get("user") or {}
    interact = note.get("interactInfo") or {}
    duration = 0.0
    try:
        capa = (note.get("video") or {}).get("capa") or {}
        duration = round(float(capa.get("duration") or 0), 2)
    except (TypeError, ValueError):
        duration = 0.0
    title = note.get("title") or desc[:40] or note_id
    return {
        "id": note_id,
        "title": title,
        "description": desc,
        "uploader": user.get("nickname") or "",
        "thumbnail": cover,
        "duration": duration,
        "webpage_url": page_url,
        "extractor_key": "XiaohongshuPage",
        "upload_date": _date(note.get("time")) if str(note.get("time") or "").isdigit() else "",
        "like_count": _count(interact.get("likedCount")),
        "view_count": None,
        "comment_count": _count(interact.get("commentCount")),
        "repost_count": _count(interact.get("shareCount")),
        "tags": tags[:20],
        "platform": "xiaohongshu",
        "platform_label": "小红书",
        "_direct_url": video_url,
        "_headers": {"User-Agent": UA, "Referer": "https://www.xiaohongshu.com/"},
    }
