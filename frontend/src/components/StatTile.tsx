import type { ReactNode } from "react";

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "success" | "warning" | "accent";
  highlight?: boolean;
  onClick?: () => void;
}

export function StatTile({ label, value, hint, tone, highlight, onClick }: Props) {
  const className = `dash-metric${onClick ? " is-clickable" : ""}${highlight ? " is-highlight" : ""}`;
  const valueClassName = `dash-metric-value${tone ? ` is-${tone}` : ""}`;

  const content = (
    <>
      <span className="dash-metric-label">{label}</span>
      <span className={valueClassName}>{value}</span>
      {hint && <span className="dash-metric-hint">{hint}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
