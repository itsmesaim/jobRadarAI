import { AlertCircle, Mail } from "lucide-react";

export type LimitKind = "rating" | "search" | "token_daily" | "token_monthly" | "apply_pack";

const ADMIN_EMAIL = "saimkaskar1@gmail.com";

const COPY: Record<
  LimitKind,
  { title: string; subtitle: string; body: React.ReactNode; subject: string }
> = {
  rating: {
    title: "Rating limit reached",
    subtitle: "You've used all your free job ratings for today.",
    body: (
      <>
        <strong>Free accounts can rate a limited number of jobs per day.</strong>
        <br />
        To rate more jobs and unlock full access, contact the admin for extra credits.
      </>
    ),
    subject: "JobRadar - Request more rating access",
  },
  search: {
    title: "Search limit reached",
    subtitle: "You've used all your free job searches for today.",
    body: (
      <>
        <strong>Free accounts have a daily search cap.</strong>
        <br />
        Contact the admin if you need more searches, or wait until your quota resets.
      </>
    ),
    subject: "JobRadar - Request more search access",
  },
  token_daily: {
    title: "Daily AI limit reached",
    subtitle: "You've used today's AI token allowance.",
    body: (
      <>
        <strong>Your daily AI credit resets at midnight in your local timezone.</strong>
        <br />
        Ratings, searches, and CV parsing all use AI tokens. Come back tomorrow, or email the admin
        if you need more credits sooner.
      </>
    ),
    subject: "JobRadar - Request more AI credits",
  },
  token_monthly: {
    title: "Monthly AI limit reached",
    subtitle: "You've used this month's AI token allowance.",
    body: (
      <>
        <strong>Your monthly AI credit resets on the 1st of next month.</strong>
        <br />
        Contact the admin if you need a higher cap before then.
      </>
    ),
    subject: "JobRadar - Request more AI credits",
  },
  apply_pack: {
    title: "Apply pack: Pro feature",
    subtitle: "You've used your free apply pack for today (or need premium access).",
    body: (
      <>
        <strong>Apply pack</strong> generates ATS keywords, Google XYZ bullets, a cover note opener,
        and a LaTeX snippet tailored to each job.
        <br />
        <br />
        Free accounts get <strong>1 apply pack per day</strong>. Premium (full access) is unlimited,
        email the admin to upgrade.
      </>
    ),
    subject: "JobRadar - Request Apply pack / premium access",
  },
};

export function parseLimitKindFromDetail(detail: string): LimitKind {
  const lower = detail.toLowerCase();
  if (lower.includes("token")) {
    return lower.includes("/month") || lower.includes("monthly") ? "token_monthly" : "token_daily";
  }
  if (lower.includes("apply pack") || lower.includes("premium feature")) {
    return "apply_pack";
  }
  if (lower.includes("search")) return "search";
  return "rating";
}

export function LimitContactModal({ kind, onClose }: { kind: LimitKind; onClose: () => void }) {
  const copy = COPY[kind];
  const mailto = `mailto:${ADMIN_EMAIL}?subject=${encodeURIComponent(copy.subject)}&body=${encodeURIComponent(`Hi,\n\nI've reached my ${kind.replace("_", " ")} limit on JobRadar and would like more access.\n\nThank you!`)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="limit-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)",
          color: "var(--text)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          maxWidth: 420,
          width: "100%",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-4)",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AlertCircle size={22} color="var(--danger)" />
          </div>
          <div>
            <h3
              id="limit-modal-title"
              style={{
                margin: 0,
                fontSize: "var(--text-xl)",
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              {copy.title}
            </h3>
            <p
              style={{
                margin: "var(--space-1) 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.45,
              }}
            >
              {copy.subtitle}
            </p>
          </div>
        </div>

        <div
          style={{
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            color: "var(--text-secondary)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius)",
            marginBottom: "var(--space-5)",
            fontSize: "var(--text-base)",
            lineHeight: 1.6,
          }}
        >
          <div style={{ color: "var(--text)" }}>{copy.body}</div>
        </div>

        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <a
            href={mailto}
            className="btn btn-primary"
            style={{
              flex: "1 1 180px",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-2)",
            }}
          >
            <Mail size={16} /> Email for more access
          </a>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost"
            style={{ flex: "0 1 auto" }}
          >
            Maybe later
          </button>
        </div>

        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            textAlign: "center",
            marginTop: "var(--space-4)",
            lineHeight: 1.55,
          }}
        >
          Daily limits reset at{" "}
          <strong style={{ color: "var(--text-secondary)" }}>
            midnight in your local timezone
          </strong>
          <br />
          Email: <strong style={{ color: "var(--text-secondary)" }}>{ADMIN_EMAIL}</strong>
        </div>
      </div>
    </div>
  );
}
