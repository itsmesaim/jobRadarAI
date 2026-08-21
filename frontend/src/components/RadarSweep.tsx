import { Radar } from "lucide-react";
import { ScoreBadge } from "./ScoreBadge";

interface Blip {
  label: string;
  score: number;
  angle: number; // degrees, 0 = top, clockwise
  radius: number; // 0-1, fraction of the radar's radius
  delay: number; // seconds, stagger the ping-in
}

// All angles sit in the right hemisphere (-90 to 90) so every label, which
// always renders horizontally extending right from its dot, points out into
// open space instead of back across the dish into another blip's label.
const BLIPS: Blip[] = [
  { label: "Senior Frontend Engineer", score: 9, angle: -55, radius: 0.55, delay: 0 },
  { label: "Full Stack Developer", score: 8, angle: -20, radius: 0.88, delay: 1.2 },
  { label: "Backend Engineer", score: 7, angle: 15, radius: 0.4, delay: 2.4 },
  { label: "Platform Engineer", score: 6, angle: 48, radius: 0.85, delay: 3.6 },
  { label: "DevOps Engineer", score: 9, angle: 78, radius: 0.62, delay: 4.8 },
];

/** The hero's signature element: a live radar sweep that literalizes "let the
 * radar find your matches" - a rotating sweep arm, range rings, and job blips
 * that ping onto the scope with their fit score, using the same ScoreBadge
 * component the real app uses for ratings. Pure CSS animation, freezes under
 * prefers-reduced-motion (see .radar-sweep-arm / .radar-blip in index.css). */
export function RadarSweep() {
  return (
    <div
      className="radar-sweep"
      role="img"
      aria-label="Radar animation showing job listings appearing with AI fit scores"
    >
      <div className="radar-sweep-ring radar-sweep-ring-1" />
      <div className="radar-sweep-ring radar-sweep-ring-2" />
      <div className="radar-sweep-ring radar-sweep-ring-3" />
      <div className="radar-sweep-arm" />
      <div className="radar-sweep-hub">
        <Radar size={22} strokeWidth={2} />
      </div>
      {BLIPS.map((b) => (
        <div
          key={b.label}
          className="radar-blip"
          style={
            {
              "--blip-angle": `${b.angle}deg`,
              "--blip-radius": b.radius,
              "--blip-delay": `${b.delay}s`,
            } as React.CSSProperties
          }
        >
          <span className="radar-blip-dot" />
          <span className="radar-blip-tag">
            <ScoreBadge score={b.score} size="sm" />
            <span className="radar-blip-label">{b.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
