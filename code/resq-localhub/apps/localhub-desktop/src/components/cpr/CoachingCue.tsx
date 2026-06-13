/**
 * CoachingCue.tsx — Large, prominent coaching message for trainees and instructors.
 * Designed for easy reading at a glance during CPR training.
 * SAFE FOR MEDICAL STAFF — shows only human-readable guidance.
 */

type CueTone = "good" | "warning" | "danger" | "neutral" | "muted";

type CoachingCueProps = {
  message: string;
  tone?: CueTone;
  size?: "md" | "lg" | "xl";
};

const TONE_CLASSES: Record<CueTone, { bg: string; text: string; border: string }> = {
  good:    { bg: "bg-green-50", text: "text-green-800", border: "border-green-200" },
  warning: { bg: "bg-yellow-50", text: "text-yellow-800", border: "border-yellow-200" },
  danger:  { bg: "bg-red-50", text: "text-red-800", border: "border-red-200" },
  neutral: { bg: "bg-blue-50", text: "text-blue-800", border: "border-blue-200" },
  muted:   { bg: "bg-gray-50", text: "text-gray-600", border: "border-gray-200" },
};

const SIZE_CLASSES: Record<string, string> = {
  md: "text-xl py-5 px-6",
  lg: "text-2xl py-7 px-8",
  xl: "text-3xl py-10 px-10",
};

function getToneFromMessage(message: string): CueTone {
  const lower = message.toLowerCase();
  if (lower.includes("good") || lower.includes("keep it up") || lower.includes("excellent")) return "good";
  if (lower.includes("waiting") || lower.includes("ended") || lower.includes("signal")) return "muted";
  if (lower.includes("need") || lower.includes("support") || lower.includes("error")) return "danger";
  return "warning";
}

export function CoachingCue({ message, tone, size = "lg" }: CoachingCueProps) {
  const resolvedTone = tone ?? getToneFromMessage(message);
  const cls = TONE_CLASSES[resolvedTone];

  return (
    <div
      className={`rounded-2xl border-2 ${cls.bg} ${cls.border} ${SIZE_CLASSES[size]} font-bold text-center ${cls.text} leading-snug`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
