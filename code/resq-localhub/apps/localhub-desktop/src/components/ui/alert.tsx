import React from "react";
import { cn } from "./cn";

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "danger" | "info";
  title?: string;
  detail?: React.ReactNode;
};

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant = "default", title, detail, children, ...props }, ref) => {
  const variantCls = variant === "danger" ? "alert--danger" : undefined;
  return (
    <div ref={ref} role="alert" className={cn("alert", variantCls, className)} {...props}>
      {children ?? (
        <>
          {title ? <p className="alert__title">{title}</p> : null}
          {detail ? <p className="alert__detail">{detail}</p> : null}
        </>
      )}
    </div>
  );
});

Alert.displayName = "Alert";

export default Alert;
