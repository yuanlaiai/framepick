import { useState } from "react";

import type { Asset, Assets, Result } from "../types";
import { assetUrl, fmtSize, packageUrl } from "../lib/format";
import { download } from "../lib/clipboard";
import { DownloadIcon, ImageIcon, MusicIcon, PackageIcon, VideoIcon } from "./Icons";

interface MediaBlockProps {
  result: Result;
}

const ASSET_META: Record<Asset["kind"], { label: string; icon: typeof VideoIcon }> = {
  video: { label: "视频", icon: VideoIcon },
  audio: { label: "音频", icon: MusicIcon },
  cover: { label: "封面", icon: ImageIcon },
};

function AssetCard({ icon: Icon, name, size, onClick }: { icon: typeof VideoIcon; name: string; size: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-w-[172px] flex-1 items-center gap-2.5 rounded-[13px] border border-slate-200 bg-slate-100/70 px-3 py-2.5 text-left transition hover:-translate-y-px hover:border-slate-300 hover:bg-white hover:shadow-sm dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700 dark:hover:bg-slate-800"
    >
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-slate-200 bg-white text-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-400">
        <Icon className="h-[17px] w-[17px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold">{name}</span>
        <span className="block text-[11px] text-slate-400 dark:text-slate-500">{size || "点击下载"}</span>
      </span>
      <span className="ml-auto text-slate-400 transition group-hover:text-indigo-500 dark:text-slate-500 dark:group-hover:text-indigo-400">
        <DownloadIcon />
      </span>
    </button>
  );
}

/**
 * 素材预览区：
 * - 有视频：内嵌播放器（封面作为 poster）；
 * - 只有音频：封面作为主视觉展示；
 * - 音频统一带封面专辑图与原生播放器。
 */
export function MediaBlock({ result }: MediaBlockProps) {
  // assets 是后端按「视频 / 音频 / 封面」登记的素材表；旧任务可能为空
  const assets: Assets = result.assets ?? {};
  const id = result.id;
  const [coverFailed, setCoverFailed] = useState(false);
  const coverSrc = assets.cover ? `/api/tasks/${id}/asset/cover` : "";
  const hasVideo = Boolean(assets.video);
  const hasAudio = Boolean(assets.audio);
  const hasCover = Boolean(assets.cover);

  if (!Object.keys(assets).length) return null;

  return (
    <div className="mt-4">
      {hasVideo ? (
        <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-[#06080f] dark:border-slate-800">
          <video
            key={id}
            controls
            playsInline
            preload="metadata"
            poster={coverSrc || undefined}
            src={`/api/tasks/${id}/asset/video`}
            className="block max-h-[420px] w-auto max-w-full bg-black"
          />
        </div>
      ) : hasCover && !coverFailed ? (
        <div className="flex justify-center overflow-hidden rounded-2xl border border-slate-200 bg-[#06080f] dark:border-slate-800">
          <img
            src={coverSrc}
            alt="视频封面"
            className="block max-h-[420px] max-w-full object-contain"
            onError={() => setCoverFailed(true)}
          />
        </div>
      ) : null}

      {hasAudio ? (
        <div className="mt-3 flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-slate-100/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
          <div className="relative grid h-[88px] w-[88px] shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white/85 dark:border-slate-700">
            {hasCover && !coverFailed ? (
              <img src={coverSrc} alt="" className="absolute inset-0 h-full w-full object-cover" onError={() => setCoverFailed(true)} />
            ) : (
              <MusicIcon className="h-6 w-6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2.5">
              <span className="text-[12.5px] font-semibold">音频 · {assets.audio?.ext.toUpperCase()}</span>
              <span className="font-mono text-[11.5px] text-slate-400 dark:text-slate-500">{fmtSize(assets.audio?.size)}</span>
            </div>
            {/* key={id} 让切换任务时重建 audio 元素，自动停止上一段播放 */}
            <audio key={id} controls preload="metadata" src={`/api/tasks/${id}/asset/audio`} className="mt-2 h-10 w-full" />
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2.5">
        {(Object.keys(ASSET_META) as Asset["kind"][]).map((kind) => {
          const asset = assets[kind];
          if (!asset) return null;
          const meta = ASSET_META[kind];
          // assetUrl 带 ?download=1，强制浏览器按附件下载而不是直接播放
          return (
            <AssetCard
              key={kind}
              icon={meta.icon}
              name={`${meta.label} · ${asset.ext.toUpperCase()}`}
              size={fmtSize(asset.size)}
              onClick={() => download(assetUrl(id, kind))}
            />
          );
        })}
        <AssetCard
          icon={PackageIcon}
          name="全部素材 · ZIP"
          size={fmtSize(
            (assets.video?.size ?? 0) + (assets.audio?.size ?? 0) + (assets.cover?.size ?? 0) || undefined,
          )}
          onClick={() => download(packageUrl(id))}
        />
      </div>
    </div>
  );
}
