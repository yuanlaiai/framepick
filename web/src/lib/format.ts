/** 展示层格式化工具：时长、时间戳、体积、计数、引擎名。 */

import type { Paragraph } from "../types";

export function fmtDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 时间轴/字幕用的 mm:ss（超过 1 小时带小时位） */
export function fmtTimestamp(seconds: number): string {
  return fmtDuration(seconds);
}

export function fmtClock(ts: number): string {
  return new Date((ts || 0) * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 最近记录用的相对时间 */
export function fmtRelative(ts: number): string {
  const diff = Date.now() / 1000 - (ts || 0);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `今天 ${fmtClock(ts)}`;
  if (diff < 172800) return `昨天 ${fmtClock(ts)}`;
  return new Date(ts * 1000).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function fmtSize(bytes: number | undefined | null): string {
  const n = Number(bytes) || 0;
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function fmtCount(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

export function prettyEngine(engine: string | null | undefined): string {
  if (!engine) return "";
  if (engine === "platform-subtitles") return "平台字幕";
  const match = /^whisper-(.+)$/.exec(engine);
  return match ? `Whisper ${match[1]}` : engine;
}

/** 下载地址：?download=1 让后端返回 attachment，而不是 inline 播放 */
export function assetUrl(taskId: string, kind: string): string {
  return `/api/tasks/${taskId}/asset/${kind}?download=1`;
}

export function packageUrl(taskId: string): string {
  return `/api/tasks/${taskId}/package`;
}

export function exportUrl(taskId: string, format: string): string {
  return `/api/tasks/${taskId}/file?format=${encodeURIComponent(format)}`;
}

export function captionText(title: string | undefined, description: string | undefined, tags: string[] | undefined): string {
  const tagLine = (tags || [])
    .map((tag) => (String(tag).startsWith("#") ? String(tag) : `#${tag}`))
    .join(" ");
  return [title, description, tagLine]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** 段落视图的展示文本（与后端 to_txt 逻辑一致） */
export function paragraphsText(paragraphs: Paragraph[]): string {
  return paragraphs.map((p) => p.text).join("\n\n");
}
