import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: { label: string; onClick: () => void };
};

export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5 mb-6">
      <div className="space-y-1">
        {back && (
          <button
            type="button"
            onClick={back.onClick}
            className="group inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors mb-1.5"
          >
            <svg
              className="w-3.5 h-3.5 transform group-hover:-translate-x-0.5 transition-transform"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            {back.label}
          </button>
        )}
        <h1 className="text-2xl font-extrabold text-slate-800 tracking-tight leading-none">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-400 leading-relaxed max-w-2xl font-normal">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
          {actions}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
