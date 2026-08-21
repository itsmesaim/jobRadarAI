import { useState } from "react";

/** Small optional prompt shown right after moving a job to Rejected. Stored server-side
 * and surfaced back if the same company shows up again (see JobDetailModal's
 * past_rejection_reason banner). */
export function RejectReasonModal({
  jobTitle,
  onSubmit,
}: {
  jobTitle: string;
  onSubmit: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div
      onClick={() => onSubmit(null)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 150,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ maxWidth: 400, width: "100%", padding: "var(--space-6)" }}
      >
        <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-lg)" }}>
          Why did this get rejected?
        </h3>
        <p
          style={{
            margin: "0 0 var(--space-3)",
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
          }}
        >
          Optional, for {jobTitle}. If this company rejects you again, we'll remind you what
          happened last time.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. no reply after interview, said they wanted more X experience..."
          rows={3}
          style={{
            width: "100%",
            resize: "vertical",
            fontSize: "var(--text-sm)",
            padding: "var(--space-2) var(--space-3)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            background: "var(--bg-primary)",
            color: "var(--text-primary)",
            fontFamily: "inherit",
          }}
        />
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            marginTop: "var(--space-3)",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" onClick={() => onSubmit(null)} className="btn btn-ghost btn-sm">
            Skip
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reason.trim() || null)}
            className="btn btn-primary btn-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
