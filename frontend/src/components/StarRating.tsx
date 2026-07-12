import { Star } from "lucide-react";

interface Props {
  value: number;
  onChange: (value: number) => void;
  size?: number;
}

export function StarRating({ value, onChange, size = 18 }: Props) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n === value ? 0 : n)}
          className="btn btn-ghost"
          style={{ padding: 4, color: n <= value ? "#f5a524" : "var(--text-muted)" }}
          aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
        >
          <Star size={size} fill={n <= value ? "#f5a524" : "none"} />
        </button>
      ))}
    </div>
  );
}
