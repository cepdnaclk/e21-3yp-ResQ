type Tone = "success" | "info" | "warning" | "danger" | "muted";

type StatusBadgeProps = {
  tone?: Tone;
  label: string;
  dot?: boolean;
  className?: string;
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-emerald-50 text-emerald-700 border-emerald-100",
  info:    "bg-sky-50 text-sky-700 border-sky-100",
  warning: "bg-amber-50/80 text-amber-700 border-amber-100/70",
  danger:  "bg-rose-50 text-rose-700 border-rose-100",
  muted:   "bg-slate-50 text-slate-600 border-slate-200/80",
};

const DOT_TONE: Record<Tone, string> = {
  success: "bg-emerald-500 shadow-sm shadow-emerald-500/30",
  info:    "bg-sky-500 shadow-sm shadow-sky-500/30",
  warning: "bg-amber-500 shadow-sm shadow-amber-500/30",
  danger:  "bg-rose-500 shadow-sm shadow-rose-500/30",
  muted:   "bg-slate-400",
};

export function StatusBadge({ tone = "muted", label, dot = true, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${TONE_CLASSES[tone]} ${className} select-none`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_TONE[tone]} ${
            tone === "success" || tone === "info" ? "animate-pulse" : ""
          }`}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}

export default StatusBadge;
