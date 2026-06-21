import { useState } from "react";
import {
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Building2,
  MapPin,
  EyeOff,
} from "lucide-react";
import toast from "react-hot-toast";
import { ScoreBadge } from "./ScoreBadge";
import { jobsApi } from "../api/index";
import type { Job, JobStatus, Props } from "../types";

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
  HALF_APPLIED: "var(--purple)",
};

const REJECTION_QUOTES = [
  "Every no gets you closer to a yes. Keep going.",
  "Rejection is redirection. Something better is coming.",
  "Even the best get rejected. It's part of the process.",
  "One door closes, a better one opens.",
  "Thomas Edison failed 10,000 times before the lightbulb. You got this.",
];

function extractCompany(job: Job): string {
  // @ts-ignore — company may exist on newer Adzuna/Jooble records
  if (job.company) return job.company;
  const parts = job.title.split("—");
  return parts.length > 1 ? parts[1].trim() : "";
}

function cleanTitle(job: Job): string {
  const company = extractCompany(job);
  if (company && job.title.includes("—")) {
    return job.title.split("—")[0].trim();
  }
  return job.title;
}

export function JobCard({ job, onStatusChange, onHidden }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<JobStatus>(job.status);

  const company = extractCompany(job);
  const title = cleanTitle(job);
  // @ts-ignore
  const location = job.location as string | undefined;

  const handleStatus = async (status: JobStatus) => {
    try {
      await jobsApi.updateStatus(job.id, status);
      setCurrentStatus(status);
      onStatusChange?.();
      if (status === "REJECTED") {
        const quote =
          REJECTION_QUOTES[Math.floor(Math.random() * REJECTION_QUOTES.length)];
        toast(quote, { icon: "💪", duration: 4500 });
      } else if (status === "OFFER") {
        toast.success("Congrats on the offer! 🎉", { duration: 4000 });
      } else {
        toast.success(`Moved to ${status.replace("_", " ")}`);
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

  const handleHide = async () => {
    try {
      await jobsApi.hide(job.id);
      toast.success("Job removed from your list");
      onHidden?.();
    } catch {
      toast.error("Could not remove job");
    }
  };

  const isHighScore = job.score !== null && job.score >= 8;
  const isGoodScore = job.score !== null && job.score >= 6 && job.score < 8;
  const isUnrated = job.score === null;

  return (
    <div
      className="card card-hover"
      style={{
        padding: 20,
        opacity: job.auto_reject ? 0.45 : 1,
        borderLeft: isHighScore
          ? "3px solid var(--success)"
          : isGoodScore
            ? "3px solid var(--warning)"
            : "3px solid transparent",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginBottom: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
              }}
            >
              {job.source === "manual"
                ? "Manual"
                : job.source === "jooble"
                  ? "Jooble"
                  : job.source === "adzuna"
                    ? "Adzuna"
                    : "Auto"}
            </span>
            {isHighScore && (
              <span
                className="badge"
                style={{
                  background: "var(--success-bg)",
                  color: "var(--success)",
                  border: "1px solid var(--success-border)",
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
                  border: "1px solid var(--danger-border)",
                }}
              >
                Auto-reject
              </span>
            )}
          </div>

          <h3
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.4,
              margin: "0 0 4px",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </h3>

          {(company || location) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {company && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  <Building2 size={13} style={{ flexShrink: 0 }} />
                  {company}
                </span>
              )}
              {location && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  <MapPin size={13} style={{ flexShrink: 0 }} />
                  {location}
                </span>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <ScoreBadge score={job.score} size="md" />
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", display: "flex" }}
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Verdict */}
      {!isUnrated && job.verdict && job.verdict !== "Not rated yet" && (
        <p
          style={{
            fontSize: 13.5,
            color: "var(--text-secondary)",
            margin: "0 0 14px",
            lineHeight: 1.6,
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
            fontSize: 13,
            color: "var(--text-muted)",
            margin: "0 0 14px",
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
          gap: 10,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        <select
          value={currentStatus}
          onChange={(e) => handleStatus(e.target.value as JobStatus)}
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: STATUS_COLORS[currentStatus],
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 7,
            padding: "5px 8px",
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

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {job.score !== null && job.score > 0 && (
            <button
              onClick={handleCopyBrief}
              className="btn btn-ghost"
              style={{ padding: "6px 10px", fontSize: 12.5 }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy details"}
            </button>
          )}

          {/* THE HIDE BUTTON — this was missing before */}
          <button
            onClick={handleHide}
            className="btn btn-ghost"
            style={{ padding: "6px 8px", fontSize: 12.5 }}
            title="Remove from list"
          >
            <EyeOff size={12} />
          </button>

          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "flex",
              padding: 5,
            }}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
          }}
        >
          {job.matched_strengths.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "var(--success)",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Strengths
              </div>
              {job.matched_strengths.map((s, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 8, marginBottom: 6 }}
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
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      lineHeight: 1.6,
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
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#f97316",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Gaps
              </div>
              {job.gaps.map((g, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: 8, marginBottom: 6 }}
                >
                  <span
                    style={{ color: "#f97316", fontWeight: 700, flexShrink: 0 }}
                  >
                    −
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                      lineHeight: 1.6,
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
