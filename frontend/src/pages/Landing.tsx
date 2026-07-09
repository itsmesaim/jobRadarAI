import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Building2, MapPin, ExternalLink, Clock, Check, X } from "lucide-react";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ScoreBadge } from "../components/ScoreBadge";

const HOW_IT_WORKS = [
  {
    title: "Upload your CV, hit search",
    body: "JobRadar searches Jooble and Indeed for you in one go and pulls in fresh postings you haven't already seen.",
  },
  {
    title: "AI reads every listing against your CV",
    body: "Each job gets compared to your actual experience, not just keywords. You get a fit score, what matches, what's missing, and tips for tailoring your application.",
  },
  {
    title: "Track it on a Kanban board",
    body: "Move jobs through Saved, Applied, Interview, Offer as you go, so you know where things stand instead of losing track in your inbox.",
  },
];

const WITHOUT = [
  "Tabbing between five job boards a day, re-reading the same listings",
  "Guessing whether your CV even matches before you apply",
  "Applications tracked in a messy spreadsheet, if at all",
  "No idea which listings are worth the 20 minutes it takes to tailor a resume",
];

const WITH = [
  "One search hits every board, deduplicated automatically",
  "Every job scored against your CV, with strengths and gaps called out",
  "A Kanban board that shows exactly where each application stands",
  "AI tailoring tips so you know what to emphasize before you apply",
];

const heroWords = "Stop scrolling job boards. Let the radar find your matches.".split(" ");
const HERO_HIGHLIGHT = new Set(["radar", "matches."]);

const wordVariants = {
  hidden: { opacity: 0, y: 12 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.035, duration: 0.4, ease: "easeOut" as const },
  }),
};

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

