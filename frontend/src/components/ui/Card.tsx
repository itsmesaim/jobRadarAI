import type { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export function Card({ hoverable = false, className = "", ...props }: CardProps) {
  return <div className={`card ${hoverable ? "card-hover" : ""} ${className}`.trim()} {...props} />;
}
