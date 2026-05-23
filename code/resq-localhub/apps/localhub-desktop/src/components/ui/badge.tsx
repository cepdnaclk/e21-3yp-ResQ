import React from "react";
import { cn } from "./cn";

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "count" | "status";
};

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant = "default", children, ...props }, ref) => {
  const base = variant === "count" ? "device-badge" : "status-badge";
  return (
    <span ref={ref} className={cn(base, className)} {...props}>
      {children}
    </span>
  );
});

Badge.displayName = "Badge";

export default Badge;
