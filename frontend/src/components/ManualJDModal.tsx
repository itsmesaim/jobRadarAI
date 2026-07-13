import { useState } from "react";
import { X, Link, FileText, Loader } from "lucide-react";
import toast from "react-hot-toast";
import { jobsApi, scrapeApi } from "../api/index";
import { ScoreBadge } from "./ScoreBadge";
import { parseLimitKindFromDetail, type LimitKind } from "./LimitContactModal";

interface Props {
  onClose: () => void;
  onAdded: () => void;
  onLimitReached?: (kind: LimitKind) => void;
  canRate?: boolean;
  ratingsRemaining?: number;
}

type RatingResult = {
  score: number;
  verdict: string;
  matched_strengths: string[];
  gaps: string[];
};

type ManualJDResponse = {
  message: string;
  id?: string;
  detail?: string;
  score?: number;
  verdict?: string;
  matched_strengths?: string[];
  gaps?: string[];
};

export function ManualJDModal({
  onClose,
  onAdded,
  onLimitReached,
  canRate = true,
  ratingsRemaining,
}: Props) {
  const [tab, setTab] = useState<"url" | "paste">("paste");
  const [url, setUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [form, setForm] = useState({
    title: "",
    company: "",
    url: "",
    jd_text: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RatingResult | null>(null);

  const handleScrape = async () => {
    if (!url.trim()) {
      toast.error("Enter a URL");
      return;
    }
    setScraping(true);
    try {
      const data = await scrapeApi.fetchJobFromUrl(url);
      setForm((f) => ({
        ...f,
        url,
        jd_text: data.text,
        title: f.title || data.title.split("|")[0].trim().slice(0, 80),
      }));
      setTab("paste");
      toast.success("Job details fetched, review and rate");
    } catch {
      toast.error("Could not fetch URL. Paste the JD manually.");
      setTab("paste");
    } finally {
      setScraping(false);
    }
  };

  const handleRate = async () => {
    if (!canRate) {
      toast.error(
        "Daily rating limit reached. Job can be saved but not rated until your quota resets.",
        { duration: 6000 },
      );
      onLimitReached?.("rating");
      return;
    }
    if (!form.title || !form.company || !form.jd_text) {
      toast.error("Title, company, and JD text are required");
      return;
    }
    setLoading(true);
    try {
      const res = (await jobsApi.addManual(form)) as ManualJDResponse;

      if (res.message?.toLowerCase().includes("limit reached")) {
        const isToken = res.message.toLowerCase().includes("token");
        const detail =
          res.detail ||
          (isToken
            ? "Daily AI token limit reached. Job saved, try again tomorrow or contact support."
            : "Daily rating limit reached. Job saved, you can rate it later from your list.");
        toast.error(detail, { duration: 6000 });
        onAdded();
        onClose();
        onLimitReached?.(isToken ? parseLimitKindFromDetail(detail) : "rating");
        return;
      }

      if (res.score == null || !res.verdict || !res.matched_strengths || !res.gaps) {
        toast.error(res.detail || "Could not rate this job. Try again later.");
        onAdded();
        return;
      }

      setResult({
        score: res.score,
        verdict: res.verdict,
        matched_strengths: res.matched_strengths,
        gaps: res.gaps,
      });
      onAdded();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail === "Job already exists.") {
        toast.error("This job is already in your list");
      } else {
        toast.error(detail || "Failed to rate job");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "var(--space-4)",
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-4) var(--space-5)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ fontWeight: 600, fontSize: "var(--text-base)" }}>Add a job</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "flex",
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "var(--space-5)" }}>
          {!result ? (
            <>
              {/* Tab toggle */}
              <div
                style={{
                  display: "flex",
                  background: "var(--bg-secondary)",
                  borderRadius: "var(--radius)",
                  padding: "var(--space-1)",
                  marginBottom: "var(--space-4)",
                }}
              >
                {[
                  { id: "url", icon: Link, label: "Paste URL" },
                  { id: "paste", icon: FileText, label: "Paste JD text" },
                ].map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id as "url" | "paste")}
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-3)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "var(--text-xs)",
                      fontWeight: 500,
                      border: "none",
                      cursor: "pointer",
                      transition: "all 0.15s",
                      background: tab === id ? "var(--bg-card)" : "transparent",
                      color: tab === id ? "var(--text)" : "var(--text-muted)",
                      boxShadow: tab === id ? "var(--shadow)" : "none",
                    }}
                  >
                    <Icon size={13} />
                    {label}
                  </button>
                ))}
              </div>

              {tab === "url" ? (
                <div style={{ marginBottom: "var(--space-4)" }}>
                  <label className="label">Job posting URL</label>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <input
                      className="input"
                      placeholder="https://irishjobs.ie/job/..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleScrape()}
                    />
                    <button
                      onClick={handleScrape}
                      disabled={scraping}
                      className="btn btn-primary"
                      style={{ flexShrink: 0 }}
                    >
                      {scraping ? <Loader size={13} className="animate-spin" /> : "Fetch"}
                    </button>
                  </div>
                  <p
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--text-muted)",
                      marginTop: "var(--space-2)",
                    }}
                  >
                    We'll extract the job description automatically
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "var(--space-3)",
                    }}
                  >
                    <div>
                      <label className="label">Role title *</label>
                      <input
                        className="input"
                        placeholder="Full Stack Engineer"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Company *</label>
                      <input
                        className="input"
                        placeholder="Stripe"
                        value={form.company}
                        onChange={(e) => setForm({ ...form, company: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">Job URL (optional)</label>
                    <input
                      className="input"
                      placeholder="https://..."
                      value={form.url}
                      onChange={(e) => setForm({ ...form, url: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Job description *</label>
                    <textarea
                      className="input"
                      placeholder="Paste the full job description here..."
                      value={form.jd_text}
                      onChange={(e) => setForm({ ...form, jd_text: e.target.value })}
                      style={{ height: 160, resize: "vertical" }}
                    />
                    <p
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        marginTop: "var(--space-1)",
                      }}
                    >
                      {form.jd_text.length} characters, more text = better rating
                    </p>
                  </div>
                  {!canRate && (
                    <p
                      style={{
                        margin: "0 0 var(--space-3)",
                        fontSize: "var(--text-xs)",
                        color: "#b91c1c",
                        lineHeight: 1.5,
                      }}
                    >
                      Daily rating limit reached
                      {ratingsRemaining != null ? ` (${ratingsRemaining} left)` : ""}. Your job can
                      be saved but won&apos;t be rated until tomorrow UTC or you get more access
                      from admin.
                    </p>
                  )}
                  <button
                    onClick={handleRate}
                    disabled={loading || !canRate}
                    className="btn btn-primary"
                    style={{
                      width: "100%",
                      justifyContent: "center",
                      padding: "var(--space-3)",
                      opacity: canRate ? 1 : 0.55,
                    }}
                  >
                    {loading ? (
                      <>
                        <Loader size={13} className="animate-spin" /> Rating with AI...
                      </>
                    ) : canRate ? (
                      "Rate this job"
                    ) : (
                      "Rating limit reached"
                    )}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
                  {form.title} · {form.company}
                </span>
                <ScoreBadge score={result.score} size="md" />
              </div>

              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {result.verdict}
              </p>

              {result.matched_strengths.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      color: "var(--success)",
                      marginBottom: "var(--space-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Strengths
                  </div>
                  {result.matched_strengths.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "var(--space-2)",
                        marginBottom: "var(--space-1)",
                      }}
                    >
                      <span style={{ color: "var(--success)", fontWeight: 700 }}>+</span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                        {s}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {result.gaps.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: 600,
                      color: "#f97316",
                      marginBottom: "var(--space-2)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Gaps to address
                  </div>
                  {result.gaps.map((g, i) => (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: "var(--space-2)",
                        marginBottom: "var(--space-1)",
                      }}
                    >
                      <span style={{ color: "#f97316", fontWeight: 700 }}>−</span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                        {g}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <button
                  onClick={onClose}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Done
                </button>
                <button
                  onClick={() => {
                    setResult(null);
                    setForm({ title: "", company: "", url: "", jd_text: "" });
                  }}
                  className="btn btn-ghost"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Add another
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
