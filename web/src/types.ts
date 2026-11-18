/** 与后端 API 对齐的类型定义（见 app/main.py 与 app/tasks.py）。 */

export type TaskStatus = "queued" | "running" | "done" | "error" | "canceled";

export type ViewMode = "text" | "timeline" | "segments";

export interface Option {
  key: string;
  label: string;
  hint?: string;
}

export interface DeviceInfo {
  device: string;
  compute_type: string;
}

/** /api/settings 的返回结构 */
export interface Settings {
  has_cookies: boolean;
  cookies_updated_at: number;
  models: Option[];
  languages: Option[];
  qualities: Option[];
  defaults: {
    model: string;
    language: string;
    prefer_subtitles: boolean;
  };
  max_upload_mb: number;
  device: DeviceInfo;
  version: string;
  ffmpeg: boolean;
}

/** 单个素材：视频 / 音频 / 封面 */
export interface Asset {
  kind: "video" | "audio" | "cover";
  ext: string;
  size: number;
  mime: string;
  filename: string;
  width?: number;
  height?: number;
}

export type Assets = Partial<Record<Asset["kind"], Asset>>;

export interface Source {
  url: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  platform: string;
  platform_label: string;
  upload_date: string;
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  repost_count: number | null;
  description: string;
  tags: string[];
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface Paragraph extends Segment {
  chars: number;
}

export interface Stats {
  chars: number;
  cjk_chars: number;
  latin_words: number;
  words: number;
  sentences: number;
  paragraphs: number;
  segments: number;
  duration: number;
}

/** 提取完成后的完整结果，用于渲染结果面板 */
export interface Result {
  id: string;
  kind: "url" | "file";
  source: Source;
  segments: Segment[];
  paragraphs: Paragraph[];
  text: string;
  stats: Stats;
  engine: string;
  language: string;
  options: Record<string, unknown>;
  elapsed: number;
  created_at?: number;
  assets?: Assets;
}

/** 最近任务列表里的精简任务 */
export interface TaskSummary {
  id: string;
  kind: "url" | "file";
  status: TaskStatus;
  progress: number;
  stage: string;
  message: string;
  title: string;
  platform_label: string;
  thumbnail: string;
  duration: number;
  chars: number;
  created_at: number;
  updated_at: number;
  error: string;
  error_hint: string;
}

export interface Task extends TaskSummary {
  url: string;
  filename: string;
  options: Record<string, unknown>;
  source: Partial<Source>;
  result: Result | null;
}

/** 前端表单选项，提交时原样发给后端 */
export interface ExtractOptions {
  model: string;
  language: string;
  quality: string;
  prefer_subtitles: boolean;
  download_media: boolean;
}

export interface TaskError {
  title: string;
  hint: string;
}
