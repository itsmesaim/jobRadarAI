import {
  X,
  ExternalLink,
  Building2,
  MapPin,
  Check,
  Download,
  Loader,
  Sparkles,
  ClipboardCopy,
  RefreshCw,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ScoreBadge } from "./ScoreBadge";
import { StarRating } from "./StarRating";
import { jobsApi, crawlerApi } from "../api/index";
import { LimitContactModal } from "./LimitContactModal";
import type { Job } from "../types";

const MIN_APPLY_PACK_SCORE = 6;

// Rotates under the button while draft/ATS/revision run (often minutes).
const PACK_WAIT_LINES = [
  "WIRE: Better days are coming. This pack is one of them. Hang on.",
  "Tolstoy: “The two most powerful warriors are patience and time.”",
  "FACT: Honey never spoils. Neither did your CV. We're just tailoring it.",
  "DISPATCH: Octopuses have three hearts. This pack has three passes. You're on them.",
  "Edison: “Everything comes to him who hustles while he waits.” That's you.",
  "FACT: A banana is a berry. A strawberry isn't. We're still writing bullets.",
  "NOTE: Oxford is older than the Aztec Empire. This wait is not.",
  "Rousseau: “Patience is bitter, but its fruit is sweet.” PDF incoming.",
  "FACT: The shortest war lasted 38 minutes. You're already past that.",
  "WIRE: A day on Venus is longer than its year. This wait is not.",
  "FACT: Wombats poop cubes. We output PDFs. Both take a minute.",
  "DISPATCH: There's a jellyfish that can reverse aging. Your cover letter cannot. Yet.",
  "NOTE: Cleopatra lived closer to the Moon landing than to the pyramids. Perspective.",
  "WIRE: A flock of flamingos is a flamboyance. A flock of bullets is a CV.",
  "FACT: Shakespeare coined “swagger.” Your summary is getting some.",
  "Better days are called Saturday, Sunday, and “apply pack ready.” Almost.",
  "You can close this. Come back in a few minutes. It keeps cooking in the background.",
];

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

function sourceLabel(source?: string): string {
  if (source === "manual") return "Manual";
  if (source === "jooble") return "Jooble";
  if (source === "jobsapi-indeed") return "Indeed";
  if (source === "jobsapi-linkedin") return "LinkedIn";
  return "Auto";
}

function prettyRatedBy(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim();
  const i = s.indexOf(":");
  if (i < 0) return s;
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  const stripped = model.toLowerCase().startsWith(provider.toLowerCase())
    ? model.slice(provider.length).replace(/^[-:]/, "")
    : model;
  const prov = provider.charAt(0).toUpperCase() + provider.slice(1);
  return stripped ? `${prov} ${stripped}` : prov;
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
  const parts = job.title.split("\u2014");
  return parts.length > 1 ? parts[1].trim() : "";
}

function cleanTitle(job: Job): string {
  const company = extractCompany(job);
  if (company && job.title.includes("\u2014")) {
    return job.title.split("\u2014")[0].trim();
  }
  return job.title;
}

const HINT_COUNT_KEY = "jobradar_job_detail_hint_count";
const HINT_ONBOARDING_SHOWS = 3;
const HINT_REPEAT_EVERY = 5;
const HINTS = [
  "Download apply pack builds a ready CV + cover letter PDF. Copy apply pack instead if you'd rather hand the raw info to your own ChatGPT/Claude and build it yourself.",
  'Be specific in the rating note, e.g. "don\'t penalize freelance experience", it becomes a standing rule the AI applies to similar jobs, not just this one.',
  "Already applied to this one? Move it to Applied in Kanban so your pipeline stays accurate and follow-up reminders make sense.",
];

