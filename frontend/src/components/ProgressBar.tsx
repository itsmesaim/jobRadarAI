interface Props {
  pct: number;
  color?: string;
}

export function ProgressBar({ pct, color = "var(--accent)" }: Props) {
  return (
    <div className="progress-bar">
      <span style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
    </div>
  );
}
