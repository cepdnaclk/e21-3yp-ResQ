/**
 * CoachingCue.tsx — Large, prominent coaching message for trainees and instructors.
 * Designed for easy reading at a glance during CPR training.
 * SAFE FOR MEDICAL STAFF — shows only human-readable guidance.
 */

type CueTone = "good" | "warning" | "danger" | "neutral" | "muted";

type CoachingCueProps = {
  message: string;
  tone?: CueTone;
  size?: "md" | "lg" | "xl" | "2xl";
};

const TONE_CLASSES: Record<CueTone, { bg: string; text: string; border: string; iconBg: string }> = {
  good:    { bg: "bg-emerald-50/70", text: "text-emerald-800", border: "border-emerald-200/80", iconBg: "bg-emerald-100 text-emerald-600" },
  warning: { bg: "bg-amber-50/70", text: "text-amber-800", border: "border-amber-200/80", iconBg: "bg-amber-100 text-amber-600" },
  danger:  { bg: "bg-rose-50/70", text: "text-rose-800", border: "border-rose-200/80", iconBg: "bg-rose-100 text-rose-600" },
  neutral: { bg: "bg-blue-50/70", text: "text-blue-800", border: "border-blue-200/80", iconBg: "bg-blue-100 text-blue-600" },
  muted:   { bg: "bg-slate-50/80", text: "text-slate-600", border: "border-slate-200/60", iconBg: "bg-slate-100 text-slate-500" },
};

const SIZE_CLASSES: Record<string, string> = {
  md: "text-lg py-4.5 px-6 rounded-2xl",
  lg: "text-2xl py-6.5 px-8 rounded-2xl",
  xl: "text-3xl sm:text-4xl py-10 px-8 rounded-[24px] shadow-sm shadow-slate-100/50",
  "2xl": "text-4xl sm:text-5xl md:text-6xl py-14 px-10 rounded-[32px] shadow-lg shadow-slate-100/60",
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
      className={`relative border-2 ${cls.bg} ${cls.border} ${SIZE_CLASSES[size]} font-bold text-center ${cls.text} leading-snug flex flex-col items-center justify-center gap-3 transition-all duration-300`}
      role="status"
      aria-live="polite"
    >
      {/* Visual icon marker depending on tone */}
      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${cls.iconBg}`}>
        {resolvedTone === "good" && "✓"}
        {resolvedTone === "warning" && "!"}
        {resolvedTone === "danger" && "⚠"}
        {resolvedTone === "neutral" && "ℹ"}
        {resolvedTone === "muted" && "◷"}
      </div>
      
      <span className="tracking-tight max-w-xl">{message}</span>
    </div>
  );
}

export default CoachingCue;
