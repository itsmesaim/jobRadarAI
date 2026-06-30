import { useId } from "react";

const BRAND = "#2563eb";

type LogoProps = {
  size?: number;
  showWordmark?: boolean;
  wordmarkSize?: number;
  centered?: boolean;
};

export function LogoMark({ size = 32 }: { size?: number }) {
  const uid = useId().replace(/:/g, "");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{
        display: "block",
        flexShrink: 0,
        filter: "drop-shadow(0 2px 6px rgba(37, 99, 235, 0.35))",
      }}
    >
      <defs>
        <linearGradient
          id={`sweep-${uid}`}
          x1="16"
          y1="16"
          x2="24"
          y2="8"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={BRAND} />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.28" />
      <path d="M16 16 L16 6.5 A9.5 9.5 0 0 1 24.2 10.8 Z" fill={`url(#sweep-${uid})`} />
      <line
        x1="16"
        y1="16"
        x2="22.4"
        y2="9.6"
        stroke="#ffffff"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <circle cx="22.4" cy="9.6" r="3.2" fill="#ffffff" />
      <circle cx="22.4" cy="9.6" r="1.25" fill={BRAND} />
      <circle cx="16" cy="16" r="2" fill="#ffffff" />
    </svg>
  );
}

export function Logo({
  size = 36,
  showWordmark = true,
  wordmarkSize = 22,
  centered = false,
}: LogoProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: centered ? "center" : "flex-start",
      }}
    >
      <LogoMark size={size} />
      {showWordmark && (
        <span
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 0,
            fontSize: wordmarkSize,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
          }}
        >
          <span style={{ color: "var(--text)" }}>Job</span>
          <span
            style={{
              background: `linear-gradient(135deg, ${BRAND} 0%, #60a5fa 100%)`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Radar
          </span>
        </span>
      )}
    </div>
  );
}
