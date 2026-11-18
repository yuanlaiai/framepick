import type { TaskStatus } from "../types";
import { CheckIcon } from "./Icons";

interface ProgressPanelProps {
  status: TaskStatus | null;
  progress: number;
  stage: string;
  message: string;
  upload: { percent: number } | null;
  onCancel: () => void;
}

/** 阶段 → 步骤下标；后端 stage 文案改动时只需要同步这里 */
const STAGE_STEPS = [
  ["解析链接"],
  ["获取字幕", "下载视频", "下载音频", "提取音频", "生成封面", "处理音频", "上传文件"],
  ["语音识别"],
  ["整理文案", "完成"],
];

const LABELS = ["解析链接", "下载素材", "语音识别", "整理文案"];

function stepIndex(stage: string): number {
  return STAGE_STEPS.findIndex((names) => names.some((name) => stage.includes(name)));
}

export function ProgressPanel({ status, progress, stage, message, upload, onCancel }: ProgressPanelProps) {
  const current = stepIndex(stage);
  const percent = Math.max(0, Math.min(100, progress));

  return (
    <section className="panel animate-rise mt-4 px-6 py-5" aria-live="polite">
      <div className="flex items-center gap-3.5">
        <span className="h-[22px] w-[22px] shrink-0 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-indigo-500 dark:border-slate-700 dark:border-t-indigo-400" />
        <div className="min-w-0 flex-1">
          <strong className="block text-[15px]">{status === "queued" ? "排队中" : stage || "处理中"}</strong>
          <span className="mt-0.5 block truncate text-[12.5px] text-slate-500 dark:text-slate-400">{message}</span>
        </div>
        <span className="font-mono text-[20px] font-semibold text-indigo-500 dark:text-indigo-400">{percent}%</span>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
        <div
          className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        >
          <span className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {LABELS.map((label, index) => {
          const done = current >= 0 && index < current;
          const active = current >= 0 && index === current;
          return (
            <li
              key={label}
              className={`flex items-center gap-2 text-[12.5px] ${
                active
                  ? "font-medium text-slate-900 dark:text-slate-100"
                  : done
                    ? "text-slate-500 dark:text-slate-400"
                    : "text-slate-400 dark:text-slate-500"
              }`}
            >
              <i
                className={`grid h-[17px] w-[17px] place-items-center rounded-full border text-[10px] not-italic transition ${
                  done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : active
                      ? "border-indigo-500 text-transparent ring-4 ring-indigo-500/10"
                      : "border-slate-300 text-transparent dark:border-slate-600"
                }`}
              >
                <CheckIcon className="h-2.5 w-2.5" />
              </i>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-slate-400 dark:text-slate-500">
          {status === "queued" ? "正在处理其他任务，马上轮到你…" : upload ? `上传进度 ${upload.percent}%` : ""}
        </span>
        <button type="button" className="link-btn text-rose-500 hover:bg-rose-500/10" onClick={onCancel}>
          取消任务
        </button>
      </div>
    </section>
  );
}
