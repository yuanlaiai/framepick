const STEPS = [
  {
    num: "01",
    title: "解析链接",
    body: "yt-dlp 读取标题、作者、发布文案、标签与封面，分享文案里的链接会自动识别。",
  },
  {
    num: "02",
    title: "下载素材",
    body: "视频按清晰度合并为 MP4，音轨转成 MP3，封面缓存到本地，可单独或打包下载。",
  },
  {
    num: "03",
    title: "本地转写",
    body: "平台有字幕直接用；没有就 ffmpeg 解码 + faster-whisper 在本机推理，音频不上传。",
  },
  {
    num: "04",
    title: "整理导出",
    body: "自动补标点、断句分段、去重复，导出 TXT / SRT / Markdown，或一键打包全部素材。",
  },
];

export function HowItWorks() {
  return (
    <section className="mt-14">
      <h3 className="text-[15px] font-semibold tracking-wide">它是怎么工作的</h3>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div key={step.num} className="border-t border-slate-200 pt-4 dark:border-slate-800">
            <span className="font-mono text-[11.5px] tracking-[0.08em] text-indigo-500 dark:text-indigo-400">
              {step.num}
            </span>
            <h4 className="mt-2 text-[14.5px] font-semibold">{step.title}</h4>
            <p className="mt-1.5 text-[13px] leading-[1.75] text-slate-500 dark:text-slate-400">{step.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
