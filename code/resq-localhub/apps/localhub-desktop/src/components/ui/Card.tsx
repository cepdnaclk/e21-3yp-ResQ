import React, { type ReactNode } from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md" | "lg";
};

const PADDING = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = "", padding = "md", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`bg-white rounded-2xl border border-slate-100 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05),0_10px_20px_-8px_rgba(0,0,0,0.02)] transition-all duration-300 ${PADDING[padding]} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";

type CardHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
};

export function CardHeader({ title, subtitle, action, className = "" }: CardHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-5 ${className}`}>
      <div>
        <h2 className="text-base font-bold text-slate-800 tracking-tight leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-1 font-normal leading-relaxed">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export default Card;
