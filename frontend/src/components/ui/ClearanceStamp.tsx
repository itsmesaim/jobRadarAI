import { Check } from "lucide-react";

/** Small "cleared" badge — filled ring + check once a section's required
 * fields are complete, empty ring while pending. Signature element for
 * completed profile sections (Settings tabs, search-readiness, etc). */
export function ClearanceStamp({ complete }: { complete: boolean }) {
  return (
    <span
      className={`clearance-stamp ${complete ? "" : "clearance-stamp-pending"}`.trim()}
      title={complete ? "Complete" : "Incomplete"}
      aria-label={complete ? "Complete" : "Incomplete"}
    >
      {complete && <Check size={11} strokeWidth={3} />}
    </span>
  );
}
