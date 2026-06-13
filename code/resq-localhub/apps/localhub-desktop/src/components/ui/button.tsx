import React from "react";
import { cn } from "./cn";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
    const base = "inline-flex items-center justify-center font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]";
    
    const variantCls = {
      primary: "bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 border border-transparent shadow-sm",
      secondary: "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 focus:ring-blue-500 shadow-sm",
      ghost: "hover:bg-gray-100 text-gray-600 focus:ring-gray-400 border border-transparent",
      danger: "bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 border border-transparent shadow-sm",
      success: "bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 border border-transparent shadow-sm",
    }[variant];

    const sizeCls = {
      sm: "px-3 py-1.5 text-xs",
      md: "px-4 py-2 text-sm",
      lg: "px-5 py-2.5 text-base",
    }[size];

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(base, variantCls, sizeCls, className)}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
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
