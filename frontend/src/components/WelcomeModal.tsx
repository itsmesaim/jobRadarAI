import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Upload,
  Settings,
  Search,
  Zap,
  Star,
  LayoutDashboard,
  X,
  ArrowRight,
  Brain,
  HelpCircle,
  MessageSquare,
} from "lucide-react";
import { userApi } from "../api/index";
import { FaqRichText } from "./FaqRichText";
import { Overlay } from "./Modal";

const STEPS = [
  {
    icon: Upload,
    color: "var(--accent)",
    bg: "var(--accent-light)",
    title: "Upload your CV",
    desc: "Go to Settings → CV section. The AI uses it to rate every job against your actual skills and experience.",
    action: { label: "Go to Settings →", href: "/settings" },
  },
  {
    icon: Brain,
    color: "var(--purple)",
    bg: "var(--purple-bg)",
    title: "Pick your AI models",
    desc: 'Settings → AI models lets you choose which AI parses your CV and which one rates your jobs, independently. Mistral (EU-hosted) is the default, OpenAI and DeepSeek are also available. Don\'t see the model you want? Use "Request a different model" right there and the admin gets notified.',
    action: { label: "Go to Settings →", href: "/settings" },
  },
  {
    icon: Settings,
    color: "var(--purple)",
    bg: "var(--purple-bg)",
    title: "Set your preferences",
    desc: "Tell us your target role, location, key skills, and experience level. These drive every search.",
    action: { label: "Go to Settings →", href: "/settings" },
  },
  {
    icon: Search,
    color: "var(--success)",
    bg: "var(--success-bg)",
    title: "Search for jobs",
    desc: "Hit Search jobs on the dashboard. We pull from Jooble + Indeed, deduplicate, and store them in your account.",
    action: null,
  },
  {
    icon: Zap,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
    title: "Rate them all",
    desc: "Click Rate now. The AI scores each job 1–10 with matched strengths, gaps, and tailoring tips specific to your CV.",
    action: null,
  },
  {
    icon: MessageSquare,
    color: "var(--purple)",
    bg: "var(--purple-bg)",
    title: "Chat about any job",
    desc: 'Open a job to chat: ask why it scored the way it did, build a tailored CV + cover letter, or paste employer form questions. Say "I worked as X at Y" or "add Python as a skill" and it proposes an edit to your MASTER CV, you review before anything saves. Paste a JD right from chat to add a new job without leaving the conversation, and switch between jobs from the same panel.',
    action: null,
  },
  {
    icon: LayoutDashboard,
    color: "var(--accent)",
    bg: "var(--accent-light)",
    title: "Track applications",
    desc: "Move jobs through New → Saved → Applied → Interviewing → Offer on the Track board.",
    action: { label: "Go to Track →", href: "/kanban" },
  },
  {
    icon: Star,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
    title: "Rate the AI's ratings",
    desc: "Open a job and use the star rating + note under its review to tell us when it got something wrong. That feedback calibrates similar jobs immediately, and after a few corrections gets distilled into standing rules applied to every rating. See Settings → AI models → Rating calibration.",
    action: null,
  },
];

const STORAGE_KEY = "jobradar_welcomed";

