import React from "react";
import { cn } from "./cn";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    const base = "button";
    const variantCls =
      variant === "primary"
        ? "button--primary"
        : variant === "secondary"
        ? "button--secondary"
        : "button--ghost";

    return <button ref={ref} className={cn(base, variantCls, className)} {...props} />;
  }
);

Button.displayName = "Button";

export default Button;
