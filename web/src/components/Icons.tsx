/** 统一的线性图标，全部使用 currentColor，便于跟随主题与按钮状态。 */

interface IconProps {
  className?: string;
}

const base = "h-[1em] w-[1em]";

export function LinkIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10.5 13.5a4.2 4.2 0 0 0 6 0l2.6-2.6a4.2 4.2 0 0 0-6-6l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M13.5 10.5a4.2 4.2 0 0 0-6 0l-2.6 2.6a4.2 4.2 0 0 0 6 6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ArrowRightIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 12h13M13 6.5l5.5 5.5L13 17.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function UploadIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 16V4.5M12 4.5 7.5 9M12 4.5 16.5 9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 15v3.2A1.8 1.8 0 0 0 6.3 20h11.4a1.8 1.8 0 0 0 1.8-1.8V15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function DownloadIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 4v11m0 0 4.2-4.2M12 15l-4.2-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 18.5h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CopyIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15.5 5.5H6.9A2.4 2.4 0 0 0 4.5 7.9v8.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.9-1.4-1.9-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14.2 2h-4.4l-.3 2.1A7.6 7.6 0 0 0 6.9 5.6l-2.3-.9L2.7 8l1.9 1.5a7.7 7.7 0 0 0 0 3l-1.9 1.4 1.9 3.4 2.3-.9c.8.6 1.7 1.1 2.6 1.4l.3 2.2h4.4l.3-2.2c1-.3 1.8-.8 2.6-1.4l2.3.9 1.9-3.4-1.9-1.4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MusicIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M9 18V6.5l9-2v11" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <circle cx="6.8" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="15.8" cy="15.5" r="2.6" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

export function VideoIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="6" width="12.5" height="12" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="m16 10.5 4-2.3v7.6l-4-2.3" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function ImageIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.4" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.8" cy="9.6" r="1.7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m5 17 4.5-4.2 3.2 2.8 3-2.4L19 17" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function PackageIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2V8.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M4 8.2 12 12.4l8-4.2M12 12.4V20" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ className = "h-[1em] w-[1em]" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7M7.5 7l.8 11.2a1.6 1.6 0 0 0 1.6 1.5h4.2a1.6 1.6 0 0 0 1.6-1.5L16.5 7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SparkIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 3.5l1.7 4.8L18.5 10l-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7L12 3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
