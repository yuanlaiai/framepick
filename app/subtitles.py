"""平台字幕下载与解析（VTT / SRT / JSON3）。"""

from __future__ import annotations

import html
import json
import os
import re
import urllib.request

CUE_RE = re.compile(
    r"(?P<start>\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})"
)
TAG_RE = re.compile(r"<[^>]+>")


def _parse_ts(value: str) -> float:
    value = value.replace(",", ".").strip()
    parts = value.split(":")
    if len(parts) == 3:
        h, m, s = parts
    else:
        h, m, s = "0", parts[0], parts[1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def _clean(text: str) -> str:
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    text = text.replace("\u200b", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_vtt(content: str) -> list[dict]:
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = content.split("\n")
    cues: list[dict] = []
    i = 0
    while i < len(lines):
        m = CUE_RE.search(lines[i])
        if not m:
            i += 1
            continue
        start = _parse_ts(m.group("start"))
        end = _parse_ts(m.group("end"))
        i += 1
        buf: list[str] = []
        while i < len(lines) and lines[i].strip():
            buf.append(_clean(lines[i]))
            i += 1
        text = " ".join(x for x in buf if x).strip()
        if text:
            cues.append({"start": start, "end": end, "text": text})
        i += 1
    return cues


def parse_json3(content: str) -> list[dict]:
    data = json.loads(content)
    cues: list[dict] = []
    for ev in data.get("events", []):
        segs = ev.get("segs") or []
        text = "".join(s.get("utf8", "") for s in segs)
        text = _clean(text)
        if not text or not text.strip():
            continue
        start = float(ev.get("tStartMs", 0)) / 1000
        end = start + float(ev.get("dDurationMs", 2000)) / 1000
        cues.append({"start": start, "end": end, "text": text})
    return cues


def parse_srt(content: str) -> list[dict]:
    return parse_vtt(content)


def _dedupe_cues(cues: list[dict]) -> list[dict]:
    """清理平台滚动字幕：相邻 cue 经常整行重复或“上一句是下一句的前缀”。"""
    out: list[dict] = []
    for cue in cues:
        text = cue["text"].strip()
        if not text:
            continue
        if out:
            last = out[-1]
            if text == last["text"]:
                last["end"] = max(last["end"], cue["end"])
                continue
            if len(last["text"]) >= 4 and text.startswith(last["text"]):
                last["text"] = text
                last["end"] = max(last["end"], cue["end"])
                continue
            if len(text) >= 4 and last["text"].startswith(text):
                last["end"] = max(last["end"], cue["end"])
                continue
        out.append({"start": round(cue["start"], 2), "end": round(cue["end"], 2), "text": text})
    return out


def _score(name: str) -> int:
    name = name.lower()
    if name in ("zh", "zh-hans", "zh-cn", "zh-sg"):
        return 100
    if name.startswith("zh"):
        return 95
    if name in ("en", "en-us", "en-gb"):
        return 60
    if name.startswith("en"):
        return 55
    return 40


def _env_proxy() -> str | None:
    for key in ("ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    return None


def pick_subtitle(info: dict) -> dict | None:
    """优先人工中文字幕，其次自动中文字幕，再退到英文/其他。

    同语言下 VTT/SRT 比 json3 更好解析，排序时给一点格式加分。
    """
    candidates: list[tuple[int, int, dict]] = []

    def add(tracks: dict, is_auto: int) -> None:
        for name, entries in (tracks or {}).items():
            for entry in entries or []:
                ext = (entry.get("ext") or "").lower()
                if ext not in ("vtt", "srt", "json3"):
                    continue
                if not entry.get("url"):
                    continue
                # json3 也能解析，但 VTT/SRT 更稳，优先选
                format_bonus = 10 if ext in ("vtt", "srt") else 0
                candidates.append((_score(name) + format_bonus, is_auto, entry))

    add(info.get("subtitles") or {}, 0)
    add(info.get("automatic_captions") or {}, 1)
    if not candidates:
        return None
    candidates.sort(key=lambda c: (c[0], -c[1]), reverse=True)
    return candidates[0][2]


def _read_url(url: str, timeout: float = 10.0, prefer_proxy: bool = False) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )
    proxy = _env_proxy()

    def via_direct() -> str:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")

    def via_proxy() -> str:
        if not proxy:
            raise RuntimeError("no proxy configured")
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy})
        )
        with opener.open(req, timeout=timeout + 8) as resp:
            return resp.read().decode("utf-8", errors="replace")

    order = []
    if prefer_proxy and proxy:
        order = [via_proxy, via_direct]
    elif proxy:
        order = [via_direct, via_proxy]
    else:
        order = [via_direct]

    last_error: Exception | None = None
    for reader in order:
        try:
            return reader()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
    assert last_error is not None
    raise last_error


def fetch_subtitle(url: str, timeout: float = 10.0, prefer_proxy: bool = False) -> list[dict]:
    raw = _read_url(url, timeout, prefer_proxy=prefer_proxy)
    stripped = raw.lstrip()
    if stripped.startswith("{"):
        cues = parse_json3(raw)
    elif "-->" in raw:
        cues = parse_vtt(raw)
    else:
        cues = []
    return _dedupe_cues(cues)
