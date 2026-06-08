import * as React from "react";
import { cn } from "./cn";

export type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
};

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800",
          className
        )}
        {...props}
      >
        <div
          className="h-full w-full flex-1 bg-[#005A9C] transition-all duration-300"
          style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value))}%)` }}
        />
      </div>
    );
  }
);

Progress.displayName = "Progress";

export default Progress;
