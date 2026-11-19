import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../lib/api";
import { useExtraction } from "./useExtraction";
import { sampleResult } from "../test/fixtures";
import type { Task } from "../types";

// 只替换会发网络请求的方法，ApiError 等实现保持真实
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      createTask: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      deleteTask: vi.fn(),
    },
  };
});

const doneTask: Task = {
  id: "task-1",
  kind: "url",
  status: "done",
  progress: 100,
  stage: "完成",
  message: "",
  title: "测试视频",
  platform_label: "B站",
  thumbnail: "",
  duration: 12,
  chars: 1234,
  created_at: 1,
  updated_at: 1,
  error: "",
  error_hint: "",
  url: "",
  filename: "",
  options: {},
  source: {},
  result: sampleResult,
};

const options = {
  model: "standard",
  language: "auto",
  quality: "720",
  prefer_subtitles: true,
  download_media: true,
};

describe("useExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("打开已完成任务时直接渲染结果", async () => {
    vi.mocked(api.getTask).mockResolvedValue(doneTask);

    const { result } = renderHook(() => useExtraction());
    await act(async () => {
      await result.current.open("task-1", { scroll: false });
    });

    expect(result.current.result?.id).toBe("task-1");
    expect(result.current.busy).toBe(false);
    expect(result.current.progress).toBe(100);
  });

  it("提交任务并轮询到完成", async () => {
    vi.mocked(api.createTask).mockResolvedValue({ ok: true, id: "task-1", task: doneTask });
    vi.mocked(api.getTask)
      .mockResolvedValueOnce({ ...doneTask, status: "running", progress: 40, stage: "下载视频", result: null })
      .mockResolvedValue(doneTask);

    const onFinished = vi.fn();
    const { result } = renderHook(() => useExtraction({ onFinished }));

    await act(async () => {
      await result.current.submit("https://example.com/v", options);
    });

    await waitFor(() => expect(result.current.result?.id).toBe("task-1"), { timeout: 4000 });
    expect(api.createTask).toHaveBeenCalledWith({ url: "https://example.com/v", ...options });
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it("取消任务会调用后端取消接口", async () => {
    vi.mocked(api.createTask).mockResolvedValue({ ok: true, id: "task-1", task: doneTask });
    vi.mocked(api.getTask).mockResolvedValue({
      ...doneTask,
      status: "running",
      progress: 20,
      result: null,
    });
    vi.mocked(api.cancelTask).mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useExtraction());
    await act(async () => {
      await result.current.submit("https://example.com/v", options);
    });
    await waitFor(() => expect(result.current.taskId).toBe("task-1"));

    await act(async () => {
      await result.current.cancel();
    });
    expect(api.cancelTask).toHaveBeenCalledWith("task-1");
  });
});
