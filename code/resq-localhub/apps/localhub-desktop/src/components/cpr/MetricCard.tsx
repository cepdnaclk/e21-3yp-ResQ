type MetricCardProps = {
  label: string;
  value: string;
  status?: string;
  unit?: string;
  tone?: "good" | "warning" | "danger" | "neutral";
  target?: string;
  large?: boolean;
  subtitle?: string;
};

const TONE_COLORS: Record<string, string> = {
  good: "text-[#22C55E]",
  warning: "text-[#F59E0B]",
  danger: "text-[#EF4444]",
  neutral: "text-[#64748B]",
};

const TONE_BG: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50/10",
  warning: "border-amber-200 bg-amber-50/10",
  danger: "border-rose-200 bg-rose-50/10",
  neutral: "border-slate-200 bg-white",
};

export function MetricCard({
  label,
  value,
  status,
  unit,
  tone = "neutral",
  target,
  large = false,
  subtitle,
}: MetricCardProps) {
  return (
    <div
      className={`rounded-2xl border p-5 flex flex-col justify-between gap-3.5 transition-all duration-300 ${TONE_BG[tone]} shadow-[0_1px_3px_rgba(0,0,0,0.02)]`}
    >
      <div>
        <div className="flex justify-between items-start">
          <span className="text-[11px] font-extrabold text-slate-400 uppercase tracking-wider block">
            {label}
          </span>
          {status && (
            <span
              className={`text-[9px] font-extrabold uppercase tracking-wide border px-2.5 py-0.5 rounded-full ${TONE_COLORS[tone]} ${
                tone === "good"
                  ? "border-emerald-200 bg-emerald-100/40 text-emerald-800"
                  : tone === "warning"
                  ? "border-amber-200 bg-amber-100/40 text-amber-800"
                  : tone === "danger"
                  ? "border-rose-200 bg-rose-100/40 text-rose-800"
                  : "border-slate-200 bg-slate-50 text-slate-600"
              }`}
            >
              {status}
            </span>
          )}
        </div>

        {subtitle && (
          <span className="text-[10px] text-slate-400 font-semibold leading-normal block mt-1">
            {subtitle}
          </span>
        )}

        <div className="flex items-baseline gap-0.5 mt-3">
          <span
            className={`font-black tracking-tight text-slate-800 ${
              large ? "text-2xl" : "text-xl"
            }`}
          >
            {value}
          </span>
          {unit && (
            <span className="text-[10px] font-extrabold text-slate-400 ml-1 uppercase">{unit}</span>
          )}
        </div>
      </div>

      {target && (
        <div className="border-t border-slate-100 pt-2.5 mt-1 flex items-center justify-between text-[9px] text-slate-400 font-bold tracking-wide uppercase">
          <span>Target Range:</span>
          <span className="text-slate-600 font-extrabold">{target}</span>
        </div>
      )}
    </div>
  );
}

export default MetricCard;
