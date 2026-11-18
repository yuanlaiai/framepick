"""文本后处理：标点规整、断句分段、字幕与导出格式。"""
from __future__ import annotations

import re

CJK_RANGE = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
CJK_RE = re.compile(f"[{CJK_RANGE}]")
CJK_GAP_RE = re.compile(f"([{CJK_RANGE}])[ \\t]+([{CJK_RANGE}])")
CJK_PUNCT_GAP_RE = re.compile(f"([，。！？、；：])[ \\t]+([{CJK_RANGE}])")
CJK_GAP_PUNCT_RE = re.compile(f"([{CJK_RANGE}])[ \\t]+([，。！？、；：])")
MULTI_SPACE_RE = re.compile(r"[ \t]{2,}")
TERMINATORS = "。！？!?；;…"
ASCII_TO_FULL = {",": "，", "!": "！", "?": "？", ";": "；", ":": "：", "(": "（", ")": "）"}


def is_cjk(ch: str) -> bool:
    return bool(ch) and bool(CJK_RE.match(ch))


def normalize_punctuation(text: str) -> str:
    """把紧邻中文的英文标点换成中文标点，并去掉中文字符之间的空格。

    规则：
    - 只替换“挨着中文”的 ASCII 标点，避免破坏英文句子与数字（3.14、Mr.）；
    - 全角标点前后不留空格；
    - 连续标点（，，、。。。）合并，减少 ASR 抖动。
    """
    chars = list(text)
    n = len(chars)
    for i, ch in enumerate(chars):
        prev = chars[i - 1] if i > 0 else ""
        nxt = chars[i + 1] if i + 1 < n else ""
        if ch == ".":
            # 保留数字小数点、英文缩写
            if (prev.isdigit() and nxt.isdigit()) or (prev.isalpha() and nxt.isalpha()):
                continue
            if is_cjk(prev) or is_cjk(nxt):
                chars[i] = "。"
            continue
        if ch not in ASCII_TO_FULL:
            continue
        if is_cjk(prev) or is_cjk(nxt):
            chars[i] = ASCII_TO_FULL[ch]
    out = "".join(chars)
    out = CJK_GAP_RE.sub(r"\1\2", out)
    out = CJK_PUNCT_GAP_RE.sub(r"\1\2", out)
    out = CJK_GAP_PUNCT_RE.sub(r"\1\2", out)
    out = re.sub(r"[ \t]+([，。！？、；：）】》”])", r"\1", out)
    out = re.sub(r"([（【《“])[ \t]+", r"\1", out)
    out = re.sub(r"(?<=[，。！？、；：])[ \t]+", "", out)
    out = MULTI_SPACE_RE.sub(" ", out)
    # 合并重复标点
    out = re.sub(r"([，。！？、；：])\1+", r"\1", out)
    out = re.sub(r"。{3,}", "。", out)
    return out.strip()


def clean_segment_text(text: str) -> str:
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = re.sub(r"\s+", " ", text).strip()
    return normalize_punctuation(text)


