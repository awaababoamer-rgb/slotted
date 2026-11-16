// Small inline icons (no icon library needed).
type IconProps = { className?: string };

const base = {
  fill: "none", stroke: "currentColor", strokeWidth: 2,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
};

export const CalendarIcon = ({ className = "size-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18M8 14h3" />
  </svg>
);

export const LockIcon = ({ className = "size-4", open = false }: IconProps & { open?: boolean }) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    {open ? <path d="M8 11V7a4 4 0 0 1 7.5-2" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
  </svg>
);

export const WarningIcon = ({ className = "size-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const CheckCircleIcon = ({ className = "size-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
);

export const CloseIcon = ({ className = "size-4" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const CopyIcon = ({ className = "size-4" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </svg>
);

export const ShuffleIcon = ({ className = "size-5" }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...base}>
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);
