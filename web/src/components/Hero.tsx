const PLATFORMS = [
  { name: "抖音", status: "ok" },
  { name: "B站", status: "ok" },
  { name: "YouTube", status: "ok" },
  { name: "TikTok", status: "ok" },
  { name: "小红书", status: "beta" },
  { name: "快手", status: "beta" },
  { name: "本地文件", status: "ok" },
] as const;

/** 首屏：一句主张 + 支持平台，不做数据请求。 */
export function Hero() {
  return (
    <section className="px-1 pb-9 pt-14 text-center sm:pt-16">
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-[12.5px] font-medium text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
        <span className="relative flex h-[7px] w-[7px]">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-emerald-500" />
        </span>
        视频 · 音频 · 文案 · 封面，一次拿全
      </div>

      <h1 className="mt-5 text-[clamp(34px,5.4vw,56px)] font-extrabold leading-[1.14] tracking-[-0.035em]">
        一个分享链接
        <br />
        <em className="bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 bg-clip-text not-italic text-transparent">
          拿走全部素材
        </em>
      </h1>

      <p className="mx-auto mt-4 max-w-[620px] text-[15px] leading-[1.85] text-slate-500 sm:text-[16px] dark:text-slate-400">
        粘贴抖音、B站、YouTube 链接，自动下载视频、提取音轨与封面，并把语音转成带标点的文案。
        素材、字幕、信息表，打包就能用。
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {PLATFORMS.map((platform) => (
          <span
            key={platform.name}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 px-3 py-1.5 text-[12.5px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400"
          >
            <i
              className={`h-1.5 w-1.5 rounded-full ${
                platform.status === "ok" ? "bg-emerald-500" : "bg-amber-400"
              }`}
            />
            {platform.name}
          </span>
        ))}
      </div>
    </section>
  );
}
