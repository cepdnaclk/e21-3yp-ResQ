import React from "react";
import { cn } from "./cn";

export type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  role?: string;
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => {
  return (
    <div ref={ref} className={cn("card", className)} {...props} />
  );
});

Card.displayName = "Card";

export default Card;
