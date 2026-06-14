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
  good:    "text-emerald-600",
  warning: "text-amber-600",
  danger:  "text-rose-600",
  neutral: "text-slate-700",
};

const TONE_BG: Record<string, string> = {
  good:    "bg-emerald-50/40 border-emerald-100/80 shadow-[0_4px_16px_rgba(16,185,129,0.02)]",
  warning: "bg-amber-50/40 border-amber-100/80 shadow-[0_4px_16px_rgba(245,158,11,0.02)]",
  danger:  "bg-rose-50/40 border-rose-100/80 shadow-[0_4px_16px_rgba(244,63,94,0.02)]",
  neutral: "bg-slate-50/60 border-slate-100 shadow-[0_4px_16px_rgba(0,0,0,0.01)]",
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
    <div className={`rounded-2xl border p-5 flex flex-col justify-between gap-2.5 transition-all duration-300 ${TONE_BG[tone]}`}>
      <div>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">{label}</span>
        <div className="flex items-baseline gap-1 mt-2">
          <span
            className={`font-extrabold tracking-tight ${large ? "text-4xl" : "text-2xl"} ${TONE_COLORS[tone]}`}
          >
            {value}
          </span>
          {unit && (
            <span className="text-xs font-semibold text-slate-400 ml-1">{unit}</span>
          )}
        </div>
      </div>
      {target && (
        <div className="border-t border-slate-100/50 pt-2.5 mt-1.5 flex items-center justify-between text-[10px] text-slate-400 font-semibold tracking-wide uppercase">
          <span>Target Range:</span>
          <span className="text-slate-600 font-bold">{target}</span>
        </div>
      )}
    </div>
  );
}

export default MetricCard;