// Mirrors the real dashboard's job-card markup (components/JobCard.tsx) —
// same classes, same layout — so this is what the product actually looks like.
function ProductPreview() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.4, duration: 0.6, ease: "easeOut" }}
      style={{
        position: "relative",
        maxWidth: 380,
        width: "100%",
        margin: "0 auto",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -30,
          background: "radial-gradient(circle at 50% 30%, var(--accent-light) 0%, transparent 70%)",
          filter: "blur(20px)",
          zIndex: 0,
        }}
      />
      <div
        className="card card-hover job-card"
        style={{ position: "relative", zIndex: 1, borderLeft: "3px solid var(--success)" }}
      >
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
                Indeed
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                }}
              >
                <Clock size={10} /> Posted 3h ago
              </span>
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
            </div>

            <h3
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.4,
                margin: "0 0 5px",
              }}
            >
              Senior Frontend Engineer
            </h3>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                <Building2 size={11} /> Linear
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                <MapPin size={11} /> Remote
              </span>
            </div>
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
            <ScoreBadge score={9} size="md" />
            <ExternalLink size={12} style={{ color: "var(--text-muted)" }} />
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, marginBottom: 12 }}>
          <p
            style={{ fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.55 }}
          >
            Strong match on React and TypeScript. Lead with the production systems you've shipped
            solo.
          </p>
        </div>

        <div className="job-card-footer">
          <span className="job-card-status-select" style={{ color: "var(--accent)" }}>
            APPLIED
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function LandingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 640,
          background:
            "radial-gradient(60% 50% at 30% 0%, var(--accent-light) 0%, transparent 65%), radial-gradient(40% 40% at 85% 10%, rgba(139, 92, 246, 0.12) 0%, transparent 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            maxWidth: 1080,
            margin: "0 auto",
          }}
        >
          <Logo size={32} wordmarkSize={19} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ThemeToggle />
            <Link to="/login" className="btn btn-secondary">
              Log in
            </Link>
          </div>
        </header>

        <main style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 24px 96px" }}>
          {/* Hero */}
          <section
            className="landing-hero-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.9fr",
              gap: 40,
              alignItems: "center",
              marginBottom: 80,
            }}
          >
            <div style={{ textAlign: "left" }}>
              <h1
                className="landing-hero-title"
                style={{
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  margin: "0 0 16px",
                  color: "var(--text)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0 0.32em",
                }}
              >
                {heroWords.map((word, i) => (
                  <motion.span
                    key={`${word}-${i}`}
                    custom={i}
                    variants={wordVariants}
                    initial="hidden"
                    animate="show"
                    style={{
                      display: "inline-block",
                      ...(HERO_HIGHLIGHT.has(word)
                        ? {
                            background: "linear-gradient(90deg, var(--accent) 0%, #8b5cf6 100%)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            backgroundClip: "text",
                          }
                        : {}),
                    }}
                  >
                    {word}
                  </motion.span>
                ))}
              </h1>
              <motion.p
                className="landing-hero-sub"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                style={{
                  color: "var(--text-secondary)",
                  margin: "0 0 28px",
                  lineHeight: 1.6,
                }}
              >
                JobRadar crawls multiple job boards, rates every listing against your CV with AI,
                and tracks your applications on a Kanban board. You spend your time applying, not
                searching.
              </motion.p>
              <motion.div
                className="landing-hero-actions"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65, duration: 0.5 }}
                style={{ display: "flex", gap: 12 }}
              >
                <Link
                  to="/login"
                  className="btn btn-primary"
                  style={{ padding: "12px 20px", justifyContent: "center", fontSize: 15 }}
                >
                  Get started free
                </Link>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.5 }}
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  marginTop: 18,
                  lineHeight: 1.6,
                }}
              >
                Free to use. Your CV and ratings are private to your account, see our{" "}
                <Link to="/privacy" style={{ color: "var(--text-secondary)" }}>
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link to="/terms" style={{ color: "var(--text-secondary)" }}>
                  Terms
                </Link>
                .
              </motion.div>
            </div>

            <ProductPreview />
          </section>

          {/* How it works */}
          <motion.section
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ show: { transition: { staggerChildren: 0.12 } } }}
            style={{ marginBottom: 80 }}
          >
            <h2
              style={{
                textAlign: "center",
                fontSize: 26,
                fontWeight: 700,
                margin: "0 0 36px",
                color: "var(--text)",
              }}
            >
              How it works
            </h2>
            <div
              className="landing-steps"
              style={{
                position: "relative",
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 24,
              }}
            >
              <div
                aria-hidden
                className="landing-steps-line"
                style={{
                  position: "absolute",
                  top: 18,
                  left: "16.6%",
                  right: "16.6%",
                  height: 2,
                  background:
                    "linear-gradient(90deg, var(--accent) 0%, var(--border) 50%, var(--accent) 100%)",
                  opacity: 0.35,
                  zIndex: 0,
                }}
              />
              {HOW_IT_WORKS.map((step, i) => (
                <motion.div
                  key={step.title}
                  variants={fadeUp}
                  style={{ textAlign: "center", position: "relative", zIndex: 1 }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      color: "#fff",
                      fontWeight: 700,
                      fontSize: 15,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 14px",
                      boxShadow: "0 0 0 6px var(--accent-light)",
                    }}
                  >
                    {i + 1}
                  </div>
                  <h3
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      margin: "0 0 8px",
                      color: "var(--text)",
                    }}
                  >
                    {step.title}
                  </h3>
                  <p
                    style={{
                      fontSize: 15,
                      color: "var(--text-secondary)",
                      margin: 0,
                      lineHeight: 1.6,
                    }}
                  >
                    {step.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </motion.section>

          {/* Without us / with us */}
          <motion.section
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            className="landing-compare"
            style={{ display: "grid", gap: 16, marginBottom: 24 }}
          >
            <motion.div
              variants={fadeUp}
              className="card card-hover"
              style={{ padding: 24, borderColor: "var(--border)" }}
            >
              <h3
                style={{ fontSize: 17, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}
              >
                Without JobRadar
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
                {WITHOUT.map((line) => (
                  <li key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <X
                      size={16}
                      color="var(--danger, #ef4444)"
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <span
                      style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.55 }}
                    >
                      {line}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              variants={fadeUp}
              className="card card-hover"
              style={{
                padding: 24,
                borderColor: "var(--accent)",
                background: "linear-gradient(180deg, var(--accent-light) 0%, var(--bg-card) 55%)",
              }}
            >
              <h3
                style={{ fontSize: 17, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}
              >
                With JobRadar
              </h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
                {WITH.map((line) => (
                  <li key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <Check
                      size={16}
                      color="var(--accent)"
                      style={{ marginTop: 2, flexShrink: 0 }}
                    />
                    <span style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.55 }}>
                      {line}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </motion.section>

          <p
            style={{
              textAlign: "center",
              fontSize: 13.5,
              color: "var(--text-muted)",
              maxWidth: 460,
              margin: "0 auto",
            }}
          >
            Ratings and pipeline status are private to your account. Delete your CV or account data
            any time from Settings.
          </p>
        </main>

        <footer
          style={{
            maxWidth: 1080,
            margin: "0 auto",
            padding: "24px 24px 48px",
            display: "flex",
            justifyContent: "center",
            gap: 20,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Link to="/privacy" style={{ color: "var(--text-muted)" }}>
            Privacy Policy
          </Link>
          <Link to="/terms" style={{ color: "var(--text-muted)" }}>
            Terms of Service
          </Link>
        </footer>
      </div>
    </div>
  );
}
