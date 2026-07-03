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
    (job.score ?? 0) >= MIN_APPLY_PACK_SCORE && (isPro || applyPacksRemaining > 0);

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
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "20px 24px",
            borderBottom: "1px solid var(--border)",
          }}
        >
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
              {job.crawled_at && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Clock size={11} /> {timeAgo(job.crawled_at)}
                </span>
              )}
            </div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 600,
                margin: "0 0 6px",
                lineHeight: 1.35,
                color: "var(--text)",
              }}
            >
              {title}
            </h2>
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
            <ScoreBadge score={job.score} size="lg" />
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
          {job.verdict && job.verdict !== "Not rated yet" && (
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
              {job.verdict}
            </p>
          )}

          {job.matched_strengths && job.matched_strengths.length > 0 && (
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
              {job.matched_strengths.map((s, i) => (
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

          {job.gaps && job.gaps.length > 0 && (
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
              {job.gaps.map((g, i) => (
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

        {/* Footer */}
        {job.score !== null && job.score > 0 && (
          <div className="job-modal-footer">
            {(job.score ?? 0) >= MIN_APPLY_PACK_SCORE && (
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
            </div>
          </div>
        )}
      </div>

      {showApplyPackLimit && (
        <LimitContactModal kind="apply_pack" onClose={() => setShowApplyPackLimit(false)} />
      )}
    </div>
  );
}
