interface ToastProps {
  message: string | null;
}

/** 底部居中提示，由 useToast 控制生命周期。 */
export function Toast({ message }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-7 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-white/10 bg-[#10131f] px-4.5 py-2.5 text-[13px] text-white shadow-[0_16px_40px_-18px_rgba(0,0,0,0.7)] transition-all duration-300 ${
        message ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      {message}
    </div>
  );
}
