import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

function initialTheme(): Theme {
  // 支持 ?theme=dark 强制预览，其次读本地偏好，最后跟随系统
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  if (fromUrl === "dark" || fromUrl === "light") return fromUrl;
  const saved = localStorage.getItem("fp:theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 主题状态：把 class="dark" 挂在 <html> 上，Tailwind 的 dark: 变体据此生效。 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("fp:theme", theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
