import React from "react";
import { cn } from "./cn";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  size?: "sm" | "md" | "lg";
};

export function Skeleton({ className, size = "md", ...props }: SkeletonProps) {
  const sizeCls = size === "sm" ? "skeleton--h40" : size === "lg" ? "skeleton--h120" : "skeleton--h40";
  return <div className={cn("skeleton", sizeCls, className)} aria-hidden="true" {...props} />;
}

export default Skeleton;
