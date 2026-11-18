import type { Result } from "../types";
import { fmtCount, fmtDuration, fmtSize, prettyEngine } from "../lib/format";

interface InfoDetailsProps {
  result: Result;
}

/** 折叠的「视频信息」表：元数据、互动数据、文件体积。 */
export function InfoDetails({ result }: InfoDetailsProps) {
  const source = result.source;
  const assets = result.assets ?? {};
  const rows: [string, string][] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    rows.push([label, String(value)]);
  };

  add("平台", source.platform_label);
  add("作者", source.uploader);
  add("发布时间", source.upload_date);
  add("时长", source.duration ? fmtDuration(source.duration) : "");
  if (assets.video?.width) add("分辨率", `${assets.video.width} × ${assets.video.height}`);
  add("播放", fmtCount(source.view_count));
  add("点赞", fmtCount(source.like_count));
  add("评论", fmtCount(source.comment_count));
  add("转发", fmtCount(source.repost_count));
  add("视频大小", assets.video ? fmtSize(assets.video.size) : "");
  add("音频大小", assets.audio ? fmtSize(assets.audio.size) : "");
  add("转写模型", prettyEngine(result.engine));
  add("识别语言", result.language);

  if (!rows.length && !source.url) return null;

  return (
    <details className="group mt-3.5 border-t border-dashed border-slate-200 pt-2.5 dark:border-slate-800">
      <summary className="cursor-pointer list-none py-1 text-[12.5px] text-slate-500 before:mr-1.5 before:inline-block before:text-slate-400 before:transition before:content-['▸'] group-open:before:rotate-90 dark:text-slate-400 dark:before:text-slate-500 [&::-webkit-details-marker]:hidden">
        视频信息
      </summary>
      <dl className="mt-2.5 grid gap-2 sm:grid-cols-2 sm:gap-x-6">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 pb-1.5 text-[12px] dark:border-slate-800"
          >
            <dt className="shrink-0 text-slate-400 dark:text-slate-500">{label}</dt>
            <dd className="truncate text-slate-500 dark:text-slate-400">{value}</dd>
          </div>
        ))}
        {source.url ? (
          <div className="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 pb-1.5 text-[12px] dark:border-slate-800">
            <dt className="shrink-0 text-slate-400 dark:text-slate-500">原链接</dt>
            <dd className="truncate">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-indigo-500 hover:underline dark:text-indigo-400"
              >
                {source.url}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}
