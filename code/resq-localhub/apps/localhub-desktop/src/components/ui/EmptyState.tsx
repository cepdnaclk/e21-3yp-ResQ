import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center bg-white rounded-2xl border border-slate-100/80 shadow-[0_4px_16px_rgba(0,0,0,0.02)] max-w-lg mx-auto">
      {icon ? (
        <div className="mb-4 text-slate-300 bg-slate-50 p-4 rounded-full border border-slate-50">
          {icon}
        </div>
      ) : (
        <div className="mb-4 text-slate-300 bg-slate-50 p-4 rounded-full border border-slate-50">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
      )}
      <h3 className="text-base font-bold text-slate-700 tracking-tight leading-tight">{title}</h3>
      {description && <p className="mt-2 text-sm text-slate-400 max-w-xs leading-relaxed font-normal">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;
