import { useEffect, useRef, useState } from "react";

import type { ExtractOptions, Settings } from "../types";
import { ArrowRightIcon, ChevronDownIcon, LinkIcon, UploadIcon } from "./Icons";

interface ExtractorProps {
  busy: boolean;
  settings: Settings | null;
  onSubmit: (url: string, options: ExtractOptions) => void;
  onUpload: (file: File, options: ExtractOptions) => void;
  toast: (message: string) => void;
}

type Tab = "url" | "file";

/** 从 localStorage 恢复上次的选择，避免每次都要重新调 */
function initialOptions(): ExtractOptions {
  return {
    model: localStorage.getItem("fp:model") || "standard",
    language: localStorage.getItem("fp:language") || "auto",
    quality: localStorage.getItem("fp:quality") || "720",
    prefer_subtitles: (localStorage.getItem("fp:preferSubs") ?? "1") === "1",
    download_media: (localStorage.getItem("fp:downloadMedia") ?? "1") === "1",
  };
}

export function Extractor({ busy, settings, onSubmit, onUpload, toast }: ExtractorProps) {
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState<ExtractOptions>(initialOptions);
  const [dragging, setDragging] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 输入框随内容自动增高，最多 140px；粘贴长分享文案时不会只显示一行
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }, [url]);

  // 设置加载完成后，回退掉已经不在候选里的旧值
  useEffect(() => {
    if (!settings) return;
    setOptions((prev) => {
      const next = { ...prev };
      if (!settings.models.some((item) => item.key === prev.model)) next.model = settings.defaults.model;
      if (!settings.languages.some((item) => item.key === prev.language)) next.language = settings.defaults.language;
      if (!settings.qualities.some((item) => item.key === prev.quality)) next.quality = "720";
      return next;
    });
  }, [settings]);

  // 选项持久化：下次打开页面保持上次的模型/清晰度选择
  useEffect(() => {
    localStorage.setItem("fp:model", options.model);
    localStorage.setItem("fp:language", options.language);
    localStorage.setItem("fp:quality", options.quality);
    localStorage.setItem("fp:preferSubs", options.prefer_subtitles ? "1" : "0");
    localStorage.setItem("fp:downloadMedia", options.download_media ? "1" : "0");
  }, [options]);

  const update = <K extends keyof ExtractOptions>(key: K, value: ExtractOptions[K]) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const submit = () => {
    if (busy) return;
    if (!url.trim()) {
      toast("先粘贴一个视频链接吧");
      textareaRef.current?.focus();
      return;
    }
    onSubmit(url.trim(), options);
  };

  const pickFile = (file: File | undefined) => {
    if (!file || busy) return;
    // 与后端 MAX_UPLOAD_BYTES 保持一致，提前在前端拦截超大文件
    const limitMb = settings?.max_upload_mb ?? 600;
    if (file.size > limitMb * 1024 * 1024) {
      toast(`文件超过 ${limitMb} MB，请压缩或截取片段`);
      return;
    }
    onUpload(file, options);
  };

  const models = settings?.models ?? [{ key: "standard", label: "标准" }];
  const languages = settings?.languages ?? [{ key: "auto", label: "自动检测" }];
  const qualities = settings?.qualities ?? [{ key: "720", label: "720p" }];

  return (
    <section className="panel px-5 pb-5 pt-1 sm:px-6">
      {/* 链接 / 文件切换 */}
      <div role="tablist" className="flex gap-1 pt-3.5">
        {(
          [
            ["url", "链接提取"],
            ["file", "上传文件"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              if (key === "url") setTimeout(() => textareaRef.current?.focus(), 0);
            }}
            className={`rounded-[10px] px-4 py-2 text-[14px] font-medium transition ${
              tab === key
                ? "bg-slate-100 text-slate-900 shadow-[inset_0_0_0_1px_rgba(226,232,240,0.9)] dark:bg-slate-800 dark:text-slate-100 dark:shadow-[inset_0_0_0_1px_rgba(51,65,85,0.9)]"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "url" ? (
        <div className="mt-3.5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <LinkIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <textarea
                ref={textareaRef}
                rows={1}
                value={url}
                spellCheck={false}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  // Enter 直接提交，Shift+Enter 换行；输入法组合中不触发
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder="粘贴视频链接，或直接粘贴抖音 / B站的分享文案…"
                className="min-h-[58px] w-full resize-none rounded-[15px] border border-slate-300/80 bg-white px-4 py-4 pl-12 text-[15px] leading-normal text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <button type="button" className="btn-primary h-[58px] shrink-0 sm:h-auto" disabled={busy} onClick={submit}>
              <span>{busy ? "提取中…" : "开始提取"}</span>
              <ArrowRightIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-slate-400 dark:text-slate-500">
            <span className="inline-flex flex-wrap items-center gap-1">
              <kbd className="rounded border border-b-2 border-slate-300 bg-slate-100 px-1.5 py-px font-mono text-[10.5px] text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
                ⌘
              </kbd>
              <span>+</span>
              <kbd className="rounded border border-b-2 border-slate-300 bg-slate-100 px-1.5 py-px font-mono text-[10.5px] text-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Enter
              </kbd>
              <span>快速提交 · 分享文案会自动识别链接</span>
            </span>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setUrl("https://www.bilibili.com/video/BV1GJ411x7h7");
                toast("已填入示例链接，点击开始提取");
              }}
            >
              试试示例视频
            </button>
          </div>
        </div>
      ) : (
        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pickFile(event.dataTransfer.files?.[0]);
          }}
          className={`mt-3.5 flex min-h-[178px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-[1.6px] border-dashed px-5 py-8 text-center transition ${
            dragging
              ? "border-indigo-400 bg-indigo-500/10"
              : "border-slate-300 bg-slate-100/55 hover:border-indigo-400 hover:bg-indigo-500/10 dark:border-slate-700 dark:bg-slate-800/40"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.mkv,.flac,.m4a,.opus"
            className="hidden"
            onChange={(event) => {
              pickFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <span className="mb-1 grid h-[46px] w-[46px] place-items-center rounded-[14px] border border-slate-200 bg-white text-indigo-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-400">
            <UploadIcon className="h-[22px] w-[22px]" />
          </span>
          <span className="text-[14.5px] font-semibold">拖入视频或音频，或点击选择文件</span>
          <span className="text-[12.5px] text-slate-400 dark:text-slate-500">
            支持 mp4 / mov / mkv / webm / mp3 / m4a / wav / flac，最大 <b className="font-semibold text-slate-500 dark:text-slate-400">{settings?.max_upload_mb ?? 600}</b> MB · 自动生成封面与音频
          </span>
        </label>
      )}

      {/* 高级选项：默认折叠，保持首屏简洁 */}
      <details className="group mt-3.5 border-t border-slate-200 pt-3 dark:border-slate-800">
        <summary className="flex cursor-pointer list-none items-center justify-between px-0.5 py-1 text-[13px] text-slate-500 dark:text-slate-400 [&::-webkit-details-marker]:hidden">
          高级选项
          <ChevronDownIcon className="h-4 w-4 transition group-open:rotate-180" />
        </summary>

        <div className="grid gap-4 pt-3.5 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[12px] text-slate-400 dark:text-slate-500">识别语言</span>
            <select
              className="select"
              value={options.language}
              onChange={(event) => update("language", event.target.value)}
            >
              {languages.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] text-slate-400 dark:text-slate-500">模型档位</span>
            <select className="select" value={options.model} onChange={(event) => update("model", event.target.value)}>
              {models.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                  {item.hint ? ` · ${item.hint.split("·")[1]?.trim() ?? item.hint}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] text-slate-400 dark:text-slate-500">视频清晰度</span>
            <select className="select" value={options.quality} onChange={(event) => update("quality", event.target.value)}>
              {qualities.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-4 border-t border-dashed border-slate-200 pt-3.5 sm:flex-row sm:gap-10 dark:border-slate-800">
          <Switch
            checked={options.download_media}
            onChange={(checked) => update("download_media", checked)}
            title="下载视频 / 音频 / 封面"
            description="关闭后只做语音转写，更快也更省空间"
          />
          <Switch
            checked={options.prefer_subtitles}
            onChange={(checked) => update("prefer_subtitles", checked)}
            title="优先使用平台字幕"
            description="平台已带字幕时直接使用，速度更快"
          />
        </div>
      </details>
    </section>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}

/** 受控开关：用 appearance-none 把原生 checkbox 画成滑块，避免额外的 peer 选择器层级问题 */
function Switch({ checked, onChange, title, description }: SwitchProps) {
  return (
    <label className="flex flex-1 cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="relative mt-0.5 h-[22px] w-[38px] shrink-0 cursor-pointer appearance-none rounded-full bg-slate-300 transition before:absolute before:left-[3px] before:top-[3px] before:h-4 before:w-4 before:rounded-full before:bg-white before:shadow before:transition-transform checked:bg-gradient-to-br checked:from-indigo-500 checked:to-fuchsia-500 checked:before:translate-x-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/25 dark:bg-slate-600"
      />
      <span className="text-[13px] leading-snug text-slate-500 dark:text-slate-400">
        {title}
        <small className="mt-0.5 block text-[11.5px] text-slate-400 dark:text-slate-500">{description}</small>
      </span>
    </label>
  );
}
