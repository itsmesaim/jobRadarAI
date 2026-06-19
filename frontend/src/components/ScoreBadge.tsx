interface Props {
  score: number | null;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ score, size = "sm" }: Props) {
  if (score === null) {
    return (
      <span
        style={{
          color: "var(--text-muted)",
          fontFamily: "monospace",
          fontSize: size === "lg" ? 24 : 13,
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
          ? "#f97316"
          : "var(--danger)";

  const bg =
    score >= 8
      ? "var(--success-bg)"
      : score >= 6
        ? "var(--warning-bg)"
        : score >= 4
          ? "#fff7ed"
          : "var(--danger-bg)";

  const fontSize = size === "lg" ? 22 : size === "md" ? 16 : 12;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 1,
        background: bg,
        color,
        padding: size === "lg" ? "4px 10px" : "2px 7px",
        borderRadius: 6,
        fontFamily: "monospace",
        fontWeight: 600,
        fontSize,
        whiteSpace: "nowrap",
      }}
    >
      {score}
      <span
        style={{ fontSize: fontSize * 0.75, fontWeight: 400, opacity: 0.7 }}
      >
        /10
      </span>
    </span>
  );
}
