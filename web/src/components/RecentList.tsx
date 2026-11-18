import type { TaskSummary } from "../types";
import { fmtDuration, fmtRelative } from "../lib/format";

interface RecentListProps {
  tasks: TaskSummary[];
  onOpen: (taskId: string) => void;
}

/** 最近提取：只展示完成/进行中/失败的任务，点击恢复结果或进度。 */
export function RecentList({ tasks, onOpen }: RecentListProps) {
  const visible = tasks.filter((task) => ["done", "running", "error"].includes(task.status)).slice(0, 8);

  return (
    <section id="recent" className="mt-12 scroll-mt-20">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold">最近提取</h3>
        <span className="text-[12px] text-slate-400 dark:text-slate-500">
          {visible.length ? `共 ${visible.length} 条` : ""}
        </span>
      </div>

      {visible.length ? (
        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((task) => {
            const meta = [
              task.chars ? `${task.chars.toLocaleString("zh-CN")} 字` : "",
              task.duration ? fmtDuration(task.duration) : "",
              task.status === "error" ? "失败" : task.status === "running" ? "处理中" : "",
            ].filter(Boolean);

            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpen(task.id)}
                className="flex min-h-[96px] flex-col gap-2 rounded-2xl border border-slate-200 bg-white/75 p-3.5 text-left transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:hover:border-slate-700"
              >
                <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-400 dark:text-slate-500">
                  <span>{task.platform_label || (task.kind === "file" ? "本地文件" : "视频")}</span>
                  <span>{fmtRelative(task.created_at)}</span>
                </div>
                <div className="line-clamp-2 text-[14px] font-semibold leading-snug">{task.title || "未命名任务"}</div>
                <div className="mt-auto flex gap-2 text-[11.5px] text-slate-400 dark:text-slate-500">
                  {meta.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="py-4 text-[13px] text-slate-400 dark:text-slate-500">
          还没有记录。粘贴一个链接，或者点上面的示例视频试试。
        </p>
      )}
    </section>
  );
}
