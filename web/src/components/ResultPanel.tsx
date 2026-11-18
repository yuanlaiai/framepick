import { useState } from "react";

import type { Result } from "../types";
import { fmtClock, fmtDuration } from "../lib/format";
import { CaptionCard } from "./CaptionCard";
import { InfoDetails } from "./InfoDetails";
import { MediaBlock } from "./MediaBlock";
import { Transcript } from "./Transcript";
import { TrashIcon } from "./Icons";

interface ResultPanelProps {
  result: Result;
  onDelete: () => void;
  toast: (message: string) => void;
}

/** 结果面板：来源信息 → 素材预览 → 数据 → 发布文案 → 转写 → 详细信息。 */
export function ResultPanel({ result, onDelete, toast }: ResultPanelProps) {
  const source = result.source;
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = Boolean(source.thumbnail) && !thumbFailed;

  const stats = [
    [Number(result.stats.chars || 0).toLocaleString("zh-CN"), "字"],
    [result.stats.paragraphs || 0, "段"],
    [fmtDuration(result.stats.duration || 0), "时长"],
    [`${Math.round(result.elapsed || 0)}s`, "处理耗时"],
  ] as const;

  const generatedAt = result.created_at ? fmtClock(result.created_at) : fmtClock(Date.now() / 1000);

  const remove = () => {
    if (window.confirm("删除这条提取记录？对应的文案和素材缓存会一起清除。")) onDelete();
  };

  return (
    <section id="result" className="panel animate-rise mt-4 px-5 py-5 sm:px-6">
      <div className="flex gap-4">
        <div className="relative grid h-[70px] w-[124px] shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-[11px] tracking-[0.1em] text-white/90 dark:border-slate-800">
          {showThumb ? (
            <img
              src={source.thumbnail}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setThumbFailed(true)}
            />
          ) : (
            result.kind === "file" ? "本地文件" : "视频"
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-indigo-500/10 px-2.5 py-[3px] text-[11px] font-semibold text-indigo-500 dark:text-indigo-400">
              {source.platform_label || (result.kind === "file" ? "本地文件" : "视频")}
            </span>
            {result.engine ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-[3px] text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {result.engine === "platform-subtitles" ? "平台字幕" : result.engine.replace(/^whisper-/, "Whisper ")}
              </span>
            ) : null}
          </div>

          <h2 className="mt-2 break-words text-[18px] font-semibold leading-snug tracking-tight">
            {source.title || "视频文案"}
          </h2>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px] text-slate-400 dark:text-slate-500">
            {source.uploader ? <span>{source.uploader}</span> : null}
            {source.upload_date ? <span>{source.upload_date}</span> : null}
            {source.duration ? <span>{fmtDuration(source.duration)}</span> : null}
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-indigo-500 hover:underline dark:text-indigo-400"
              >
                查看原视频
              </a>
            ) : null}
          </div>
        </div>

        <div className="ml-auto flex flex-col items-end gap-2">
          <span className="whitespace-nowrap font-mono text-[11.5px] text-slate-400 dark:text-slate-500">
            生成于 {generatedAt}
          </span>
          <button
            type="button"
            onClick={remove}
            aria-label="删除这条记录"
            title="删除这条记录"
            className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-500 dark:text-slate-500"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <MediaBlock result={result} />

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-2xl bg-slate-100/70 px-3.5 py-3 dark:bg-slate-800/40">
            <b className="block text-[20px] font-semibold tracking-tight tabular-nums">{value}</b>
            <span className="text-[11.5px] text-slate-400 dark:text-slate-500">{label}</span>
          </div>
        ))}
      </div>

      <CaptionCard source={source} toast={toast} />
      <Transcript result={result} toast={toast} />
      <InfoDetails result={result} />
    </section>
  );
}
