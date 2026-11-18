import type { Settings } from "../types";

interface FooterProps {
  settings: Settings | null;
}

export function Footer({ settings }: FooterProps) {
  const device = settings?.device?.device ?? "cpu";
  return (
    <footer className="mx-auto flex max-w-[980px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-5 py-10 text-center text-[12px] text-slate-400 dark:text-slate-500">
      <span>帧采 FramePick</span>
      <span className="opacity-60">·</span>
      <span>本地运行 · 音视频与文案只保存在你的电脑上</span>
      <span className="opacity-60">·</span>
      <span>faster-whisper · {device}</span>
    </footer>
  );
}
