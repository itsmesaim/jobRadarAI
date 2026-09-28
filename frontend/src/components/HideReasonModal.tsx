import { Overlay } from "./Modal";

export type HideReason = "too_senior" | "location" | "salary" | "other";

const REASONS: { value: HideReason; label: string }[] = [
  { value: "too_senior", label: "Too senior for me" },
  { value: "location", label: "Wrong location" },
  { value: "salary", label: "Salary too low" },
  { value: "other", label: "Not a fit" },
];

/** Shown right before a job gets hidden. Reason is fed into the same
 * rating_feedback -> calibration_notes pipeline as typed rating feedback
 * (backend/routes/jobs.py hide_job), so repeated "too senior" hides become a
 * standing rule the rater applies going forward, see services/calibration.py. */
export function HideReasonModal({
  jobTitle,
  onSubmit,
}: {
  jobTitle: string;
  onSubmit: (reason: HideReason | null) => void;
}) {
  return (
    <Overlay onClick={() => onSubmit(null)} zIndex={150} padding={16}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ maxWidth: 400, width: "100%", padding: "var(--space-6)" }}
      >
        <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-lg)" }}>
          Why hide this one?
        </h3>
        <p
          style={{
            margin: "0 0 var(--space-3)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          Optional, for {jobTitle}. Helps us stop showing you similar jobs.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => onSubmit(r.value)}
              className="btn btn-ghost btn-sm"
              style={{ justifyContent: "flex-start" }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "var(--space-3)", textAlign: "right" }}>
          <button type="button" onClick={() => onSubmit(null)} className="btn btn-ghost btn-sm">
            Just hide it
          </button>
        </div>
      </div>
    </Overlay>
  );
}
