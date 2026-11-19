"""免登录页面解析：抖音 / 小红书。

yt-dlp 的抖音提取器强制要求 cookies；这里改用本机 Chrome（Playwright 驱动）
匿名打开分享页，直接读取页面自己发出的详情接口响应，拿到视频地址、封面、
作者、文案与互动数据。小红书同样先试 yt-dlp，失败时用浏览器兜底。
"""

from __future__ import annotations

import datetime as dt
import html as html_lib
import logging
import os
import re
import shutil
import time
import urllib.request
from pathlib import Path
from typing import Any

from urllib.parse import parse_qs, quote, urlparse

from . import config
from .errors import FriendlyError

log = logging.getLogger("framepick.scrapers")

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


def _load_cookies() -> list[dict]:
    """把用户在设置里导入的 Netscape cookies 注入浏览器，用于 RedNote 等需要登录的场景。"""
    path = config.COOKIES_FILE
    if not path.exists() or path.stat().st_size == 0:
        return []
    cookies: list[dict] = []
    try:
        lines = path.read_text("utf-8").splitlines()
    except OSError:
        return []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 7:
            continue
        domain, _flag, cpath, secure, expires, name, value = parts
        cookie = {
            "name": name,
            "value": value,
            "domain": domain,
            "path": cpath or "/",
            "secure": secure.upper() == "TRUE",
            "httpOnly": False,
            "sameSite": "Lax",
        }
        try:
            exp = int(float(expires))
            if exp > 0:
                cookie["expires"] = exp
        except ValueError:
            pass
        cookies.append(cookie)
    return cookies


def _launch(p):
    chrome = _find_chrome()
    args = [
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
        "--disable-blink-features=AutomationControlled",
        "--disable-background-networking",
        # Docker 默认 /dev/shm 只有 64MB，播放器初始化时容易崩
        "--disable-dev-shm-usage",
    ]
    # 容器内以 root 运行 Chromium 必须关闭沙箱
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        args.append("--no-sandbox")

    kwargs: dict[str, Any] = {"headless": True, "args": args}
    if chrome:
        kwargs["executable_path"] = chrome
    try:
        return p.chromium.launch(**kwargs)
    except Exception as exc:  # noqa: BLE001
        raise FriendlyError(
            "解析抖音/小红书需要 Chrome",
            "请安装 Google Chrome，或设置 CHROME_BIN 指向浏览器可执行文件。",
        ) from exc