interface Props {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function WelcomeModal({ forceOpen = false, onClose }: Props = {}) {
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<"guide" | "faq">("guide");
  const [faqOpen, setFaqOpen] = useState<string | null>(null);
  const [faqDraft, setFaqDraft] = useState("");
  const [faqQuery, setFaqQuery] = useState(""); // only set on Submit
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY));

  const faqQ = useQuery({
    queryKey: ["faq", faqQuery],
    queryFn: () => userApi.getFaq(faqQuery),
    enabled: visible && tab === "faq",
  });

  const submitFaqSearch = () => {
    const q = faqDraft.trim().slice(0, 500);
    setFaqQuery(q);
    setFaqOpen(null);
  };

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
      setTab("guide");
      setVisible(true);
    }
  }, [forceOpen]);

  if (!visible) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setVisible(false);
    onClose?.();
  };

  const faqItems = faqQ.data?.hits?.length ? faqQ.data.hits : faqQ.data?.items || [];

  return (
    <Overlay onClick={dismiss} zIndex={1200}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          maxWidth: 480,
          width: "100%",
          padding: "var(--space-6)",
          boxShadow: "var(--shadow-lg)",
          position: "relative",
          maxHeight: "min(88vh, 720px)",
          overflow: "auto",
        }}
      >
        {/* Close */}
        <button
          onClick={dismiss}
          style={{
            position: "absolute",
            top: "var(--space-3)",
            right: "var(--space-3)",
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            padding: "var(--space-1)",
          }}
          title="Skip"
        >
          <X size={16} />
        </button>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, marginRight: 28 }}>
          <button
            type="button"
            className={`btn ${tab === "guide" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("guide")}
            style={{ fontSize: 13, padding: "6px 12px" }}
          >
            Guide
          </button>
          <button
            type="button"
            className={`btn ${tab === "faq" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab("faq")}
            style={{ fontSize: 13, padding: "6px 12px" }}
          >
            <HelpCircle size={14} /> FAQ
          </button>
        </div>

        {tab === "guide" ? (
          <>
            <div style={{ display: "flex", gap: "var(--space-1)", marginBottom: "var(--space-6)" }}>
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  style={{
                    width: i === step ? 20 : 7,
                    height: 7,
                    borderRadius: "var(--radius-pill)",
                    border: "none",
                    cursor: "pointer",
                    background: i === step ? "var(--accent)" : "var(--border)",
                    transition: "all 0.2s",
                    padding: 0,
                  }}
                />
              ))}
            </div>

            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius)",
                background: current.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "var(--space-4)",
              }}
            >
              <Icon size={22} style={{ color: current.color }} />
            </div>

            <p
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                margin: "0 0 var(--space-2)",
              }}
            >
              Step {step + 1} of {STEPS.length}
            </p>
            <h3
              style={{
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                margin: "0 0 var(--space-3)",
                color: "var(--text)",
                letterSpacing: "-0.02em",
              }}
            >
              {current.title}
            </h3>
            <p
              style={{
                fontSize: "var(--text-base)",
                color: "var(--text-secondary)",
                margin: "0 0 var(--space-6)",
                lineHeight: 1.6,
              }}
            >
              {current.desc}
            </p>

            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              {isLast ? (
                <button
                  onClick={dismiss}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  Get started
                </button>
              ) : (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  className="btn btn-primary"
                  style={{ flex: 1, justifyContent: "center", gap: "var(--space-2)" }}
                >
                  Next <ArrowRight size={14} />
                </button>
              )}

              {current.action && (
                <a
                  href={current.action.href}
                  onClick={dismiss}
                  className="btn btn-ghost"
                  style={{ fontSize: "var(--text-sm)", whiteSpace: "nowrap" }}
                >
                  {current.action.label}
                </a>
              )}

              {step > 0 && (
                <button
                  onClick={() => setStep((s) => s - 1)}
                  className="btn btn-ghost"
                  style={{ padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-sm)" }}
                >
                  Back
                </button>
              )}
            </div>

            {!isLast && (
              <button
                onClick={dismiss}
                style={{
                  display: "block",
                  margin: "var(--space-4) auto 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "var(--text-xs)",
                  color: "var(--text-muted)",
                }}
              >
                Skip for now
              </button>
            )}
          </>
        ) : (
          <>
            <h3
              style={{
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                margin: "0 0 8px",
                letterSpacing: "-0.02em",
              }}
            >
              FAQ
            </h3>
            <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: 14 }}>
              Curated answers (no chat model / no token burn). Same corpus answers product questions
              in job chat.
            </p>
            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 12,
                alignItems: "stretch",
              }}
            >
              <input
                className="input"
                value={faqDraft}
                onChange={(e) => setFaqDraft(e.target.value.slice(0, 500))}
                placeholder="e.g. Why am I seeing junior roles?"
                style={{ flex: 1, minWidth: 0 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitFaqSearch();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitFaqSearch}
                disabled={faqQ.isFetching}
                style={{ flexShrink: 0 }}
              >
                {faqQ.isFetching ? "…" : "Ask"}
              </button>
            </div>
            {faqQuery && (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--text-muted)" }}>
                Results for “{faqQuery}”
                {faqQuery ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginLeft: 8, fontSize: 12, padding: "2px 8px" }}
                    onClick={() => {
                      setFaqQuery("");
                      setFaqDraft("");
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </p>
            )}
            {faqQ.data?.answer?.reply && (
              <div
                style={{
                  marginBottom: 12,
                  padding: 12,
                  borderRadius: "var(--radius)",
                  background: "var(--accent-light)",
                  border: "1px solid var(--border)",
                  fontSize: 14,
                  lineHeight: 1.55,
                }}
              >
                <FaqRichText text={faqQ.data.answer.reply} />
              </div>
            )}
            {faqQuery && !faqQ.isFetching && !faqQ.data?.answer?.reply && (
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-muted)" }}>
                No close FAQ match. Browse topics below, or ask in a job chat about that role.
              </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {faqItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFaqOpen(faqOpen === item.id ? null : item.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--border)",
                    background: "var(--bg-secondary)",
                    cursor: "pointer",
                    font: "inherit",
                    color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{item.question}</div>
                  {faqOpen === item.id && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        lineHeight: 1.55,
                        color: "var(--text-secondary)",
                      }}
                    >
                      <FaqRichText text={item.answer} />
                    </div>
                  )}
                </button>
              ))}
              {faqQ.isLoading && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading FAQ…</p>
              )}
            </div>
          </>
        )}
      </div>
    </Overlay>
  );
}
