import type { ExtractOptions, Settings, Task, TaskSummary } from "../types";

/** 带用户提示的 API 异常：message 给标题，hint 给修复建议 */
export class ApiError extends Error {
  hint: string;
  status: number;

  constructor(message: string, hint: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.hint = hint;
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const raw = await response.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    // 后端错误统一是 { detail: { message, hint } }，兼容纯字符串 detail
    const detail = (data as { detail?: unknown } | null)?.detail;
    if (detail && typeof detail === "object") {
      const payload = detail as { message?: string; hint?: string };
      throw new ApiError(payload.message || "请求失败", payload.hint || "", response.status);
    }
    throw new ApiError(typeof detail === "string" ? detail : `请求失败（${response.status}）`, "", response.status);
  }
  return data as T;
}

export interface CreateTaskResponse {
  ok: boolean;
  id: string;
  task: TaskSummary;
}

export const api = {
  settings: () => request<Settings>("/api/settings"),

  createTask: (payload: { url: string } & Record<string, unknown>) =>
    request<CreateTaskResponse>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  getTask: (id: string) => request<Task>(`/api/tasks/${id}`),

  cancelTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: "POST" }),

  deleteTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: "DELETE" }),

  recentTasks: (limit = 8) => request<{ tasks: TaskSummary[] }>(`/api/tasks?limit=${limit}`),

  saveCookies: (text: string) =>
    request<{ ok: boolean; lines: number }>("/api/settings/cookies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),

  clearCookies: () => request<{ ok: boolean }>("/api/settings/cookies", { method: "DELETE" }),
};

/**
 * 上传本地音视频。使用 XHR 而不是 fetch，因为需要 upload.onprogress 显示上传百分比。
 */
export function uploadTask(
  file: File,
  options: ExtractOptions,
  onProgress: (percent: number, loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CreateTaskResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("model", String(options.model ?? "standard"));
    form.append("language", String(options.language ?? "auto"));
    form.append("prefer_subtitles", String(options.prefer_subtitles ?? true));
    form.append("download_media", String(options.download_media ?? true));
    form.append("quality", String(options.quality ?? "720"));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/tasks/upload");

    // 取消上传时中止 XHR，避免继续占用带宽
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100), event.loaded, event.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText || "null");
      } catch {
        data = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve(data as CreateTaskResponse);
        return;
      }
      const detail = (data as { detail?: { message?: string; hint?: string } } | null)?.detail;
      reject(new ApiError(detail?.message || "上传失败", detail?.hint || "", xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("上传失败", "网络中断，请重试。", 0));
    xhr.send(form);
  });
}
