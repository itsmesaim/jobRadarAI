interface Props {
  score: number | null;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ score, size = "sm" }: Props) {
  const dims = { sm: 12, md: 14, lg: 22 }[size];
  const padding = { sm: "3px 8px", md: "5px 11px", lg: "6px 14px" }[size];

  if (score === null) {
    return (
      <span
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: dims,
          padding,
          border: "1px dashed var(--border)",
          borderRadius: 7,
          display: "inline-block",
        }}
      >
        —
      </span>
    );
  }

  const color =
    score >= 8
      ? "var(--success)"
      : score >= 6
        ? "var(--warning)"
        : score >= 4
          ? "#ea580c"
          : "var(--danger)";

  const bg =
    score >= 8
      ? "var(--success-bg)"
      : score >= 6
        ? "var(--warning-bg)"
        : score >= 4
          ? "#fff7ed"
          : "var(--danger-bg)";

  const border =
    score >= 8
      ? "var(--success-border)"
      : score >= 6
        ? "var(--warning-border)"
        : score >= 4
          ? "#fed7aa"
          : "var(--danger-border)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 2,
        background: bg,
        color,
        border: `1px solid ${border}`,
        padding,
        borderRadius: 7,
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: dims,
        whiteSpace: "nowrap",
      }}
    >
      {score}
      <span style={{ fontSize: dims * 0.7, fontWeight: 500, opacity: 0.65 }}>
        /10
      </span>
    </span>
  );
}
