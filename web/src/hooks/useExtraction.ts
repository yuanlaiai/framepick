import { useCallback, useEffect, useRef, useState } from "react";

import { api, ApiError, uploadTask } from "../lib/api";
import type { ExtractOptions, Result, Task, TaskError, TaskStatus } from "../types";

interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

export interface ExtractionState {
  taskId: string | null;
  status: TaskStatus | null;
  progress: number;
  stage: string;
  message: string;
  result: Result | null;
  error: TaskError | null;
  /** 提交/轮询/上传期间为 true，用于禁用按钮 */
  busy: boolean;
  upload: UploadProgress | null;
}

export interface ExtractionApi extends ExtractionState {
  submit: (url: string, options: ExtractOptions) => Promise<void>;
  uploadFile: (file: File, options: ExtractOptions) => Promise<void>;
  cancel: () => Promise<void>;
  /** 打开一条已有任务（历史记录 / 分享链接） */
  open: (taskId: string, options?: { scroll?: boolean }) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
}

interface Callbacks {
  onFinished?: (task: Task) => void;
  onOpened?: (task: Task, scroll: boolean) => void;
  onChanged?: () => void;
}

const INITIAL: ExtractionState = {
  taskId: null,
  status: null,
  progress: 0,
  stage: "",
  message: "",
  result: null,
  error: null,
  busy: false,
  upload: null,
};

function toError(err: unknown): TaskError {
  if (err instanceof ApiError) return { title: err.message, hint: err.hint };
  if (err instanceof Error) return { title: err.message || "出错啦", hint: "" };
  return { title: "出错啦", hint: "" };
}

/**
 * 任务提交与轮询的状态机。
 *
 * 后端是「创建任务 → 后台 Worker 处理 → 前端轮询」的模式，所以这里：
 * - submit / uploadFile 只负责创建任务并启动轮询；
 * - poll 每 900ms 拉一次 /api/tasks/{id}，直到 done / error / canceled；
 * - 组件卸载时停止轮询，避免内存泄漏。
 */
export function useExtraction(callbacks: Callbacks = {}): ExtractionApi {
  const [state, setState] = useState<ExtractionState>(INITIAL);

  const timer = useRef<number | null>(null);
  const mounted = useRef(true);
  const uploadAbort = useRef<AbortController | null>(null);
  // 回调放进 ref，避免调用方每次渲染都重建轮询函数
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopPolling();
      uploadAbort.current?.abort();
    };
  }, [stopPolling]);

  const fail = useCallback((err: unknown) => {
    setState((prev) => ({ ...prev, busy: false, upload: null, error: toError(err) }));
  }, []);

  /** 拉取一次任务状态，并根据终态收尾 */
  const poll = useCallback(
    (taskId: string) => {
      stopPolling();

      const tick = async () => {
        try {
          const task = await api.getTask(taskId);
          if (!mounted.current) return;

          setState((prev) => ({
            ...prev,
            taskId,
            status: task.status,
            progress: task.progress,
            stage: task.stage,
            message: task.message,
            upload: null,
          }));

          if (task.status === "done") {
            stopPolling();
            setState((prev) => ({
              ...prev,
              result: task.result,
              busy: false,
              progress: 100,
              stage: "完成",
              error: null,
            }));
            cbRef.current.onFinished?.(task);
            cbRef.current.onChanged?.();
          } else if (task.status === "error") {
            stopPolling();
            setState((prev) => ({
              ...prev,
              busy: false,
              error: { title: task.error || "提取失败", hint: task.error_hint },
            }));
            cbRef.current.onChanged?.();
          } else if (task.status === "canceled") {
            stopPolling();
            setState((prev) => ({ ...prev, busy: false, status: "canceled" }));
            cbRef.current.onChanged?.();
          }
        } catch (err) {
          stopPolling();
          if (mounted.current) fail(err);
        }
      };

      void tick();
      timer.current = window.setInterval(() => void tick(), 900);
    },
    [fail, stopPolling],
  );

  const submit = useCallback(
    async (url: string, options: ExtractOptions) => {
      stopPolling();
      setState({
        ...INITIAL,
        status: "queued",
        progress: 1,
        stage: "提交任务",
        message: "正在创建提取任务…",
        busy: true,
      });
      try {
        const data = await api.createTask({ url, ...options });
        setState((prev) => ({ ...prev, taskId: data.id }));
        poll(data.id);
      } catch (err) {
        fail(err);
      }
    },
    [fail, poll, stopPolling],
  );

  const uploadFile = useCallback(
    async (file: File, options: ExtractOptions) => {
      stopPolling();
      uploadAbort.current = new AbortController();
      setState({
        ...INITIAL,
        status: "queued",
        progress: 2,
        stage: "上传文件",
        message: `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`,
        busy: true,
        upload: { percent: 0, loaded: 0, total: file.size },
      });

      try {
        const data = await uploadTask(file, options, (percent, loaded, total) => {
          if (!mounted.current) return;
          setState((prev) => ({
            ...prev,
            progress: Math.max(2, Math.round(percent * 0.08)),
            message: `正在上传 ${percent}% · ${(loaded / 1048576).toFixed(1)} MB`,
            upload: { percent, loaded, total },
          }));
        }, uploadAbort.current.signal);
        setState((prev) => ({ ...prev, taskId: data.id }));
        poll(data.id);
      } catch (err) {
        if (uploadAbort.current?.signal.aborted) {
          setState((prev) => ({ ...prev, busy: false, upload: null, status: "canceled" }));
        } else {
          fail(err);
        }
      } finally {
        uploadAbort.current = null;
      }
    },
    [fail, poll, stopPolling],
  );

  const cancel = useCallback(async () => {
    // 上传阶段直接中断 XHR，任务阶段交给后端取消接口
    if (uploadAbort.current) {
      uploadAbort.current.abort();
      return;
    }
    const taskId = state.taskId;
    if (!taskId) return;
    try {
      await api.cancelTask(taskId);
      setState((prev) => ({ ...prev, message: "已发送取消请求…" }));
    } catch (err) {
      fail(err);
    }
  }, [fail, state.taskId]);

  const open = useCallback(
    async (taskId: string, options?: { scroll?: boolean }) => {
      stopPolling();
      try {
        const task = await api.getTask(taskId);
        if (!mounted.current) return;

        if (task.status === "done" && task.result) {
          setState({
            ...INITIAL,
            taskId: task.id,
            status: "done",
            progress: 100,
            stage: "完成",
            result: task.result,
            busy: false,
          });
          cbRef.current.onOpened?.(task, options?.scroll !== false);
          return;
        }
        if (task.status === "queued" || task.status === "running") {
          setState({
            ...INITIAL,
            taskId: task.id,
            status: task.status,
            progress: task.progress,
            stage: task.stage,
            message: task.message,
            busy: true,
          });
          poll(task.id);
          return;
        }
        setState({
          ...INITIAL,
          taskId: task.id,
          status: task.status,
          busy: false,
          error: {
            title: task.error || (task.status === "canceled" ? "任务已取消" : "任务失败"),
            hint: task.error_hint,
          },
        });
      } catch (err) {
        fail(err);
      }
    },
    [fail, poll, stopPolling],
  );

  const remove = useCallback(
    async (taskId: string) => {
      await api.deleteTask(taskId);
      if (state.taskId === taskId) {
        stopPolling();
        setState(INITIAL);
      }
      cbRef.current.onChanged?.();
    },
    [state.taskId, stopPolling],
  );

  return { ...state, submit, uploadFile, cancel, open, remove };
}
