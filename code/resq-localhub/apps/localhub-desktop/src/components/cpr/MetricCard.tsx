/**
 * MetricCard.tsx — Displays a single live CPR metric (depth, rate, recoil).
 * SAFE FOR MEDICAL STAFF — no debug data is rendered here.
 */

type MetricCardProps = {
  label: string;
  value: string;
  unit?: string;
  tone?: "good" | "warning" | "danger" | "neutral";
  target?: string;
  large?: boolean;
};

const TONE_COLORS: Record<string, string> = {
  good:    "text-green-600",
  warning: "text-yellow-600",
  danger:  "text-red-600",
  neutral: "text-gray-700",
};

const TONE_BG: Record<string, string> = {
  good:    "bg-green-50 border-green-100",
  warning: "bg-yellow-50 border-yellow-100",
  danger:  "bg-red-50 border-red-100",
  neutral: "bg-gray-50 border-gray-100",
};

export function MetricCard({
  label,
  value,
  unit,
  tone = "neutral",
  target,
  large = false,
}: MetricCardProps) {
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${TONE_BG[tone]}`}>
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-bold ${large ? "text-4xl" : "text-2xl"} ${TONE_COLORS[tone]}`}
        >
          {value}
        </span>
        {unit && (
          <span className="text-sm text-gray-500">{unit}</span>
        )}
      </div>
      {target && (
        <span className="text-xs text-gray-400">Target: {target}</span>
      )}
    </div>
  );
}
