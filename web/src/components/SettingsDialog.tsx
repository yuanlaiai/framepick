import { useEffect, useRef, useState } from "react";

import type { Settings } from "../types";
import { api } from "../lib/api";
import { CloseIcon } from "./Icons";

interface SettingsDialogProps {
  open: boolean;
  settings: Settings | null;
  onClose: () => void;
  onRefresh: () => void;
  toast: (message: string) => void;
}

/** 设置弹窗：cookies（可选）+ 运行环境信息。 */
export function SettingsDialog({ open, settings, onClose, onRefresh, toast }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [cookies, setCookies] = useState("");
  const [saving, setSaving] = useState(false);

  // 用原生 <dialog> 获得焦点陷阱、Esc 关闭与遮罩能力，不需要额外弹窗库
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const save = async () => {
    if (!cookies.trim()) {
      toast("先粘贴 cookies 内容");
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveCookies(cookies);
      setCookies("");
      toast(`已保存 ${result.lines} 行 cookies`);
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      await api.clearCookies();
      toast("已清除 cookies");
      onRefresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "清除失败");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        // 点击遮罩关闭（dialog 自身是点击目标的空白区域）
        if (event.target === dialogRef.current) onClose();
      }}
      className="m-auto w-[min(560px,92vw)] max-h-[84vh] overflow-hidden rounded-[20px] border-0 bg-white p-0 text-slate-900 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.55)] backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h3 className="text-[16px] font-semibold">设置</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
          <CloseIcon />
        </button>
      </div>

      <div className="max-h-[calc(84vh-64px)] overflow-y-auto px-5 py-4">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2.5">
            <h4 className="text-[13.5px] font-semibold">平台 Cookies</h4>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                settings?.has_cookies
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
              }`}
            >
              {settings?.has_cookies ? "已导入" : "未导入"}
            </span>
          </div>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            抖音、小红书默认免登录解析；只有遇到会员视频、1080P 权限限制或平台风控时才需要。
            推荐用浏览器扩展导出 Netscape 格式，也支持 JSON。
          </p>
          <textarea
            value={cookies}
            onChange={(event) => setCookies(event.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={"# Netscape HTTP Cookie File\n.douyin.com\tTRUE\t/\tFALSE\t0\tsessionid\txxxx"}
            className="w-full resize-y rounded-[11px] border border-slate-300 bg-white px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-slate-900 outline-none focus:border-indigo-400 focus:ring-3 focus:ring-indigo-500/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
          <div className="mt-2.5 flex gap-2">
            <button type="button" className="btn-ghost" onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存 Cookies"}
            </button>
            <button type="button" className="btn-ghost" onClick={clear}>
              清除
            </button>
          </div>
        </div>

        <div>
          <h4 className="mb-1.5 text-[13.5px] font-semibold">运行环境</h4>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              ["推理设备", `${settings?.device?.device ?? "-"} / ${settings?.device?.compute_type ?? "-"}`],
              ["ffmpeg", settings?.ffmpeg === false ? "未安装" : "可用"],
              ["上传上限", `${settings?.max_upload_mb ?? 600} MB`],
              ["版本", `v${settings?.version ?? "1.0.0"}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 pb-1.5 text-[12.5px] dark:border-slate-800"
              >
                <dt className="text-slate-400 dark:text-slate-500">{label}</dt>
                <dd className="font-mono text-[11.5px] text-slate-500 dark:text-slate-400">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400 dark:text-slate-500">
          素材与文案只写入本机 <code className="rounded bg-slate-100 px-1 py-px font-mono dark:bg-slate-800">data/</code>
          目录；除解析链接与下载音视频外，不会把内容发送到第三方。
        </p>
      </div>
    </dialog>
  );
}
