import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ExternalLink } from "lucide-react";
import { jobsApi } from "../api/index";
import { ScoreBadge } from "../components/ScoreBadge";
import type { Job, JobStatus } from "../types";

const COLUMNS: { status: JobStatus; label: string; color: string }[] = [
  { status: "NEW", label: "New", color: "var(--text-muted)" },
  { status: "SAVED", label: "Saved", color: "#3b82f6" },
  { status: "HALF_APPLIED", label: "Half applied", color: "#8b5cf6" },
  { status: "APPLIED", label: "Applied", color: "var(--accent)" },
  { status: "FOLLOWUP", label: "Follow up", color: "#f97316" },
  { status: "INTERVIEWING", label: "Interviewing", color: "var(--warning)" },
  { status: "OFFER", label: "Offer", color: "var(--success)" },
  { status: "REJECTED", label: "Rejected", color: "var(--danger)" },
];

const REJECTION_QUOTES = [
  "Every no gets you closer to a yes.",
  "Rejection is redirection.",
  "Keep going — something better is coming.",
  "Even the best get rejected. It's part of the process.",
];

function KanbanCard({
  job,
  onMove,
}: {
  job: Job;
  onMove: (id: string, s: JobStatus) => void;
}) {
  const others = COLUMNS.map((c) => c.status).filter((s) => s !== job.status);

  return (
    <div className="card" style={{ padding: 12, fontSize: 12 }}>
      <p
        style={{
          margin: "0 0 8px",
          fontWeight: 500,
          color: "var(--text)",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {job.title}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <ScoreBadge score={job.score} size="sm" />
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", display: "flex" }}
            >
              <ExternalLink size={11} />
            </a>
          )}
          <select
            onChange={(e) => onMove(job.id, e.target.value as JobStatus)}
            defaultValue=""
            style={{
              fontSize: 11,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: "2px 6px",
              cursor: "pointer",
              outline: "none",
              color: "var(--text-secondary)",
            }}
          >
            <option value="" disabled>
              Move to...
            </option>
            {others.map((s) => (
              <option
                key={s}
                value={s}
                style={{ background: "var(--bg-card)" }}
              >
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function KanbanPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["kanban"],
    queryFn: () => jobsApi.list({ limit: 100 }),
  });

  const jobs = data?.jobs ?? [];

  const handleMove = async (id: string, status: JobStatus) => {
    try {
      await jobsApi.updateStatus(id, status);
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
      if (status === "REJECTED") {
        const q =
          REJECTION_QUOTES[Math.floor(Math.random() * REJECTION_QUOTES.length)];
        toast(q, { icon: "💪", duration: 4000 });
      } else if (status === "OFFER") {
        toast("Congrats! 🎉 Mark it as offer secured!", { duration: 4000 });
      } else {
        toast.success(`Moved to ${status.replace("_", " ")}`);
      }
    } catch {
      toast.error("Failed to update");
    }
  };

  const byStatus = (s: JobStatus) => jobs.filter((j) => j.status === s);

  return (
    <div style={{ padding: "20px 0 20px 16px", overflowX: "auto" }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          minWidth: "max-content",
          paddingRight: 16,
        }}
      >
        {COLUMNS.map(({ status, label, color }) => {
          const col = byStatus(status);
          return (
            <div key={status} style={{ width: 220, flexShrink: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                  paddingBottom: 8,
                  borderBottom: `2px solid ${color}`,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color }}>
                  {label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    background: "var(--bg-secondary)",
                    color: "var(--text-muted)",
                    padding: "1px 6px",
                    borderRadius: 20,
                  }}
                >
                  {col.length}
                </span>
              </div>

              {isLoading ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    padding: "8px 0",
                  }}
                >
                  Loading...
                </div>
              ) : col.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    textAlign: "center",
                    padding: "20px 0",
                    border: "1px dashed var(--border)",
                    borderRadius: 8,
                  }}
                >
                  Empty
                </div>
              ) : (
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  {col.map((job) => (
                    <KanbanCard key={job.id} job={job} onMove={handleMove} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
