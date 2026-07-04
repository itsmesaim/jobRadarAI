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

function fullDate(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
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
  "A 'no' today doesn't cancel the 'yes' coming next week.",
  "Michael Jordan got cut from his high school team. Look him up.",
  "This role wasn't it. The right one hasn't opened yet — that's all this means.",
  "You didn't lose a job, you avoided one that wasn't a fit. Onward.",
  "Every strong candidate racks up rejections on the way to an offer. You're on track.",
  "Companies pass on great people constantly — for budget, timing, internal politics. Rarely about you.",
  "Stephen King's first novel got 30 rejections. He kept a spike on the wall for them.",
  "Interview reps are still reps. This one counts toward the next win.",
  "The market is noisy right now. Your skills didn't just get worse because of one 'no'.",
  "Log it, forget it, apply to the next one. Momentum beats dwelling.",
  "J.K. Rowling was rejected by 12 publishers before Harry Potter took off.",
  "Some of the best hires were someone else's rejected candidate first.",
  "This just means the timing or fit was off — not that you're not good enough.",
  "Keep the applications moving. Volume plus quality is how offers happen.",
  "Take five minutes to feel it, then get back to the next role. You've got this.",
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
  // Prefer the source's real posting date; fall back to when we pulled it.
  const postedTime = timeAgo(job.posted_at_actual || job.crawled_at);
  const postedLabel = job.posted_at_actual ? "Posted" : "Pulled";
  const timeTooltip = [
    job.posted_at_actual && `Posted: ${fullDate(job.posted_at_actual)}`,
    job.crawled_at && `Pulled by JobRadar: ${fullDate(job.crawled_at)}`,
    job.rated_at && `Rated: ${fullDate(job.rated_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
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
  const isRating = !!job.rating_in_progress;
  const isUnrated = job.score === null && !isRating;

  const borderColor = isHighScore
    ? "var(--success)"
    : isGoodScore
      ? "var(--warning)"
      : "transparent";

  return (
    <>
      <div
        onClick={() => setShowModal(true)}
        className="card card-hover job-card"
        style={{
          opacity: job.auto_reject ? 0.45 : 1,
          borderLeft: `3px solid ${borderColor}`,
          cursor: "pointer",
        }}
      >
        {/* Header row */}
        <div className="job-card-header-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="job-card-meta-row">
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
                  title={timeTooltip}
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Clock size={10} /> {postedLabel} {postedTime}
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
            <ScoreBadge score={job.score} size="md" loading={isRating} />
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
          {isRating ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--accent)",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span className="score-badge-spinner" style={{ width: 10, height: 10 }} />
              AI is rating this job against your CV…
            </p>
          ) : !isUnrated && job.verdict && job.verdict !== "Not rated yet" ? (
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
        <div className="job-card-footer">
          <select
            value={currentStatus}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => handleStatus(e.target.value as JobStatus)}
            className="job-card-status-select"
            style={{ color: STATUS_COLORS[currentStatus] }}
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

          <div className="job-card-footer-actions">
            <button
              onClick={handleHide}
              className="btn btn-ghost job-card-icon-btn"
              title="Remove from list"
            >
              <EyeOff size={13} />
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="btn btn-ghost job-card-icon-btn"
              title="View full details"
            >
              <Maximize2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {showModal && <JobDetailModal job={job} onClose={() => setShowModal(false)} />}
    </>
  );
}
