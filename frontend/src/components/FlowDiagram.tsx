import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";

export interface FlowStep {
  icon: LucideIcon;
  label: string;
  desc: string;
  tone?: "accent" | "purple" | "success" | "warning";
}

/** A connected sequence of icon nodes (CV upload → redaction → AI provider →
 * storage, etc.) — horizontal on desktop, a vertical timeline on mobile.
 * Each node animates in with a stagger once scrolled into view. */
export function FlowDiagram({ steps }: { steps: FlowStep[] }) {
  return (
    <div className="flow-diagram">
      {steps.map((step, i) => (
        <div
          key={step.label}
          className="flow-diagram-step"
          style={{ "--flow-delay": `${i * 100}ms` } as CSSProperties}
        >
          <div className={`flow-diagram-node tone-${step.tone || "accent"}`}>
            <step.icon size={20} strokeWidth={2} />
          </div>
          <div className="flow-diagram-text">
            <h4>{step.label}</h4>
            <p>{step.desc}</p>
          </div>
          {i < steps.length - 1 && <div className="flow-diagram-arrow" aria-hidden />}
        </div>
      ))}
    </div>
  );
}
