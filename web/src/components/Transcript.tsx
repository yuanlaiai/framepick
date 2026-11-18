import { useState } from "react";

import type { Result, ViewMode } from "../types";
import { copyText, download } from "../lib/clipboard";
import { exportUrl, fmtTimestamp } from "../lib/format";
import { CopyIcon } from "./Icons";

interface TranscriptProps {
  result: Result;
  toast: (message: string) => void;
}

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: "text", label: "纯文本" },
  { key: "timeline", label: "时间轴" },
  { key: "segments", label: "分段" },
];

/**
 * 转写正文：三种视图 + 复制 + 导出。
 * 视图只在客户端切换，不重新请求接口；导出走后端 /file?format=。
 */
export function Transcript({ result, toast }: TranscriptProps) {
  const [view, setView] = useState<ViewMode>("text");

  const copyAll = async () => {
    const ok = await copyText(result.text);
    toast(ok ? "已复制全文" : "复制失败，请手动选择");
  };

  const downloadAs = (format: "txt" | "srt" | "md") => {
    download(exportUrl(result.id, format));
    toast("已开始下载");
  };

  return (
    <div className="mt-4 border-t border-slate-200 pt-3.5 dark:border-slate-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit gap-0.5 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800/60">
          {VIEWS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`rounded-[9px] px-3 py-1.5 text-[12.5px] transition ${
                view === item.key
                  ? "bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost" onClick={copyAll}>
            <CopyIcon className="h-4 w-4" />
            复制全文
          </button>
          {(["txt", "srt", "md"] as const).map((format) => (
            <button key={format} type="button" className="btn-ghost" onClick={() => downloadAs(format)}>
              {format === "md" ? "Markdown" : format.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <article className="mt-4 max-h-[560px] overflow-y-auto pr-2 text-[15.5px] leading-[2]">
        {view === "text" ? (
          result.paragraphs.length ? (
            result.paragraphs.map((paragraph, index) => (
              <p
                key={`${paragraph.start}-${index}`}
                className="whitespace-pre-wrap break-words rounded-[10px] px-2.5 py-1.5 transition hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
              >
                {paragraph.text}
              </p>
            ))
          ) : (
            <p className="whitespace-pre-wrap px-2.5">{result.text}</p>
          )
        ) : view === "timeline" ? (
          result.paragraphs.map((paragraph, index) => (
            <div
              key={`${paragraph.start}-${index}`}
              className="grid grid-cols-[58px_1fr] items-baseline gap-3 rounded-[10px] px-2.5 py-1.5 transition hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
            >
              <span className="select-none font-mono text-[12px] text-indigo-500 dark:text-indigo-400">
                {fmtTimestamp(paragraph.start)}
              </span>
              <span className="whitespace-pre-wrap break-words">{paragraph.text}</span>
            </div>
          ))
        ) : (
          result.segments.map((segment, index) => (
            <div
              key={`${segment.start}-${index}`}
              className="grid grid-cols-[104px_1fr] items-baseline gap-3 rounded-[10px] px-2.5 py-1.5 transition hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
            >
              <span className="select-none font-mono text-[11.5px] text-slate-400 dark:text-slate-500">
                {fmtTimestamp(segment.start)} – {fmtTimestamp(segment.end)}
              </span>
              <span className="whitespace-pre-wrap break-words">{segment.text}</span>
            </div>
          ))
        )}
      </article>
    </div>
  );
}
