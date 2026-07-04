import {
  X,
  ExternalLink,
  Building2,
  MapPin,
  Check,
  Clock,
  Loader,
  Sparkles,
  ClipboardCopy,
  RefreshCw,
  CalendarClock,
} from "lucide-react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ScoreBadge } from "./ScoreBadge";
import { jobsApi, crawlerApi } from "../api/index";
import { LimitContactModal } from "./LimitContactModal";
import type { Job } from "../types";

const MIN_APPLY_PACK_SCORE = 6;

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
  return `${Math.floor(days / 7)}w ago`;
}

function fullDate(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

interface Props {
  job: Job;
  onClose: () => void;
}

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

export function JobDetailModal({ job, onClose }: Props) {
  const queryClient = useQueryClient();
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [copiedPack, setCopiedPack] = useState(false);
  const [packLoading, setPackLoading] = useState(false);
  const [showApplyPackLimit, setShowApplyPackLimit] = useState(false);
  const [reRating, setReRating] = useState(false);
  // Rating fields can change without the job's identity changing (title,
  // company, JD text stay the same) — track them separately so a re-rate
  // updates the modal immediately without needing the parent list to refetch.
  const [rating, setRating] = useState({
    score: job.score,
    verdict: job.verdict,
    matched_strengths: job.matched_strengths,
    gaps: job.gaps,
    auto_reject: job.auto_reject,
    rated_at: job.rated_at,
  });

  const company = extractCompany(job);
  const title = cleanTitle(job);
  // @ts-ignore
  const location = job.location as string | undefined;

  const { data: usage } = useQuery({
    queryKey: ["crawl-status"],
    queryFn: crawlerApi.status,
    staleTime: 30_000,
  });

  const isPro = !!(
    usage &&
    (usage.is_admin ||
      usage.token_quota_unlimited ||
      usage.full_access ||
      (usage.full_access_until && new Date(usage.full_access_until) > new Date()) ||
      (usage.apply_pack_limit ?? 0) >= 9999)
  );
  const applyPacksRemaining = isPro
    ? 9999
    : Math.max(0, (usage?.apply_pack_limit ?? 0) - (usage?.apply_packs_used ?? 0));
  const canApplyPack =
    (rating.score ?? 0) >= MIN_APPLY_PACK_SCORE && (isPro || applyPacksRemaining > 0);

  const handleCopyBrief = async () => {
    try {
      const { brief } = await jobsApi.getBrief(job.id);
      await navigator.clipboard.writeText(brief);
      setCopiedBrief(true);
      toast.success("Fit summary copied");
      setTimeout(() => setCopiedBrief(false), 2000);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax.response?.data?.detail;
      if (ax.response?.status === 409 && detail) {
        toast(detail, { duration: 8000, icon: "ℹ️" });
      } else {
        toast.error(detail || "Could not copy fit summary");
      }
    }
  };

  const handleReRate = async () => {
    setReRating(true);
    try {
      const res = await jobsApi.rateOne(job.id);
      setRating({
        score: res.score,
        verdict: res.verdict,
        matched_strengths: res.matched_strengths,
        gaps: res.gaps,
        auto_reject: res.auto_reject,
        rated_at: res.rated_at,
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
      toast.success(`Re-rated: ${res.score ?? "?"}/10`);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax.response?.data?.detail;
      if (ax.response?.status === 429 && detail) {
        toast.error(detail, { duration: 6000 });
      } else {
        toast.error(detail || "Could not re-rate this job");
      }
    } finally {
      setReRating(false);
    }
  };

  const handleApplyPack = async () => {
    if (!canApplyPack) {
      setShowApplyPackLimit(true);
      return;
    }
    setPackLoading(true);
    try {
      const { pack } = await jobsApi.getApplyPack(job.id);
      await navigator.clipboard.writeText(pack);
      setCopiedPack(true);
      toast.success("Apply pack copied");
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
      setTimeout(() => setCopiedPack(false), 2000);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax.response?.data?.detail;
      if (ax.response?.status === 429) {
        setShowApplyPackLimit(true);
      } else if (ax.response?.status === 409 && detail) {
        toast(detail, { duration: 8000, icon: "ℹ️" });
      } else {
        toast.error(detail || "Could not generate apply pack");
      }
    } finally {
      setPackLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card job-detail-modal"
        style={{
          width: "100%",
          maxWidth: 680,
          maxHeight: "88dvh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div className="job-modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6,
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
                    : job.source === "jobsapi-indeed"
                      ? "Indeed"
                      : job.source === "jobsapi-linkedin"
                        ? "LinkedIn"
                        : "Auto"}
              </span>
            </div>

            <div className="job-modal-timestamps">
              {job.posted_at_actual && (
                <span
                  title={`Posted: ${fullDate(job.posted_at_actual)}`}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Clock size={11} /> Posted {timeAgo(job.posted_at_actual)}
                </span>
              )}
              {job.crawled_at && (
                <span
                  title={`Pulled by JobRadar: ${fullDate(job.crawled_at)}`}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <CalendarClock size={11} /> Pulled {timeAgo(job.crawled_at)}
                </span>
              )}
              {rating.rated_at && (
                <span
                  title={`Last rated: ${fullDate(rating.rated_at)}`}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Sparkles size={11} /> Rated {timeAgo(rating.rated_at)}
                </span>
              )}
            </div>
            <h2 className="job-modal-title">{title}</h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {company && (
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <Building2 size={13} /> {company}
                </span>
              )}
              {location && (
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <MapPin size={13} /> {location}
                </span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <ScoreBadge score={rating.score} size="lg" loading={!!job.rating_in_progress} />
            <button
              onClick={onClose}
              className="btn btn-ghost"
              style={{ padding: "8px 10px" }}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {job.rating_in_progress && (
            <p
              style={{
                fontSize: 14,
                color: "var(--accent)",
                lineHeight: 1.6,
                margin: "0 0 20px",
                padding: "12px 14px",
                background: "var(--accent-light)",
                borderRadius: 8,
                border: "1px solid var(--accent-light)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span className="score-badge-spinner" style={{ width: 13, height: 13 }} />
              AI is rating this job against your CV right now — check back in a moment.
            </p>
          )}
          {rating.verdict && rating.verdict !== "Not rated yet" && (
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                lineHeight: 1.65,
                margin: "0 0 20px",
                padding: "12px 14px",
                background: "var(--bg-secondary)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              {rating.verdict}
            </p>
          )}

          {rating.matched_strengths && rating.matched_strengths.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--success)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 10,
                }}
              >
                Strengths
              </p>
              {rating.matched_strengths.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
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
                      fontSize: 14,
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

          {rating.gaps && rating.gaps.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#f97316",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 10,
                }}
              >
                Gaps
              </p>
              {rating.gaps.map((g, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <span style={{ color: "#f97316", fontWeight: 700, flexShrink: 0 }}>−</span>
                  <span
                    style={{
                      fontSize: 14,
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

          {job.full_text && (
            <div>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 10,
                }}
              >
                Full job description
              </p>
              <p
                style={{
                  fontSize: 13.5,
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  margin: 0,
                }}
              >
                {job.full_text}
              </p>
            </div>
          )}
        </div>

        {/* Footer — always visible so a job can be re-rated even before it has a score */}
        <div className="job-modal-footer">
          {(rating.score ?? 0) >= MIN_APPLY_PACK_SCORE && (
            <>
              <button
                type="button"
                onClick={handleApplyPack}
                disabled={packLoading}
                className="btn btn-primary job-modal-apply-pack"
              >
                {packLoading ? (
                  <Loader size={15} className="animate-spin" />
                ) : copiedPack ? (
                  <Check size={15} />
                ) : (
                  <Sparkles size={15} />
                )}
                {packLoading
                  ? "Building your apply pack…"
                  : copiedPack
                    ? "Copied — paste into ChatGPT / Claude"
                    : "Copy apply pack for LLM"}
              </button>
              <p className="job-modal-pack-hint">
                {isPro
                  ? "Unlimited · ATS keywords, full LaTeX CV boilerplate, MASTER CV + JD context"
                  : applyPacksRemaining > 0
                    ? `${applyPacksRemaining} free today · one prompt: tailored CV .tex + cover note`
                    : "Daily limit used — upgrade for unlimited apply packs"}
              </p>
            </>
          )}

          <div className="job-modal-footer-actions">
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost job-modal-action-btn"
              >
                <ExternalLink size={14} /> View posting
              </a>
            )}
            <button
              type="button"
              onClick={handleReRate}
              disabled={reRating}
              className="btn btn-ghost job-modal-action-btn"
              title="Re-check this job against your current CV, preferences, and skill overrides"
            >
              {reRating ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {reRating ? "Re-rating…" : "Re-rate"}
            </button>
            {rating.score !== null && rating.score > 0 && (
              <button
                type="button"
                onClick={handleCopyBrief}
                className="btn btn-ghost job-modal-action-btn"
                title="Copy fit score, gaps, and job context for your LLM"
              >
                {copiedBrief ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={14} /> Copy fit summary
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {showApplyPackLimit && (
        <LimitContactModal kind="apply_pack" onClose={() => setShowApplyPackLimit(false)} />
      )}
    </div>
  );
}
