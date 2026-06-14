import React from "react";
import { cn } from "./cn";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
    const base = "inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97] select-none";
    
    const variantCls = {
      primary: "bg-teal-600 hover:bg-teal-700 text-white shadow-sm shadow-teal-500/10 border border-transparent focus:ring-teal-500",
      secondary: "bg-white hover:bg-gray-50 text-gray-700 border border-gray-200/80 shadow-sm shadow-gray-100/50",
      ghost: "hover:bg-gray-100/80 text-gray-600 border border-transparent",
      danger: "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-sm shadow-red-500/10 border border-transparent",
      success: "bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-sm shadow-emerald-500/10 border border-transparent",
    }[variant];

    const sizeCls = {
      sm: "px-3.5 py-1.5 text-xs tracking-wide",
      md: "px-4.5 py-2 text-sm tracking-wide",
      lg: "px-6 py-3 text-base tracking-wide rounded-2xl",
    }[size];

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variantCls, sizeCls, className)}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2.5 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
