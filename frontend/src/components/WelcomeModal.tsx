import { useEffect, useState } from "react";
import { Upload, Settings, Search, Zap, Star, LayoutDashboard, X, ArrowRight } from "lucide-react";

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
    icon: LayoutDashboard,
    color: "var(--accent)",
    bg: "var(--accent-light)",
    title: "Track in Kanban",
    desc: "Move jobs through New → Saved → Applied → Interviewing → Offer. The Kanban board keeps your pipeline organised.",
    action: { label: "Go to Kanban →", href: "/kanban" },
  },
  {
    icon: Star,
    color: "var(--warning)",
    bg: "var(--warning-bg)",
    title: "Rate the AI's ratings",
    desc: "Open a job and use the star rating + note under its review to tell us when it got something wrong. That feedback calibrates how similar jobs get rated next time.",
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
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (forceOpen) {
      setStep(0);
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

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          maxWidth: 440,
          width: "100%",
          padding: "var(--space-6)",
          boxShadow: "var(--shadow-lg)",
          position: "relative",
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

        {/* Step dots */}
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

        {/* Icon */}
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

        {/* Content */}
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

        {/* Actions */}
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
      </div>
    </div>
  );
}
