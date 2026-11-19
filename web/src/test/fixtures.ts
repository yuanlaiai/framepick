import type { Result, Settings } from "../types";

/** 结果面板/轮询测试共用的样例数据 */
export const sampleResult: Result = {
  id: "task-1",
  kind: "url",
  source: {
    url: "https://www.bilibili.com/video/BV1test",
    title: "测试视频",
    uploader: "测试作者",
    thumbnail: "",
    duration: 125,
    platform: "bilibili",
    platform_label: "B站",
    upload_date: "2026-01-02",
    view_count: 12345,
    like_count: 678,
    comment_count: 12,
    repost_count: 3,
    description: "这是一段发布文案 #测试",
    tags: ["测试", "视频"],
  },
  segments: [
    { start: 0, end: 5, text: "第一句话。" },
    { start: 5, end: 12, text: "第二句话。" },
  ],
  paragraphs: [
    { start: 0, end: 5, text: "第一句话。", chars: 5 },
    { start: 5, end: 12, text: "第二句话。", chars: 5 },
  ],
  text: "第一句话。\n\n第二句话。",
  stats: {
    chars: 1234,
    cjk_chars: 1200,
    latin_words: 34,
    words: 1234,
    sentences: 2,
    paragraphs: 2,
    segments: 2,
    duration: 12,
  },
  engine: "whisper-small",
  language: "zh",
  options: {},
  elapsed: 12.3,
  created_at: 1700000000,
  assets: {
    video: { kind: "video", ext: "mp4", size: 1048576, mime: "video/mp4", filename: "测试视频.mp4", width: 1280, height: 720 },
    audio: { kind: "audio", ext: "mp3", size: 204800, mime: "audio/mpeg", filename: "测试视频.mp3" },
    cover: { kind: "cover", ext: "jpg", size: 51200, mime: "image/jpeg", filename: "测试视频.jpg" },
  },
};

export const sampleSettings: Settings = {
  has_cookies: false,
  cookies_updated_at: 0,
  models: [
    { key: "fast", label: "极速", hint: "base · 最快" },
    { key: "standard", label: "标准", hint: "small · 平衡" },
  ],
  languages: [
    { key: "auto", label: "自动检测" },
    { key: "zh", label: "中文" },
  ],
  qualities: [
    { key: "720", label: "720p" },
    { key: "1080", label: "1080p" },
  ],
  defaults: { model: "standard", language: "auto", prefer_subtitles: true },
  max_upload_mb: 600,
  device: { device: "mps", compute_type: "float16" },
  version: "1.0.0",
  ffmpeg: true,
};
