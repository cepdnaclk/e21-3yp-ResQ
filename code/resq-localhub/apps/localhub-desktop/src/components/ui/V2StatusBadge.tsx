/**
 * V2StatusBadge.tsx — Status indicator badge for device states/connection.
 * Uses Tailwind classes directly.
 */
type Tone = "success" | "info" | "warning" | "danger" | "muted";

type StatusBadgeProps = {
  tone?: Tone;
  label: string;
  dot?: boolean;
};

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-green-100 text-green-800 border-green-200",
  info:    "bg-blue-100 text-blue-800 border-blue-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  danger:  "bg-red-100 text-red-800 border-red-200",
  muted:   "bg-gray-100 text-gray-600 border-gray-200",
};

const DOT_TONE: Record<Tone, string> = {
  success: "bg-green-500",
  info:    "bg-blue-500",
  warning: "bg-yellow-500",
  danger:  "bg-red-500",
  muted:   "bg-gray-400",
};

export function StatusBadge({ tone = "muted", label, dot = true }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${TONE_CLASSES[tone]}`}
    >
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_TONE[tone]} ${
            tone === "info" ? "animate-pulse" : ""
          }`}
          aria-hidden="true"
        />
      )}
      {label}
    </span>
  );
}
