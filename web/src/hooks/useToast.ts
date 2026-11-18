import { useCallback, useEffect, useRef, useState } from "react";

/** 单条 toast 提示，2.2 秒后自动消失；同一时间只显示一条。 */
export function useToast(): { message: string | null; show: (text: string) => void } {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const show = useCallback((text: string) => {
    setMessage(text);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return { message, show };
}