def _open_page(
    url: str,
    *,
    api_hints: tuple[str, ...] = (),
    wait_api_ms: int = 12000,
    wait_ms: int = 5000,
    ready=None,
):
    """打开页面，收集匹配 api_hints 的接口 JSON 响应。

    抖音/小红书的详情数据由页面 JS 带签名请求，直接 curl 接口会被风控。
    这里让浏览器自己发请求，我们只旁路读取响应体，因此不需要登录态。
    """
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
        # 反自动化检测：去掉 webdriver 标记，并让 UA Client Hints 显示为 Chrome。
        # 没有这一步时，容器里的 Chromium 会被抖音弹滑块验证。
        cookies = _load_cookies()
        if cookies:
            try:
                context.add_cookies(cookies)
            except Exception as exc:  # noqa: BLE001
                log.warning("注入 cookies 失败：%s", exc)
        context.add_init_script(
            """
            try {
              Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
              const brands = [
                { brand: 'Google Chrome', version: '124' },
                { brand: 'Chromium', version: '124' },
                { brand: 'Not-A.Brand', version: '99' },
              ];
              Object.defineProperty(navigator, 'userAgentData', {
                get: () => ({ brands, mobile: false, platform: 'macOS' }),
              });
            } catch (error) {
              /* 旧浏览器没有 userAgentData，忽略即可 */
            }
            """
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

        # 首个接口响应可能只是空壳，等到真正包含详情数据的响应再继续
        deadline = time.time() + wait_api_ms / 1000
        while time.time() < deadline:
            if captured and (ready is None or ready(captured)):
                break
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
    """关掉登录弹窗/遮罩。

    抖音匿名访问会弹登录框，但详情接口在弹窗出现前就已经返回；
    顺手关掉只是为了让页面继续播放、避免遮罩挡住后续操作。
    """
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
    """支持详情页链接与 v.douyin.com 短链（短链需要跟随 302）。"""
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
    """抖音：直接从页面自己的 aweme/detail 响应里取完整视频信息。"""
    vid = douyin_id(url)
    if not vid:
        raise FriendlyError("没有识别出抖音视频 ID", "请粘贴视频详情页链接，或 App 里的分享链接。")
    page_url = f"https://www.douyin.com/video/{vid}"
    html, payloads, _state = _open_page(
        page_url,
        api_hints=("aweme/detail", "aweme/v1/web/aweme"),
        wait_api_ms=20000,
        ready=lambda items: any(
            isinstance(item, dict) and item.get("aweme_detail") for item in items
        ),
    )
    aweme = _pick_aweme(payloads)
    if not aweme:
        raise FriendlyError(
            "没有拿到抖音视频信息",
            "页面已打开但没有拿到详情数据，请重试；若持续失败可在设置中导入 cookies。",
        )
    # aweme_type 68/150 是图文/图集，没有可下载的视频流
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


def normalize_xiaohongshu_url(url: str) -> str:
    """把 rednote.com 链接映射到 xiaohongshu.com 的同一条笔记。

    RedNote 国际版页面经常强制登录，而小红书主站对同一条笔记通常可直接访问；
    yt-dlp 的 XiaoHongShu 提取器也只认 xiaohongshu.com 域名。
    """
    parsed = urlparse(url)
    if not (parsed.hostname or "").endswith("rednote.com"):
        return url
    match = XHS_ID_RE.search(url)
    if not match:
        return url
    token = (parse_qs(parsed.query).get("xsec_token") or [""])[0]
    normalized = f"https://www.xiaohongshu.com/explore/{match.group(1)}"
    if token:
        normalized += f"?xsec_token={quote(token)}&xsec_source=pc_share"
    return normalized


def _xhs_from_page(page_url: str, *, allow_rednote_hint: bool, has_token: bool) -> dict:
    """渲染单个小红书笔记页并解析；失败时抛出带中文提示的 FriendlyError。"""
    html, payloads, state = _open_page(
        page_url,
        api_hints=("v1/feed", "note_detail", "note_info"),
        wait_api_ms=8000,
    )
    if allow_rednote_hint and ("登录 - rednote" in html or "登录后推荐更懂你的笔记" in html):
        raise FriendlyError(
            "RedNote 要求登录",
            "rednote.com 的笔记页跳转到了登录页。请改用小红书（xiaohongshu.com）分享链接，或在设置里导入 cookies。",
        )
    if "你访问的页面不见了" in html or "页面不存在" in html or "当前笔记暂时无法浏览" in html:
        raise FriendlyError(
            "小红书笔记暂不可访问",
            "笔记可能被删除、仅自己可见或地区受限。请在 App 里重新分享，或改用带 xsec_token 的链接。",
        )

    note = _find_note(state)
    if not note:
        for payload in payloads:
            note = _search_note(payload)
            if note:
                break
    if not note:
        if not has_token:
            raise FriendlyError(
                "链接缺少 xsec_token",
                "页面没有返回笔记数据。请在 App 里点「分享 → 复制链接」，或直接粘贴完整分享文案。",
            )
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
    title = note.get("title") or desc[:40] or "小红书笔记"
    return {
        "id": note.get("noteId") or "",
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


def xiaohongshu_info(url: str) -> dict:
    """小红书：读取页面 SSR 的 __INITIAL_STATE__ 或 feed 接口。

    分享链接里的 xsec_token 有时效，过期后需要重新复制分享链接。
    rednote.com 是国际版域名，经常跳登录页；这里会先把同一条笔记
    映射到 xiaohongshu.com/explore/{id} 再尝试，失败才提示登录。
    """
    parsed = urlparse(url)
    is_rednote = (parsed.hostname or "").endswith("rednote.com")
    match = XHS_ID_RE.search(url)
    note_id = match.group(1) if match else ""
    token = (parse_qs(parsed.query).get("xsec_token") or [""])[0]

    candidates: list[tuple[str, bool]] = []
    if is_rednote and note_id:
        cn_url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if token:
            cn_url += f"?xsec_token={quote(token)}&xsec_source=pc_share"
        candidates.append((cn_url, False))
    candidates.append((_fetch_redirect(url), is_rednote))

    last_error: FriendlyError | None = None
    for page_url, allow_rednote_hint in candidates:
        try:
            return _xhs_from_page(page_url, allow_rednote_hint=allow_rednote_hint, has_token=bool(token))
        except FriendlyError as exc:  # noqa: PERF203
            last_error = exc
            log.info("xhs candidate failed (%s): %s", page_url[:60], exc.message)
    raise last_error or FriendlyError("小红书解析失败", "请稍后重试。")
