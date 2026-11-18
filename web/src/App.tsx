import { useCallback, useEffect, useRef, useState } from "react";

import { Background } from "./components/Background";
import { TopBar } from "./components/TopBar";
import { Hero } from "./components/Hero";
import { Extractor } from "./components/Extractor";
import { ProgressPanel } from "./components/ProgressPanel";
import { ErrorPanel } from "./components/ErrorPanel";
import { ResultPanel } from "./components/ResultPanel";
import { RecentList } from "./components/RecentList";
import { HowItWorks } from "./components/HowItWorks";
import { Footer } from "./components/Footer";
import { SettingsDialog } from "./components/SettingsDialog";
import { Toast } from "./components/Toast";
import { api } from "./lib/api";
import { useExtraction } from "./hooks/useExtraction";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import type { ExtractOptions, Settings, TaskSummary } from "./types";

interface LastSubmission {
  url?: string;
  file?: File;
  options: ExtractOptions;
}

export default function App() {
  const { theme, toggle } = useTheme();
  const toast = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [recent, setRecent] = useState<TaskSummary[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const lastRef = useRef<LastSubmission | null>(null);
  // 只有用户主动提交/打开记录时才自动滚到结果；分享链接进来时保持顶部
  const scrollPending = useRef(false);
  const sharedHandled = useRef(false);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch {
      // 设置接口失败不影响提取，使用界面默认值即可
    }
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const data = await api.recentTasks(8);
      setRecent(data.tasks);
    } catch {
      // 历史记录加载失败属于非关键路径，静默处理
    }
  }, []);

  const ex = useExtraction({
    onFinished: (task) => {
      const chars = task.result?.stats.chars ?? 0;
      toast.show(`完成，共 ${chars.toLocaleString("zh-CN")} 字`);
      scrollPending.current = true;
    },
    onOpened: (_task, scroll) => {
      if (scroll) scrollPending.current = true;
    },
    onChanged: () => {
      void loadRecent();
    },
  });

  useEffect(() => {
    void loadSettings();
    void loadRecent();
  }, [loadRecent, loadSettings]);

  // 结果出现后滚动到结果区（仅用户主动操作时）
  useEffect(() => {
    if (!ex.result || !scrollPending.current) return;
    scrollPending.current = false;
    const timer = window.setTimeout(() => {
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [ex.result]);

  // 首次加载支持 ?task=<id> 直接打开某条结果（分享链接）。
  // 用 ref 保证只执行一次，避免 StrictMode 下重复请求。
  useEffect(() => {
    if (sharedHandled.current) return;
    sharedHandled.current = true;
    const taskId = new URLSearchParams(window.location.search).get("task");
    if (taskId) void ex.open(taskId, { scroll: false });
  }, [ex.open]);

  // 结果展示后把任务 id 写进地址栏，刷新页面或复制链接都能回到同一条结果
  useEffect(() => {
    if (!ex.result) return;
    if (new URLSearchParams(window.location.search).get("task") === ex.result.id) return;
    history.replaceState(null, "", `?task=${ex.result.id}`);
  }, [ex.result]);

  const handleSubmit = (url: string, options: ExtractOptions) => {
    lastRef.current = { url, options };
    scrollPending.current = true;
    void ex.submit(url, options);
  };

  const handleUpload = (file: File, options: ExtractOptions) => {
    lastRef.current = { file, options };
    scrollPending.current = true;
    void ex.uploadFile(file, options);
  };

  const handleRetry = () => {
    const last = lastRef.current;
    if (!last) return;
    scrollPending.current = true;
    if (last.url) void ex.submit(last.url, last.options);
    else if (last.file) void ex.uploadFile(last.file, last.options);
  };

  const handleOpen = (taskId: string) => {
    scrollPending.current = true;
    void ex.open(taskId);
  };

  const handleDelete = async () => {
    if (!ex.taskId) return;
    try {
      await ex.remove(ex.taskId);
      toast.show("已删除");
    } catch {
      toast.show("删除失败");
    }
  };

  // 上传阶段取消会中断 XHR；任务阶段取消由后端 Worker 在检查点退出
  const handleCancel = () => {
    toast.show("已发送取消请求");
    void ex.cancel();
  };

  return (
    <>
      <Background />
      <TopBar theme={theme} onToggleTheme={toggle} onOpenSettings={() => setSettingsOpen(true)} />

      <main className="mx-auto w-full max-w-[980px] px-5 pb-12 sm:px-6">
        <Hero />

        <Extractor
          busy={ex.busy}
          settings={settings}
          onSubmit={handleSubmit}
          onUpload={handleUpload}
          toast={toast.show}
        />

        {ex.busy ? (
          <ProgressPanel
            status={ex.status}
            progress={ex.progress}
            stage={ex.stage}
            message={ex.message}
            upload={ex.upload}
            onCancel={handleCancel}
          />
        ) : ex.error ? (
          <ErrorPanel error={ex.error} onRetry={handleRetry} />
        ) : ex.result ? (
          <ResultPanel result={ex.result} onDelete={handleDelete} toast={toast.show} />
        ) : null}

        <RecentList tasks={recent} onOpen={handleOpen} />
        <HowItWorks />
      </main>

      <Footer settings={settings} />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onRefresh={() => void loadSettings()}
        toast={toast.show}
      />
      <Toast message={toast.message} />
    </>
  );
}
