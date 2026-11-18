import type { Source } from "../types";
import { copyText } from "../lib/clipboard";
import { captionText } from "../lib/format";

interface CaptionCardProps {
  source: Source;
  toast: (message: string) => void;
}

/** 平台发布文案 + 话题标签；标题本身不重复展示正文。 */
export function CaptionCard({ source, toast }: CaptionCardProps) {
  const description = (source.description || "").trim();
  const tags = (source.tags || []).filter(Boolean);
  if (!description && !tags.length) return null;

  const copy = async () => {
    const ok = await copyText(captionText(source.title, description, tags));
    toast(ok ? "已复制发布文案" : "复制失败，请手动选择");
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-100/55 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="mb-2 flex items-center justify-between gap-2.5">
        <h4 className="text-[12.5px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">平台文案</h4>
        <button type="button" className="link-btn" onClick={copy}>
          复制发布文案
        </button>
      </div>
      {description ? (
        <p className="whitespace-pre-wrap text-[13.5px] leading-[1.8] text-slate-700 dark:text-slate-200">{description}</p>
      ) : (
        <p className="text-[13.5px] text-slate-400 dark:text-slate-500">（平台没有提供发布文案）</p>
      )}
      {tags.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11.5px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
            >
              {String(tag).startsWith("#") ? tag : `#${tag}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
