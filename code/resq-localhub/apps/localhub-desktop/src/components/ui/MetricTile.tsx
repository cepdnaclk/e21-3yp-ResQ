import type { ReactNode } from "react";

type MetricTileProps = {
  label: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
  tone?: "blue" | "teal" | "green" | "yellow" | "slate";
};

const TONE_CLASSES = {
  blue:   "border-t-4 border-t-blue-500",
  teal:   "border-t-4 border-t-teal-500",
  green:  "border-t-4 border-t-emerald-500",
  yellow: "border-t-4 border-t-amber-500",
  slate:  "border-t-4 border-t-slate-400",
};

const TONE_VALUE_COLORS = {
  blue:   "text-blue-600",
  teal:   "text-teal-600",
  green:  "text-emerald-600",
  yellow: "text-amber-600",
  slate:  "text-slate-700",
};

export function MetricTile({
  label,
  value,
  description,
  icon,
  tone = "slate",
}: MetricTileProps) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-100/80 shadow-[0_4px_12px_rgba(0,0,0,0.02)] p-5 flex flex-col gap-1 transition-all duration-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 ${TONE_CLASSES[tone]}`}
    >
      <div className="flex items-center justify-between gap-3 text-slate-400">
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
        {icon && <div className="shrink-0">{icon}</div>}
      </div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className={`text-3xl font-extrabold tracking-tight ${TONE_VALUE_COLORS[tone]}`}>
          {value}
        </span>
      </div>
      {description && (
        <span className="text-xs text-slate-400 font-normal leading-relaxed mt-0.5">{description}</span>
      )}
    </div>
  );
}

export default MetricTile;