def join_text(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    if is_cjk(left[-1]) or is_cjk(right[0]):
        return left + right
    if left[-1] in "，。！？、；：…" or right[0] in "，。！？、；：…":
        return left + right
    return left + " " + right


def char_count(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def collapse_loops(text: str) -> str:
    """去掉模型偶尔产生的整句重复（A A A）。"""
    for _ in range(3):
        new = re.sub(r"(.{8,40}?)\1+", r"\1", text)
        if new == text:
            break
        text = new
    return text


def dedupe_segments(segments: list[dict]) -> list[dict]:
    """去掉 ASR 常见的完全重复句，以及滚动字幕造成的“上句是下句前缀”。"""
    out: list[dict] = []
    for seg in segments:
        text = clean_segment_text(seg.get("text", ""))
        if not text:
            continue
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", start))
        if end <= start:
            end = start + 0.8
        if out:
            last = out[-1]
            if text == last["text"]:
                last["end"] = max(last["end"], end)
                continue
            # 平台滚动字幕常见的“上一句是下一句前缀”
            if last["text"].endswith(text) and len(text) >= 6:
                last["end"] = max(last["end"], end)
                continue
        out.append({"start": round(start, 2), "end": round(end, 2), "text": text})
    return out


def _chunk_text(text: str, limit: int = 80) -> list[str]:
    """把过长的识别片段按标点切成短句，便于阅读和生成字幕。

    优先在句号/逗号处断开；窗口内找不到标点时按字符数硬切。
    """
    chunks: list[str] = []
    rest = text.strip()
    while len(rest) > limit:
        window = rest[: limit + 16]
        cut = -1
        for mark in "。！？!?；;，,、 ":
            pos = window.rfind(mark)
            if pos > cut:
                cut = pos
        if cut < limit * 0.55:
            cut = limit - 1
        chunks.append(rest[: cut + 1].strip())
        rest = rest[cut + 1 :].strip()
    if rest:
        chunks.append(rest)
    return [chunk for chunk in chunks if chunk]


def split_long_segments(segments: list[dict], limit: int = 60) -> list[dict]:
    """Whisper 偶尔给出 20~30 秒的长片段，按字符比例分配时间轴后切短。"""
    out: list[dict] = []
    for seg in segments:
        text = seg["text"]
        if len(text) <= int(limit * 1.4):
            out.append(seg)
            continue
        chunks = _chunk_text(text, limit)
        total = max(1, sum(len(chunk) for chunk in chunks))
        cursor = float(seg["start"])
        span = max(0.4, float(seg["end"]) - float(seg["start"]))
        for chunk in chunks:
            share = span * len(chunk) / total
            out.append(
                {
                    "start": round(cursor, 2),
                    "end": round(min(float(seg["end"]), cursor + share), 2),
                    "text": chunk,
                }
            )
            cursor += share
    return out


def build_paragraphs(segments: list[dict], max_chars: int = 120) -> list[dict]:
    """把逐句片段合并成适合阅读的段落：句末标点 + 长度 + 静音间隔共同决定断点。"""
    paragraphs: list[dict] = []
    cur: dict | None = None
    for seg in segments:
        text = seg["text"]
        if cur is None:
            cur = {"start": seg["start"], "end": seg["end"], "text": text}
            continue
        gap = seg["start"] - cur["end"]
        chars = char_count(cur["text"])
        ends = cur["text"] and cur["text"][-1] in TERMINATORS
        should_break = False
        if ends and (chars >= max_chars * 0.55 or gap >= 1.2):
            should_break = True
        if chars >= max_chars * 1.2:
            should_break = True
        if gap >= 6:
            should_break = True
        if should_break:
            paragraphs.append(cur)
            cur = {"start": seg["start"], "end": seg["end"], "text": text}
        else:
            cur["text"] = collapse_loops(join_text(cur["text"], text))
            cur["end"] = max(cur["end"], seg["end"])
    if cur:
        paragraphs.append(cur)

    cleaned: list[dict] = []
    for p in paragraphs:
        if cleaned and p["text"] == cleaned[-1]["text"]:
            cleaned[-1]["end"] = p["end"]
            continue
        cleaned.append(p)
    for p in cleaned:
        p["chars"] = char_count(p["text"])
    return cleaned


def format_timestamp(seconds: float, srt: bool = False) -> str:
    seconds = max(0.0, float(seconds))
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    if srt:
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"
    if h:
        return f"{h:d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def to_srt(segments: list[dict]) -> str:
    lines: list[str] = []
    for i, seg in enumerate(segments, 1):
        lines.append(str(i))
        lines.append(f"{format_timestamp(seg['start'], True)} --> {format_timestamp(seg['end'], True)}")
        lines.append(seg["text"])
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def to_txt(paragraphs: list[dict], with_time: bool = False) -> str:
    if with_time:
        return "\n\n".join(f"[{format_timestamp(p['start'])}] {p['text']}" for p in paragraphs)
    return "\n\n".join(p["text"] for p in paragraphs)


def text_stats(paragraphs: list[dict], segments: list[dict], duration: float) -> dict:
    text = "".join(p["text"] for p in paragraphs)
    chars = char_count(text)
    cjk_chars = len(CJK_RE.findall(text))
    latin_words = len(re.findall(r"[A-Za-z][A-Za-z'\-]*", text))
    sentences = len(re.findall(r"[。！？!?…]+", text)) or max(0, len(paragraphs))
    return {
        "chars": chars,
        "cjk_chars": cjk_chars,
        "latin_words": latin_words,
        "words": cjk_chars + latin_words,
        "sentences": sentences,
        "paragraphs": len(paragraphs),
        "segments": len(segments),
        "duration": round(float(duration or 0), 1),
    }


def build_result(
    *,
    task_id: str,
    kind: str,
    source: dict,
    segments: list[dict],
    engine: str,
    language: str,
    options: dict,
    elapsed: float,
) -> dict:
    paragraphs = build_paragraphs(segments)
    duration = source.get("duration") or (segments[-1]["end"] if segments else 0)
    return {
        "id": task_id,
        "kind": kind,
        "source": source,
        "segments": segments,
        "paragraphs": paragraphs,
        "text": to_txt(paragraphs),
        "stats": text_stats(paragraphs, segments, duration),
        "engine": engine,
        "language": language,
        "options": options,
        "elapsed": round(elapsed, 1),
    }


def to_markdown(result: dict) -> str:
    src = result.get("source") or {}
    stats = result.get("stats") or {}
    title = src.get("title") or "视频文案"
    lines = [f"# {title}", ""]
    meta = []
    if src.get("uploader"):
        meta.append(f"作者：{src['uploader']}")
    if src.get("platform_label"):
        meta.append(f"平台：{src['platform_label']}")
    if src.get("duration"):
        meta.append(f"时长：{format_timestamp(src['duration'])}")
    if src.get("url"):
        meta.append(f"链接：{src['url']}")
    if meta:
        lines.append("  \n".join(meta))
        lines.append("")
    lines.append(
        f"> 共 {stats.get('chars', 0)} 字 · {stats.get('paragraphs', 0)} 段 · "
        f"转写引擎 {result.get('engine', '-')}"
    )
    lines.append("")
    for p in result.get("paragraphs", []):
        lines.append(f"**[{format_timestamp(p['start'])}]**")
        lines.append("")
        lines.append(p["text"])
        lines.append("")
    return "\n".join(lines).strip() + "\n"
