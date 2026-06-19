import { useState } from "react";
import {
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from "lucide-react";
import toast from "react-hot-toast";
import { ScoreBadge } from "./ScoreBadge";
import { jobsApi } from "../api/index";
import type { Job, JobStatus } from "../types";

const STATUSES: JobStatus[] = [
  "NEW",
  "SAVED",
  "APPLIED",
  "INTERVIEWING",
  "OFFER",
  "REJECTED",
  "FOLLOWUP",
  "HALF_APPLIED",
];

const STATUS_COLORS: Record<JobStatus, string> = {
  NEW: "var(--text-muted)",
  SAVED: "#3b82f6",
  APPLIED: "var(--accent)",
  INTERVIEWING: "var(--warning)",
  OFFER: "var(--success)",
  REJECTED: "var(--danger)",
  FOLLOWUP: "#f97316",
  HALF_APPLIED: "#8b5cf6",
};

const REJECTION_QUOTES = [
  "Every no gets you closer to a yes. Keep going.",
  "Rejection is redirection. Something better is coming.",
  "Even Google got rejected from investors. You're in good company.",
  "One door closes, a better one opens. Trust the process.",
  "Thomas Edison failed 10,000 times before the lightbulb. You got this.",
];

interface Props {
  job: Job;
  onStatusChange?: () => void;
}

export function JobCard({ job, onStatusChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<JobStatus>(job.status);

  const handleStatus = async (status: JobStatus) => {
    try {
      await jobsApi.updateStatus(job.id, status);
      setCurrentStatus(status);
      onStatusChange?.();
      if (status === "REJECTED") {
        const quote =
          REJECTION_QUOTES[Math.floor(Math.random() * REJECTION_QUOTES.length)];
        toast(quote, { icon: "💪", duration: 4000 });
      } else {
        toast.success(`Moved to ${status}`);
      }
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleCopyBrief = async () => {
    try {
      const { brief } = await jobsApi.getBrief(job.id);
      await navigator.clipboard.writeText(brief);
      setCopied(true);
      toast.success("Job details copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy brief");
    }
  };

  const isHighScore = job.score !== null && job.score >= 8;
  const isUnrated = job.score === null;

  return (
    <div
      className="card"
      style={{
        padding: 16,
        opacity: job.auto_reject ? 0.4 : 1,
        borderLeft: isHighScore
          ? "3px solid var(--success)"
          : "3px solid transparent",
        transition: "all 0.2s",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 3,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {job.source === "manual" ? "Manual" : "Auto"}
            </span>
            {isHighScore && (
              <span
                className="badge"
                style={{
                  background: "var(--success-bg)",
                  color: "var(--success)",
                  fontSize: 10,
                }}
              >
                Strong match
              </span>
            )}
            {job.auto_reject && (
              <span
                className="badge"
                style={{
                  background: "var(--danger-bg)",
                  color: "var(--danger)",
                  fontSize: 10,
                }}
              >
                Auto-reject
              </span>
            )}
          </div>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.4,
              margin: 0,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {job.title}
          </h3>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <ScoreBadge score={job.score} />
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", display: "flex" }}
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>

      {/* Verdict */}
      {!isUnrated && job.verdict && job.verdict !== "Not rated yet" && (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-secondary)",
            margin: "0 0 10px",
            lineHeight: 1.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {job.verdict}
        </p>
      )}

      {isUnrated && (
        <p
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            margin: "0 0 10px",
          }}
        >
          Not rated yet — run Search to rate
        </p>
      )}

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <select
          value={currentStatus}
          onChange={(e) => handleStatus(e.target.value as JobStatus)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: STATUS_COLORS[currentStatus],
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "3px 6px",
            cursor: "pointer",
            outline: "none",
          }}
        >
          {STATUSES.map((s) => (
            <option
              key={s}
              value={s}
              style={{ color: "var(--text)", background: "var(--bg-card)" }}
            >
              {s.replace("_", " ")}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {job.score !== null && job.score > 0 && (
            <button
              onClick={handleCopyBrief}
              className="btn btn-ghost"
              style={{ padding: "4px 8px", fontSize: 11 }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied" : "Copy details"}
            </button>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "flex",
              padding: 4,
            }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          {job.matched_strengths.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--success)",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Strengths
              </div>
              {job.matched_strengths.map((s, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 6, marginBottom: 4 }}
                >
                  <span
                    style={{
                      color: "var(--success)",
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    +
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {s}
                  </span>
                </div>
              ))}
            </div>
          )}

          {job.gaps.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#f97316",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Gaps
              </div>
              {job.gaps.map((g, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 6, marginBottom: 4 }}
                >
                  <span
                    style={{ color: "#f97316", fontWeight: 700, flexShrink: 0 }}
                  >
                    −
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {g}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
