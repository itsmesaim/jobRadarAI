import { useState } from "react";
import { ExternalLink, Building2, MapPin, EyeOff, Maximize2, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { ScoreBadge } from "./ScoreBadge";
import { JobDetailModal } from "./JobDetailModal";
import { jobsApi } from "../api/index";
import type { Job, JobStatus, Props } from "../types";

function timeAgo(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

type Freshness = "today" | "recent" | null;

function getFreshness(crawledAt?: string): Freshness {
  if (!crawledAt) return null;
  const d = new Date(crawledAt);
  if (isNaN(d.getTime())) return null;
  const diffHours = (Date.now() - d.getTime()) / 36e5;
  if (diffHours < 24) return "today";
  if (diffHours < 72) return "recent";
  return null;
}

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
  // @ts-ignore
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
  const [showModal, setShowModal] = useState(false);

  const [currentStatus, setCurrentStatus] = useState<JobStatus>(job.status);

  const company = extractCompany(job);
  const title = cleanTitle(job);
  // @ts-ignore
  const location = job.location as string | undefined;
  const postedTime = timeAgo(job.posted_at || job.crawled_at);
  const freshness = getFreshness(job.crawled_at);

  const handleStatus = async (status: JobStatus) => {
    try {
      await jobsApi.updateStatus(job.id, status);
      setCurrentStatus(status);
      onStatusChange?.();
      if (status === "REJECTED") {
        const quote = REJECTION_QUOTES[Math.floor(Math.random() * REJECTION_QUOTES.length)];
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

  const handleHide = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const borderColor = isHighScore
    ? "var(--success)"
    : isGoodScore
      ? "var(--warning)"
      : "transparent";

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="card card-hover"
        style={{
          padding: "18px 20px",
          opacity: job.auto_reject ? 0.45 : 1,
          borderLeft: `3px solid ${borderColor}`,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          minHeight: 248,
          boxSizing: "border-box",
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
                  fontSize: 10.5,
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
                    : job.source === "jobsapi-indeed"
                      ? "Indeed"
                      : job.source === "jobsapi-linkedin"
                        ? "LinkedIn"
                        : job.source === "adzuna"
                          ? "Adzuna"
                          : "Auto"}
              </span>
              {postedTime && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Clock size={10} /> {postedTime}
                </span>
              )}
              {freshness === "today" && (
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "var(--success)",
                    letterSpacing: "0.03em",
                  }}
                >
                  NEW
                </span>
              )}
              {freshness === "recent" && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 10.5,
                    fontWeight: 500,
                    color: "var(--text-muted)",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--border-strong)",
                      display: "inline-block",
                    }}
                  />
                  Recent
                </span>
              )}
              {isHighScore && (
                <span
                  className="badge"
                  style={{
                    background: "var(--success-bg)",
                    color: "var(--success)",
                    border: "1px solid var(--success-border)",
                    fontSize: 10.5,
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
                    fontSize: 10.5,
                  }}
                >
                  Auto-reject
                </span>
              )}
            </div>

            <h3
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.4,
                margin: "0 0 5px",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                minHeight: 40,
              }}
            >
              {title}
            </h3>

            {(company || location) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                {company && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      minWidth: 0,
                    }}
                  >
                    <Building2 size={11} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 130,
                      }}
                    >
                      {company}
                    </span>
                  </span>
                )}
                {location && (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      minWidth: 0,
                      flex: "1 1 auto",
                    }}
                  >
                    <MapPin size={11} style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {location}
                    </span>
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
                onClick={(e) => e.stopPropagation()}
                style={{ color: "var(--text-muted)", display: "flex" }}
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>

        {/* Verdict — clamped at 2 lines, ellipsis not mid-word cut */}
        <div style={{ flex: 1, minHeight: 0, marginBottom: 12 }}>
          {!isUnrated && job.verdict && job.verdict !== "Not rated yet" ? (
            <p
              style={{
                fontSize: 12.5,
                color: "var(--text-secondary)",
                margin: 0,
                lineHeight: 1.55,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {job.verdict}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              {isUnrated ? "Not rated yet — run Search to rate" : ""}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <select
            value={currentStatus}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleStatus(e.target.value as JobStatus)}
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: STATUS_COLORS[currentStatus],
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "4px 6px",
              cursor: "pointer",
              outline: "none",
              maxWidth: 110,
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
            }}
          >
            <button
              onClick={handleHide}
              className="btn btn-ghost"
              style={{ padding: "5px 6px", fontSize: 11.5 }}
              title="Remove from list"
            >
              <EyeOff size={11} />
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="btn btn-ghost"
              style={{ padding: "5px 6px", fontSize: 11.5 }}
              title="View full details"
            >
              <Maximize2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {showModal && <JobDetailModal job={job} onClose={() => setShowModal(false)} />}
    </>
  );
}