export function JobDetailModal({ job, onClose }: Props) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // One small self-dismissing hint toast per open, not a persistent on-screen banner,
  // and not two toasts stacking on top of each other. Shows every time for the first
  // few opens, then periodically after that so it doesn't go silent for returning users.
  useEffect(() => {
    const count = Number(localStorage.getItem(HINT_COUNT_KEY) || "0");
    localStorage.setItem(HINT_COUNT_KEY, String(count + 1));
    const shouldShow = count < HINT_ONBOARDING_SHOWS || count % HINT_REPEAT_EVERY === 0;
    if (!shouldShow) return;
    const hint = HINTS[count % HINTS.length];
    const t1 = setTimeout(() => {
      toast(hint, { duration: 6000, icon: "💡" });
    }, 1000);
    return () => clearTimeout(t1);
  }, []);

  const queryClient = useQueryClient();
  const [copiedBrief, setCopiedBrief] = useState(false);
  const [packReady, setPackReady] = useState(false);
  const [packLoading, setPackLoading] = useState(!!job.apply_pack_in_progress);
  const [packStageText, setPackStageText] = useState<string | null>(null);
  const packBusyRef = useRef(false);
  const [packAts, setPackAts] = useState<{
    alignment_pct: number;
    matched: string[];
    missing: string[];
    fixes: string[];
  } | null>(null);
  const [cvDownloading, setCvDownloading] = useState(false);
  const [coverDownloading, setCoverDownloading] = useState(false);
  const [cvOverflow, setCvOverflow] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [packNote, setPackNote] = useState("");
  const [atsExpanded, setAtsExpanded] = useState(false);
  const [showApplyPackLimit, setShowApplyPackLimit] = useState(false);
  const [reRating, setReRating] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [starRating, setStarRating] = useState(0);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  // Rating fields can change without the job's identity changing (title,
  // company, JD text stay the same), track them separately so a re-rate
  // updates the modal immediately without needing the parent list to refetch.
  const [rating, setRating] = useState({
    score: job.score,
    verdict: job.verdict,
    matched_strengths: job.matched_strengths,
    gaps: job.gaps,
    auto_reject: job.auto_reject,
    rated_at: job.rated_at,
    rated_by_model: job.rated_by_model,
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

  const { data: jobDetail } = useQuery({
    queryKey: ["job-detail", job.id],
    queryFn: () => jobsApi.get(job.id),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!jobDetail?.apply_pack_ready) return;
    setPackReady(true);
    if (jobDetail.apply_pack_ats) setPackAts(jobDetail.apply_pack_ats);
  }, [jobDetail?.apply_pack_ready, jobDetail?.apply_pack_ats]);

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
  const packHint = isPro
    ? "Unlimited · ATS keywords, full LaTeX CV boilerplate, MASTER CV + JD context"
    : applyPacksRemaining > 0
      ? `${applyPacksRemaining} free today · one prompt: tailored CV .tex + cover note`
      : "Daily limit used, upgrade for unlimited apply packs";

  const handleCopyBrief = async () => {
    try {
      const { brief } = await jobsApi.getBrief(job.id);
      await navigator.clipboard.writeText(brief);
      setCopiedBrief(true);
      toast.success("Apply pack copied, paste into ChatGPT/Claude/Grok");
      setTimeout(() => setCopiedBrief(false), 2000);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax.response?.data?.detail;
      if (ax.response?.status === 409 && detail) {
        toast(detail, { duration: 8000, icon: "ℹ️" });
      } else {
        toast.error(detail || "Could not copy apply pack");
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
        rated_by_model: res.rated_by_model,
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

  const handleSubmitFeedback = async () => {
    const comment = feedbackText.trim();
    if (!comment && !starRating) return;
    setFeedbackSubmitting(true);
    try {
      await jobsApi.submitRatingFeedback(job.id, comment, starRating || undefined);
      setFeedbackSubmitted(true);
      setFeedbackText("");
      toast.success("Thanks, this will help calibrate future ratings on similar jobs");
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      toast.error(ax.response?.data?.detail || "Could not save feedback");
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleApplyPack = async (
    regenerate = false,
    part: "all" | "cv" | "cover" = "all",
    note = "",
  ) => {
    if (packBusyRef.current) return;
    const joining = !!(job.apply_pack_in_progress || jobDetail?.apply_pack_in_progress);
    if (!joining && part === "all" && !canApplyPack) {
      setShowApplyPackLimit(true);
      return;
    }
    packBusyRef.current = true;
    setPackLoading(true);
    if (part === "all") {
      setPackAts(null);
      setPackReady(false);
    }
    setPackError(null);
    setCvOverflow(false);
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["job-detail", job.id] });
    let idx = Math.floor(Math.random() * PACK_WAIT_LINES.length);
    setPackStageText(PACK_WAIT_LINES[idx]);
    const rotate = setInterval(() => {
      idx = (idx + 1) % PACK_WAIT_LINES.length;
      setPackStageText(PACK_WAIT_LINES[idx]);
    }, 18000);
    try {
      const { ats, cached } = await jobsApi.streamApplyPack(
        job.id,
        () => {
          /* ticker is local; SSE stages used to overwrite it with one stuck line */
        },
        regenerate,
        part,
        note,
      );
      setPackAts(ats);
      setPackReady(true);
      toast.success(
        cached ? "Apply pack ready (already had one for this CV/rating)" : "Apply pack ready",
      );
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
      queryClient.invalidateQueries({ queryKey: ["job-detail", job.id] });
    } catch (err: unknown) {
      const ax = err as {
        response?: { status?: number; data?: { detail?: string } };
        message?: string;
      };
      const detail =
        ax.response?.data?.detail ||
        (err instanceof Error ? err.message : "") ||
        "Could not generate apply pack";
      setPackError(detail);
      if (ax.response?.status === 429) {
        const inflight = detail.toLowerCase().includes("already generating");
        if (inflight) {
          toast("Still building this pack, try again in a few seconds.", { icon: "⏳" });
        } else {
          setShowApplyPackLimit(true);
        }
      } else if (ax.response?.status === 409) {
        toast(detail, { duration: 8000, icon: "ℹ️" });
      } else {
        toast.error(detail);
      }
    } finally {
      clearInterval(rotate);
      packBusyRef.current = false;
      setPackLoading(false);
      setPackStageText(null);
    }
  };

  useEffect(() => {
    if (packReady || packBusyRef.current) return;
    if (!job.apply_pack_in_progress && !jobDetail?.apply_pack_in_progress) return;
    void handleApplyPack();
    // Reattach to the in-flight generate if they closed the modal and came back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.apply_pack_in_progress, jobDetail?.apply_pack_in_progress, packReady]);

  const handleDownloadCv = async () => {
    setCvDownloading(true);
    try {
      const { overflow } = await jobsApi.downloadApplyPackCv(job.id);
      setCvOverflow(overflow);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      const detail = ax.response?.data?.detail || "Could not download CV";
      setPackError(detail);
      toast.error(detail);
    } finally {
      setCvDownloading(false);
    }
  };

  const handleDownloadCoverLetter = async () => {
    setCoverDownloading(true);
    try {
      await jobsApi.downloadApplyPackCoverLetter(job.id);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string } } };
      const detail = ax.response?.data?.detail || "Could not download cover letter";
      setPackError(detail);
      toast.error(detail);
    } finally {
      setCoverDownloading(false);
    }
  };

  return (
    <div className="job-modal-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="card job-detail-modal">
        {/* Header */}
        <div className="job-modal-header">
          <div className="job-modal-header-main">
            <h2 className="job-modal-title">{title}</h2>
            {(company || location) && (
              <p className="job-modal-company">
                {company && (
                  <span>
                    <Building2 size={13} /> {company}
                  </span>
                )}
                {location && (
                  <span>
                    <MapPin size={13} /> {location}
                  </span>
                )}
              </p>
            )}
            <p className="job-modal-timestamps">
              <span className="job-modal-source">{sourceLabel(job.source)}</span>
              {job.posted_at_actual && (
                <span title={`Posted: ${fullDate(job.posted_at_actual)}`}>
                  Posted {timeAgo(job.posted_at_actual)}
                </span>
              )}
              {job.crawled_at && (
                <span title={`Pulled by JobRadar: ${fullDate(job.crawled_at)}`}>
                  Pulled {timeAgo(job.crawled_at)}
                </span>
              )}
              {rating.rated_at && (
                <span title={`Last rated: ${fullDate(rating.rated_at)}`}>
                  Rated {timeAgo(rating.rated_at)}
                </span>
              )}
              {rating.rated_by_model && (
                <span className="job-modal-model" title={`Rated by: ${rating.rated_by_model}`}>
                  {prettyRatedBy(rating.rated_by_model)}
                </span>
              )}
            </p>
          </div>
          <div className="job-modal-header-aside">
            <ScoreBadge score={rating.score} size="lg" loading={!!job.rating_in_progress} />
            <button onClick={onClose} className="btn btn-ghost job-modal-close" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body, scrollable */}
        <div className="job-modal-body">
          {job.rating_in_progress && (
            <p
              style={{
                fontSize: "var(--text-base)",
                color: "var(--accent)",
                lineHeight: 1.6,
                margin: "0 0 var(--space-5)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--accent-light)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--accent-light)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
              }}
            >
              <span className="score-badge-spinner" style={{ width: 13, height: 13 }} />
              AI is rating this job against your CV right now, check back in a moment.
            </p>
          )}
          {jobDetail?.past_rejection_reason && (
            <p
              style={{
                display: "flex",
                gap: "var(--space-2)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                margin: "0 0 var(--space-4)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--danger-bg)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--danger-border)",
              }}
            >
              You were rejected at {company || "this company"} before
              {jobDetail.past_rejection_title ? ` (${jobDetail.past_rejection_title})` : ""}: "
              {jobDetail.past_rejection_reason}"
            </p>
          )}
          {rating.verdict && rating.verdict !== "Not rated yet" && (
            <p
              style={{
                fontSize: "var(--text-base)",
                color: "var(--text-secondary)",
                lineHeight: 1.65,
                margin: "0 0 var(--space-5)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--bg-secondary)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              {rating.verdict}
            </p>
          )}

          {rating.matched_strengths && rating.matched_strengths.length > 0 && (
            <div style={{ marginBottom: "var(--space-5)" }}>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--success)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "var(--space-3)",
                }}
              >
                Strengths
              </p>
              {rating.matched_strengths.map((s, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}
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
                      fontSize: "var(--text-base)",
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
            <div style={{ marginBottom: "var(--space-5)" }}>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "#f97316",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "var(--space-3)",
                }}
              >
                Gaps
              </p>
              {rating.gaps.map((g, i) => (
                <div
                  key={i}
                  style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}
                >
                  <span style={{ color: "#f97316", fontWeight: 700, flexShrink: 0 }}>−</span>
                  <span
                    style={{
                      fontSize: "var(--text-base)",
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

          {rating.score !== null && rating.score > 0 && (
            <div
              style={{
                marginBottom: "var(--space-5)",
                padding: "var(--space-3) var(--space-4)",
                background: "var(--bg-secondary)",
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
              }}
            >
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "var(--space-3)",
                }}
              >
                Rate this AI review
              </p>
              <StarRating value={starRating} onChange={setStarRating} />
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                  margin: "var(--space-3) 0 var(--space-2)",
                }}
              >
                Did this rating miss something? Your rating and note help calibrate ratings on
                similar jobs.
              </p>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What did this rating get right or wrong?"
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
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                <button
                  type="button"
                  onClick={handleSubmitFeedback}
                  disabled={feedbackSubmitting || (!feedbackText.trim() && !starRating)}
                  className="btn btn-primary"
                  style={{ padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-sm)" }}
                >
                  {feedbackSubmitting ? (
                    <Loader size={13} className="animate-spin" />
                  ) : feedbackSubmitted ? (
                    "Update feedback"
                  ) : (
                    "Submit"
                  )}
                </button>
              </div>
            </div>
          )}

          {job.full_text && (
            <div>
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "var(--space-3)",
                }}
              >
                Full job description
              </p>
              <p
                style={{
                  fontSize: "var(--text-sm)",
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

        {/* Footer, always visible so a job can be re-rated even before it has a score */}
        <div className="job-modal-footer">
          {(rating.score ?? 0) >= MIN_APPLY_PACK_SCORE && (
            <>
              {!packReady && (
                <button
                  type="button"
                  onClick={() => handleApplyPack()}
                  disabled={packLoading}
                  aria-busy={packLoading}
                  className="btn btn-primary job-modal-apply-pack"
                >
                  {packLoading ? (
                    <Loader size={15} className="animate-spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {packLoading ? "CV is on the way…" : "Build CV + cover letter"}
                </button>
              )}
              {packReady && (
                <details className="job-modal-dl">
                  <summary className="btn btn-primary job-modal-apply-pack">
                    <Download size={15} />
                    Download files
                  </summary>
                  <div className="job-modal-dl-menu">
                    <button
                      type="button"
                      onClick={handleDownloadCv}
                      disabled={cvDownloading}
                      className="btn btn-secondary job-modal-dl-item"
                    >
                      {cvDownloading ? (
                        <Loader size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      Tailored CV (PDF)
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadCoverLetter}
                      disabled={coverDownloading}
                      className="btn btn-secondary job-modal-dl-item"
                    >
                      {coverDownloading ? (
                        <Loader size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      Cover letter (PDF)
                    </button>
                  </div>
                </details>
              )}
              <p
                className={`job-modal-pack-hint${packLoading ? " is-waiting" : ""}`}
                title={packLoading ? packStageText || "" : packHint}
              >
                {packLoading
                  ? packStageText || "Your CV is in the oven…"
                  : packReady
                    ? cvOverflow
                      ? "Ready. CV ran to 2 pages, trim a project if you want one page."
                      : "Ready. Open the menu to download the CV or cover letter."
                    : packHint}
              </p>
              {packError && (
                <p className="job-modal-pack-error" role="alert">
                  {packError}
                  {!packLoading && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="job-modal-pack-retry"
                        onClick={() => handleApplyPack(packReady)}
                      >
                        Try again
                      </button>
                    </>
                  )}
                </p>
              )}
              {packReady && packAts && (
                <div className="job-modal-ats-panel" style={{ transition: "opacity 0.2s" }}>
                  <button
                    type="button"
                    onClick={() => setAtsExpanded((v) => !v)}
                    className="job-modal-ats-score"
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      width: "100%",
                    }}
                  >
                    ATS alignment: <strong>{packAts.alignment_pct}%</strong>
                    <span
                      style={{
                        marginLeft: "auto",
                        color: "var(--text-muted)",
                        fontSize: "var(--text-xs)",
                      }}
                    >
                      {atsExpanded ? "Hide details" : "Show details"}
                    </span>
                  </button>
                  {atsExpanded && (
                    <>
                      {packAts.fixes.length > 0 && (
                        <div className="job-modal-ats-list">
                          <span className="job-modal-ats-list-label">Fixed:</span>
                          <ul>
                            {packAts.fixes.map((fix, i) => (
                              <li key={i}>{fix}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {packAts.missing.length > 0 && (
                        <div className="job-modal-ats-list">
                          <span className="job-modal-ats-list-label">Still missing:</span>
                          <ul>
                            {packAts.missing.map((kw, i) => (
                              <li key={i}>{kw}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {packReady && (
                <div className="job-modal-rebuild">
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={400}
                    placeholder="Optional: what to change. e.g. lead with the shop project, mention AWS as learning, shorter close"
                    value={packNote}
                    onChange={(e) => setPackNote(e.target.value)}
                    disabled={packLoading}
                    style={{ fontSize: "var(--text-xs)", lineHeight: 1.45, resize: "vertical" }}
                  />
                  <div className="job-modal-rebuild-btns">
                    <button
                      type="button"
                      onClick={() => handleApplyPack(true, "cv", packNote)}
                      disabled={packLoading}
                      className="btn btn-ghost btn-sm"
                    >
                      Rebuild CV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPack(true, "cover", packNote)}
                      disabled={packLoading}
                      className="btn btn-ghost btn-sm"
                    >
                      Rebuild letter
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyPack(true, "all", packNote)}
                      disabled={packLoading}
                      className="btn btn-ghost btn-sm"
                    >
                      Rebuild both
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="job-modal-footer-actions">
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn job-modal-action-btn job-modal-apply-here"
                title="Open the original listing to apply"
              >
                <ExternalLink size={14} /> Apply here
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
                title="Copy job + CV context, paste into ChatGPT/Claude/Grok to build your own CV"
              >
                {copiedBrief ? (
                  <>
                    <Check size={14} /> Copied
                  </>
                ) : (
                  <>
                    <ClipboardCopy size={14} /> Copy apply pack
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
