import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Radar, Sparkles, KanbanSquare, ShieldCheck, X, Check, ShieldQuestion } from "lucide-react";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";

const FEATURES = [
  {
    icon: Radar,
    title: "Crawl every board at once",
    body: "Search Jooble and Indeed in parallel, deduplicated automatically so you never see the same posting twice.",
  },
  {
    icon: Sparkles,
    title: "AI ratings against your CV",
    body: "Upload your resume once. Every job gets a fit score, strengths, gaps, and tailoring tips — not a generic keyword match.",
  },
  {
    icon: KanbanSquare,
    title: "Track applications on a board",
    body: "Drag jobs through Saved, Applied, Interview, Offer. One place to see where every application actually stands.",
  },
  {
    icon: ShieldCheck,
    title: "Your data, your account",
    body: "Ratings and pipeline status are private to you. Delete your CV or account data any time from Settings.",
  },
];

const WITHOUT = [
  "Tabbing between five job boards a day, re-reading the same listings",
  "Guessing whether your CV even matches before you apply",
  "Applications tracked in a messy spreadsheet, if at all",
  "No idea which listings are worth the 20 minutes to tailor a resume",
];

const WITH = [
  "One search hits every board, deduplicated automatically",
  "Every job scored against your CV with strengths and gaps called out",
  "A Kanban board that shows exactly where each application stands",
  "AI tailoring tips so you know what to emphasize before you apply",
];

const heroWords = "Stop scrolling job boards. Let the radar find your matches.".split(" ");

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

export function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", overflowX: "hidden" }}>
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
        <section style={{ textAlign: "center", maxWidth: 680, margin: "0 auto 72px" }}>
          <h1
            className="landing-hero-title"
            style={{
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
              color: "var(--text)",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
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
                style={{ display: "inline-block" }}
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
            JobRadar crawls multiple job boards, rates every listing against your CV with AI, and
            tracks your applications on a Kanban board — so you spend time applying, not searching.
          </motion.p>
          <motion.div
            className="landing-hero-actions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.5 }}
            style={{ display: "flex", gap: 12, justifyContent: "center" }}
          >
            <Link to="/login" className="btn btn-primary" style={{ padding: "10px 20px" }}>
              Get started free
            </Link>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 20,
              padding: "8px 14px",
              borderRadius: 999,
              background: "var(--accent-light)",
              border: "1px solid var(--accent)",
            }}
          >
            <ShieldQuestion size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--text)" }}>
              Please read our{" "}
              <Link to="/privacy" style={{ color: "var(--accent)", fontWeight: 600 }}>
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link to="/terms" style={{ color: "var(--accent)", fontWeight: 600 }}>
                Terms of Service
              </Link>{" "}
              before creating an account.
            </span>
          </motion.div>
        </section>

        {/* Without us / with us */}
        <motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
          className="landing-compare"
          style={{ display: "grid", gap: 16, marginBottom: 72 }}
        >
          <motion.div
            variants={fadeUp}
            className="card"
            style={{ padding: 24, borderColor: "var(--border)" }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}>
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
                  <span style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {line}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="card"
            style={{
              padding: 24,
              borderColor: "var(--accent)",
              background: "linear-gradient(180deg, var(--accent-light) 0%, var(--bg-card) 55%)",
            }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 16px", color: "var(--text)" }}>
              With JobRadar
            </h3>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
              {WITH.map((line) => (
                <li key={line} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <Check size={16} color="var(--accent)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5 }}>
                    {line}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.section>

        {/* Features */}
        <motion.section
          className="landing-features"
          style={{ display: "grid", gap: 16 }}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.15 }}
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <motion.div key={title} variants={fadeUp} className="card" style={{ padding: 20 }}>
              <Icon size={22} color="var(--accent)" style={{ marginBottom: 12 }} />
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  margin: "0 0 6px",
                  color: "var(--text)",
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {body}
              </p>
            </motion.div>
          ))}
        </motion.section>
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
  );
}
