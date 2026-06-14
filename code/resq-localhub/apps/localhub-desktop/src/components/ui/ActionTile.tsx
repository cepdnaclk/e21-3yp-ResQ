import type { ReactNode } from "react";

type ActionTileProps = {
  title: string;
  description: string;
  onClick: () => void;
  icon?: ReactNode;
  badge?: ReactNode;
  variant?: "primary" | "secondary";
};

export function ActionTile({
  title,
  description,
  onClick,
  icon,
  badge,
  variant = "secondary",
}: ActionTileProps) {
  const baseStyle = "group text-left p-6 rounded-2xl border border-slate-100 bg-white transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(15,23,42,0.06)] cursor-pointer active:scale-[0.98] select-none";
  
  const iconBg = variant === "primary" ? "bg-teal-50 text-teal-600 border border-teal-100/30" : "bg-slate-50 text-slate-600 border border-slate-100";

  return (
    <button type="button" onClick={onClick} className={baseStyle}>
      <div className="flex items-start justify-between gap-4">
        {icon && (
          <div className={`p-3.5 rounded-xl shrink-0 transition-transform group-hover:scale-105 ${iconBg}`}>
            {icon}
          </div>
        )}
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      
      <div className="mt-5 space-y-1">
        <h3 className="text-base font-bold text-slate-800 tracking-tight group-hover:text-teal-600 transition-colors flex items-center gap-1.5 leading-none">
          {title}
          <svg className="w-3.5 h-3.5 transform group-hover:translate-x-0.5 opacity-0 group-hover:opacity-100 transition-all text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </h3>
        <p className="text-xs text-slate-400 font-normal leading-relaxed">
          {description}
        </p>
      </div>
    </button>
  );
}

export default ActionTile;
