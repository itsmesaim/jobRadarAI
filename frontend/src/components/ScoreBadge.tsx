interface Props {
  score: number | null;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const TEXT_XS = 12; // floor — nothing in the app renders smaller than this

export function ScoreBadge({ score, size = "sm", loading = false }: Props) {
  const dims = { sm: 12, md: 14, lg: 22 }[size];
  const suffixSize = Math.max(TEXT_XS, dims * 0.7);
  const padding = { sm: "3px 8px", md: "5px 11px", lg: "6px 14px" }[size];

  if (loading) {
    return (
      <span
        className="score-badge-loading"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          color: "var(--accent)",
          fontFamily: "var(--font-mono)",
          fontSize: Math.max(TEXT_XS, dims * 0.85),
          fontWeight: 600,
          padding,
          border: "1px solid var(--accent-light)",
          background: "var(--accent-light)",
          borderRadius: "var(--radius-sm)",
        }}
      >
        <span className="score-badge-spinner" style={{ width: dims * 0.7, height: dims * 0.7 }} />
        Rating…
      </span>
    );
  }

  if (score === null) {
    return (
      <span
        style={{
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: Math.max(TEXT_XS, dims),
          padding,
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius-sm)",
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
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        fontSize: Math.max(TEXT_XS, dims),
        whiteSpace: "nowrap",
      }}
    >
      {score}
      <span style={{ fontSize: suffixSize, fontWeight: 500, opacity: 0.65 }}>/10</span>
    </span>
  );
}
