import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Briefcase,
  Check,
  Clock,
  ExternalLink,
  Kanban,
  LayoutGrid,
  MapPin,
  Menu,
  Radar,
  Search,
  Shield,
  Sparkles,
  Star,
  UserCircle,
  X,
  Zap,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ScoreBadge } from "../components/ScoreBadge";

const FEATURES = [
  {
    title: "Multi-board search",
    desc: "One button searches Jooble and Indeed for the roles and cities you set. Each market runs on its own. Duplicates get filtered out by URL.",
    Icon: Search,
  },
  {
    title: "Rich profile setup",
    desc: "Your CV is step one. Then add your about-me, target roles, locations, experience level, work mode, salary floor, and key skills. More detail, sharper scores.",
    Icon: UserCircle,
  },
  {
    title: "AI fit scoring",
    desc: "Each job gets a 1 to 10 score from your full profile: CV, preferences, and notes, plus strengths, gaps, and tailoring tips for that specific listing.",
    Icon: Sparkles,
  },
  {
    title: "Learns from your corrections",
    desc: "Rate the AI's rating 1 to 5 stars and leave a note when it misses something. That feedback gets pulled in the next time a similar job comes up, so scoring gets more consistent with you over time.",
    Icon: Star,
  },
  {
    title: "Kanban pipeline",
    desc: "Drag jobs from New to Saved to Applied to Interview to Offer. Always know where you left off.",
    Icon: Kanban,
  },
  {
    title: "Apply packs",
    desc: "Get a tailored summary and talking points per role so you're not blasting the same generic application everywhere.",
    Icon: Briefcase,
  },
];

const WITHOUT = [
  "Five job board tabs open, reading the same listings over and over",
  "Fit scores based on a bare resume with no role, market, or experience context",
  "The same AI mistake on every similar listing because nothing you say sticks",
  "Applications living in a spreadsheet you stopped updating weeks ago",
];

const WITH = [
  "One search across every board, tuned to your roles and locations",
  "Every job scored against your full profile: CV, preferences, and about-you notes",
  "Rate a rating wrong and it calibrates every similar job after that",
  "A Kanban board that shows where each application actually stands",
];

const STACK = [
  "React 18 + TypeScript + Vite",
  "FastAPI + Motor (MongoDB)",
  "LangChain (split main + rating LLM)",
  "FAISS RAG for JD context + rating calibration",
  "TanStack Query + Zustand",
  "Jooble · JobsAPI (Indeed)",
];

const HOW_IT_WORKS = [
  {
    title: "Set up your profile",
    body: "Upload your CV, write a short about-me, and fill in job search prefs: target role, locations, experience level, work mode, salary, and skills. Five extra minutes here makes the ratings much better.",
  },
  {
    title: "Search your markets",
    body: "JobRadar runs searches on Jooble and Indeed using those prefs, or paste in a job description directly. Each location is searched separately and repeat listings are cut.",
  },
  {
    title: "AI scores every listing",
    body: "Every job gets scored against your full profile, not just keywords on a PDF. You get a fit score, strengths, gaps, and tips for that application.",
  },
  {
    title: "Rate the rating",
    body: "Disagree with a score? Leave a star rating and a note right on the job. The next similar listing gets rated with that feedback in mind.",
  },
  {
    title: "Track on Kanban",
    body: "Move jobs through Saved, Applied, Interview, and Offer as you go. No more losing track in your inbox.",
  },
];

const PREVIEW_JOBS = [
  {
    source: "Indeed",
    title: "Senior Frontend Engineer",
    company: "Linear",
    location: "Remote",
    score: 9,
    summary:
      "Strong match on React and TypeScript. Lead with the production systems you've shipped solo.",
    status: "APPLIED",
    borderColor: "var(--success)",
  },
  {
    source: "Jooble",
    title: "Full Stack Developer",
    company: "Vercel",
    location: "Remote · EU",
    score: 8,
    summary: "Solid overlap on Next.js and API design. Mention your FastAPI side projects.",
    status: "SAVED",
    borderColor: "var(--accent)",
  },
  {
    source: "Manual",
    title: "Software Engineer",
    company: "Stripe",
    location: "Dublin",
    score: 7,
    summary:
      "Pasted this one in directly. Good backend fit. Light on distributed systems, so mention any exposure in your cover letter.",
    status: "NEW",
    borderColor: "var(--warning)",
  },
];

const HERO_STATS = [
  { label: "Boards searched", value: "2", accent: "is-accent" },
  { label: "Profile inputs", value: "10+", accent: "" },
  { label: "AI fit score", value: "1-10", accent: "is-success" },
];

const heroWords = "Stop scrolling job boards. Let the radar find your matches.".split(" ");
const HERO_HIGHLIGHT = new Set(["radar", "matches."]);

