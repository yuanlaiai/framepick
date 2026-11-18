import type { TaskError } from "../types";

interface ErrorPanelProps {
  error: TaskError;
  onRetry: () => void;
}

export function ErrorPanel({ error, onRetry }: ErrorPanelProps) {
  return (
    <section className="panel animate-rise mt-4 flex items-center gap-4 px-5 py-5 sm:px-6">
      <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[13px] bg-rose-500/10 text-rose-500">
        <svg viewBox="0 0 24 24" fill="none" className="h-[22px] w-[22px]" aria-hidden="true">
          <path d="M12 8v5M12 16.5v.3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold">{error.title || "提取失败"}</h3>
        {error.hint ? (
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{error.hint}</p>
        ) : null}
      </div>
      <button type="button" className="btn-ghost" onClick={onRetry}>
        重试
      </button>
    </section>
  );
}
