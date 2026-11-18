import { MoonIcon, SettingsIcon, SunIcon } from "./Icons";
import type { Theme } from "../hooks/useTheme";

interface TopBarProps {
  theme: Theme;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

/** 顶部导航：品牌、最近提取锚点、主题切换、设置入口。 */
export function TopBar({ theme, onToggleTheme, onOpenSettings }: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-[#f5f6fb]/72 backdrop-blur-xl backdrop-saturate-150 dark:bg-[#080a11]/72">
      <div className="mx-auto flex max-w-[1120px] items-center justify-between gap-4 px-5 py-3.5 sm:px-7">
        <a href="/" className="flex items-center gap-2.5">
          <img
            src="/logo-mark.svg"
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] rounded-[11px] shadow-[0_8px_18px_-8px_rgba(99,102,241,0.9)]"
          />
          <span className="flex items-baseline gap-2 text-[16px] font-bold tracking-tight">
            帧采
            <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
              FramePick
            </span>
          </span>
        </a>

        <nav className="flex items-center gap-1.5">
          <a
            href="#recent"
            className="hidden rounded-[10px] px-3 py-2 text-[13px] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 sm:block dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            最近提取
          </a>
          <button
            type="button"
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"}
            title={theme === "dark" ? "浅色模式" : "深色模式"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="设置" title="设置">
            <SettingsIcon />
          </button>
        </nav>
      </div>
    </header>
  );
}