function PreviewJobCard({
  source,
  title,
  company,
  location,
  score,
  summary,
  status,
  borderColor,
}: {
  source: string;
  title: string;
  company: string;
  location: string;
  score: number;
  summary: string;
  status: string;
  borderColor: string;
}) {
  return (
    <div className="card job-card" style={{ borderLeft: `3px solid ${borderColor}`, minHeight: 0 }}>
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
              {source}
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
          </div>
          <h3
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.4,
              margin: "0 0 4px",
            }}
          >
            {title}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11.5,
                color: "var(--text-secondary)",
              }}
            >
              <Building2 size={11} /> {company}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11.5,
                color: "var(--text-secondary)",
              }}
            >
              <MapPin size={11} /> {location}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <ScoreBadge score={score} size="sm" />
          <ExternalLink size={11} style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
      <p
        style={{
          fontSize: 11.5,
          color: "var(--text-secondary)",
          margin: "0 0 10px",
          lineHeight: 1.5,
        }}
      >
        {summary}
      </p>
      <div className="job-card-footer" style={{ paddingTop: 10 }}>
        <span className="job-card-status-select" style={{ color: "var(--accent)", fontSize: 10.5 }}>
          {status}
        </span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const year = new Date().getFullYear();

  return (
    <div className="landing-page">
      <div className="landing-bg" aria-hidden>
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
      </div>

      <header className="landing-nav">
        <div className="landing-nav-inner">
          <Link to="/" className="landing-nav-brand">
            <Logo size={32} wordmarkSize={19} />
          </Link>

          <nav className={`landing-nav-links ${menuOpen ? "is-open" : ""}`}>
            <a href="#preview" onClick={() => setMenuOpen(false)}>
              Preview
            </a>
            <a href="#features" onClick={() => setMenuOpen(false)}>
              Features
            </a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>
              How it works
            </a>
            <a href="#stack" onClick={() => setMenuOpen(false)}>
              Tech stack
            </a>
            <Link to="/privacy" onClick={() => setMenuOpen(false)}>
              Privacy
            </Link>
            <Link to="/login" className="btn btn-secondary" onClick={() => setMenuOpen(false)}>
              Log in
            </Link>
            <Link to="/login" className="btn btn-primary" onClick={() => setMenuOpen(false)}>
              Get started
            </Link>
          </nav>

          <div className="landing-nav-actions">
            <ThemeToggle />
            <button
              type="button"
              className="btn btn-ghost landing-menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">
              <Radar size={14} strokeWidth={2.5} />
              Job search that knows your full profile
            </p>

            <h1 className="landing-hero-title">
              {heroWords.map((word, i) => (
                <span
                  key={`${word}-${i}`}
                  className={HERO_HIGHLIGHT.has(word) ? "landing-hero-highlight" : undefined}
                >
                  {word}
                </span>
              ))}
            </h1>

            <p className="landing-hero-sub">
              Upload your CV, tell us which markets and roles you're targeting, and JobRadar
              searches the boards, scores every listing against your full profile, and keeps your
              pipeline on a Kanban board. The more you fill in Settings, the sharper the scores get.
            </p>

            <div className="landing-hero-actions">
              <Link to="/login" className="btn btn-primary landing-cta-btn">
                Get started free
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
              <a href="#preview" className="btn btn-ghost landing-cta-btn">
                See dashboard preview
              </a>
            </div>

            <div className="landing-stats">
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="dash-metric">
                  <span className="dash-metric-label">{stat.label}</span>
                  <span className={`dash-metric-value ${stat.accent}`.trim()}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="preview" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-section-label">Preview</p>
            <h2>What the dashboard looks like</h2>
            <p>
              Search once, filter by fit score, and work through AI-rated listings. Same view you
              get after signing in.
            </p>
          </div>

          <div className="landing-preview-wrap">
            <div className="landing-preview-browser card">
              <div className="landing-preview-bar">
                <span />
                <span />
                <span />
                <div className="landing-preview-url">jobradar.app/dashboard</div>
              </div>

              <div className="landing-preview-body">
                <div className="landing-preview-top">
                  <span className="landing-preview-brand">
                    <LayoutGrid size={14} /> JobRadar
                  </span>
                  <span className="landing-preview-user">Saim · Developer</span>
                </div>

                <p className="dash-greeting">Good afternoon,</p>
                <p className="landing-preview-greet-name">Saim.</p>

                <div className="dash-metrics landing-preview-metrics">
                  <div className="dash-metric">
                    <span className="dash-metric-label">Total jobs</span>
                    <span className="dash-metric-value">47</span>
                  </div>
                  <div className="dash-metric">
                    <span className="dash-metric-label">Strong matches</span>
                    <span className="dash-metric-value is-success">12</span>
                  </div>
                  <div className="dash-metric">
                    <span className="dash-metric-label">Applied</span>
                    <span className="dash-metric-value is-accent">8</span>
                  </div>
                  <div className="dash-metric">
                    <span className="dash-metric-label">Unrated</span>
                    <span className="dash-metric-value is-warning">5</span>
                  </div>
                </div>

                <div className="landing-preview-toolbar">
                  <button type="button" className="btn btn-primary" style={{ fontSize: 12 }}>
                    <Search size={14} /> Search jobs
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }}>
                    <Sparkles size={14} /> Rate all
                  </button>
                  <span className="landing-preview-filter">6+</span>
                  <span className="landing-preview-filter is-active">7+</span>
                  <span className="landing-preview-filter">8+</span>
                </div>

                <div className="landing-preview-grid">
                  {PREVIEW_JOBS.map((job) => (
                    <PreviewJobCard key={job.title} {...job} />
                  ))}
                </div>
              </div>
            </div>
            <p className="landing-preview-caption">
              Mockup only. Sign in, set up your profile in Settings, then run real searches for live
              ratings tuned to your roles and markets.
            </p>
          </div>
        </section>

        <section id="features" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-section-label">Features</p>
            <h2>One place for the whole hunt</h2>
            <p>
              Find roles, score fit, and track applications without five browser tabs and a
              spreadsheet that stopped making sense two weeks ago.
            </p>
          </div>

          <div className="landing-feature-grid">
            {FEATURES.map((f) => (
              <article key={f.title} className="card card-hover landing-feature-card">
                <span className="landing-feature-icon">
                  <f.Icon size={20} strokeWidth={2} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-section-label">Workflow</p>
            <h2>How it works</h2>
          </div>

          <div className="landing-steps">
            <div className="landing-steps-line" aria-hidden />
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title} className="landing-step">
                <div className="landing-step-num">{i + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="landing-section landing-compare-section">
          <div className="landing-compare">
            <div className="card card-hover landing-compare-card">
              <h3>Without JobRadar</h3>
              <ul>
                {WITHOUT.map((line) => (
                  <li key={line}>
                    <X size={16} color="var(--danger)" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="card card-hover landing-compare-card is-highlight">
              <h3>With JobRadar</h3>
              <ul>
                {WITH.map((line) => (
                  <li key={line}>
                    <Check size={16} color="var(--accent)" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="stack" className="landing-section">
          <div className="landing-stack">
            <div className="landing-stack-copy">
              <p className="landing-section-label">Tech stack</p>
              <h2>How it's built</h2>
              <p>
                React frontend on TanStack Query, FastAPI backend, MongoDB for storage, and
                LangChain with two LLMs: one for CV parsing, a faster one for bulk job ratings
                against your CV and saved preferences. FAISS retrieval picks the most relevant JD
                context and pulls in your past feedback on similar jobs.
              </p>
              <ul className="landing-stack-list">
                {STACK.map((item) => (
                  <li key={item}>
                    <Zap size={12} strokeWidth={2.5} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="card landing-flow-card">
              <div className="landing-flow-head">
                <Shield size={18} />
                <h3>How a search works</h3>
              </div>
              <ol>
                <li>
                  <strong>Build profile.</strong> CV gets parsed to structured data. You add
                  about-me, roles, locations, experience level, work mode, salary, and skills in
                  Settings.
                </li>
                <li>
                  <strong>Search jobs.</strong> Crawlers hit Jooble and Indeed (via JobsAPI) using
                  your prefs, or paste a JD in directly. Each market is searched separately.
                  Duplicates are cut.
                </li>
                <li>
                  <strong>AI rates each listing.</strong> Rating LLM scores fit 1 to 10 from your CV
                  plus preferences, retrieving the most relevant parts of the JD by search rather
                  than just truncating it. You get strengths, gaps, and tailoring tips.
                </li>
                <li>
                  <strong>You rate the rating.</strong> Star it and leave a note when it's off. That
                  feedback gets retrieved again next time a similar job comes up.
                </li>
                <li>
                  <strong>Track on Kanban.</strong> Drag cards through your pipeline. Status stays
                  in sync on the dashboard and board.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <section className="landing-section landing-cta-section">
          <div className="card landing-cta-card">
            <h2>Ready to stop scrolling?</h2>
            <p>
              Sign up, fill in your CV and job prefs, and run your first multi-board search in a few
              minutes.
            </p>
            <div className="landing-hero-actions">
              <Link to="/login" className="btn btn-primary landing-cta-btn">
                Get started free
                <ArrowRight size={16} strokeWidth={2.5} />
              </Link>
              <Link to="/login" className="btn btn-ghost landing-cta-btn">
                I already have an account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-bottom">
            <div className="landing-footer-brand">
              <Logo size={28} wordmarkSize={17} />
              <p>Find roles that fit. Track where you applied.</p>
            </div>

            <nav className="landing-footer-nav" aria-label="Footer">
              <a href="#preview">Preview</a>
              <a href="#features">Features</a>
              <a href="#how-it-works">How it works</a>
              <a href="#stack">Tech stack</a>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/login">Log in</Link>
            </nav>

            <p className="landing-footer-copy">© {year} JobRadar</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
