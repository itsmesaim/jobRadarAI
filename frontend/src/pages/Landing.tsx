import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Briefcase,
  Check,
  ClipboardCopy,
  Clock,
  Database,
  Download,
  ExternalLink,
  Eraser,
  FileCheck2,
  Kanban,
  LayoutGrid,
  Lock,
  MapPin,
  Menu,
  Plus,
  RefreshCw,
  Scale,
  ScanSearch,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Upload,
  UserCircle,
  X,
  Zap,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { ThemeToggle } from "../components/ThemeToggle";
import { ScoreBadge } from "../components/ScoreBadge";
import { StatTile } from "../components/StatTile";
import { Reveal } from "../components/Reveal";
import { FlowDiagram, type FlowStep } from "../components/FlowDiagram";
import { RadarSweep } from "../components/RadarSweep";

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
    desc: "Download a tailored CV PDF and cover letter from your real CV for jobs that score well. Rebuild the letter without touching the CV. You pick which projects lead.",
    Icon: Briefcase,
  },
  {
    title: "You pick the AI, we host the app",
    desc: "The app lives in the EU. Rating, apply-pack, and CV parse each use a model you pick in Settings. Every rating shows which model scored it. Switching a provider is a confirmed choice.",
    Icon: Shield,
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
  "Rate a rating wrong and it calibrates similar jobs immediately, recurring corrections become a standing rule",
  "A Kanban board that shows where each application actually stands",
  "A tailored CV and cover letter PDF for the jobs that actually fit",
];

const STACK = [
  "React 18 + TypeScript + Vite",
  "FastAPI + Motor (MongoDB)",
  "LangChain (rating, apply-pack, and CV parse as separate model picks)",
  "Pick rating, apply-pack, and CV-parse models independently in Settings.",
  "FAISS RAG for JD context + rating calibration",
  "TanStack Query + Zustand",
  "Jooble · JobsAPI (Indeed)",
];

const SEARCH_FLOW: FlowStep[] = [
  {
    icon: UserCircle,
    label: "Build profile",
    desc: "CV parsed to structured data, plus roles, locations, and skills.",
    tone: "accent",
  },
  {
    icon: Search,
    label: "Search jobs",
    desc: "Jooble + Indeed crawled per market. Duplicates cut.",
    tone: "purple",
  },
  {
    icon: Sparkles,
    label: "AI rates it",
    desc: "1-10 fit score, strengths, gaps, tailoring tips.",
    tone: "success",
  },
  {
    icon: Star,
    label: "You rate it back",
    desc: "Star + note when it's off. Recalibrates from there.",
    tone: "warning",
  },
  {
    icon: Kanban,
    label: "Track on Kanban",
    desc: "Drag through Saved, Applied, Interview, Offer.",
    tone: "accent",
  },
  {
    icon: Download,
    label: "Apply pack",
    desc: "CV + cover letter PDF from your CV. Rebuild one piece if needed.",
    tone: "purple",
  },
];

const DATA_FLOW: FlowStep[] = [
  {
    icon: Upload,
    label: "You upload your CV",
    desc: "PDF text extracted server-side, original file discarded.",
    tone: "accent",
  },
  {
    icon: Eraser,
    label: "Contact details redacted",
    desc: "Phone & email stripped locally before anything leaves for AI processing.",
    tone: "purple",
  },
  {
    icon: ScanSearch,
    label: "AI parses & rates",
    desc: "The model you picked in Settings parses and rates. Confirmed if you leave the EU default.",
    tone: "success",
  },
  {
    icon: Database,
    label: "Stored in the EU",
    desc: "Structured CV + ratings on our France-hosted MongoDB.",
    tone: "warning",
  },
  {
    icon: Lock,
    label: "Always your control",
    desc: "Export or permanently delete everything, any time.",
    tone: "accent",
  },
];

const GDPR_RIGHTS: { icon: React.ElementType; title: string; desc: string }[] = [
  {
    icon: FileCheck2,
    title: "Right to access",
    desc: "Download a complete JSON export of everything we hold about you, on demand.",
  },
  {
    icon: Eraser,
    title: "Right to erasure",
    desc: "Delete just your CV, or your entire account and every job tied to it, permanently.",
  },
  {
    icon: ShieldCheck,
    title: "Data minimization",
    desc: "Phone and email are redacted before your CV ever reaches an AI provider.",
  },
  {
    icon: Scale,
    title: "Consent, not defaults",
    desc: "Switching to a provider outside the EU default requires explicit confirmation first.",
  },
];

const HOW_IT_WORKS = [
  {
    title: "Set up your profile",
    body: "Upload a CV, add about-me and search prefs. Extra minutes here make the scores sharper.",
  },
  {
    title: "Search your markets",
    body: "One search on Jooble and Indeed, or paste a JD. Each city is its own search. Duplicates are cut.",
  },
  {
    title: "AI scores every listing",
    body: "1-10 against your full profile, not keywords on a PDF. Strengths, gaps, and tips per job.",
  },
  {
    title: "Rate the rating",
    body: "Wrong score? Star and a note on the job. Similar listings pick that up next time.",
  },
  {
    title: "Track on Kanban",
    body: "Drag Saved, Applied, Interview, Offer. One board instead of a lost inbox.",
  },
  {
    title: "Download the application",
    body: "For jobs that fit, get a CV and cover letter PDF from your real CV. Rebuild the letter without touching the CV.",
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
    summary:
      "Solid overlap on Next.js and API design. Lead with the production work you marked as flagship.",
    status: "SAVED",
    borderColor: "var(--accent)",
  },
  {
    source: "Manual",
    title: "Software Engineer",
    company: "Stripe",
    location: "Remote",
    score: 7,
    summary:
      "Pasted this one in directly. Good backend fit. Light on distributed systems, so mention any exposure in your cover letter.",
    status: "NEW",
    borderColor: "var(--warning)",
  },
];

const EXPLAINER: { icon: React.ElementType; title: string; desc: string }[] = [
  {
    icon: Search,
    title: "It searches for you",
    desc: "One click crawls Jooble and Indeed for the roles and cities you set, instead of you checking five tabs a day.",
  },
  {
    icon: Sparkles,
    title: "It scores each job against YOUR CV",
    desc: "Not a keyword match. The AI reads your actual CV, experience, and preferences, and rates every listing 1 to 10 for fit, with the specific reasons why.",
  },
  {
    icon: Kanban,
    title: "It tracks where you actually stand",
    desc: "Saved, Applied, Interviewing, Offer, one board instead of a spreadsheet you stopped updating.",
  },
];

const HERO_STATS: { label: string; value: string; tone?: "accent" | "success" }[] = [
  { label: "Boards searched", value: "2", tone: "accent" },
  { label: "Profile inputs", value: "10+" },
  { label: "AI fit score", value: "1-10", tone: "success" },
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
  onClick,
}: {
  source: string;
  title: string;
  company: string;
  location: string;
  score: number;
  summary: string;
  status: string;
  borderColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="card card-hover job-card"
      onClick={onClick}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        minHeight: 0,
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <div className="job-card-header-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="job-card-meta-row">
            <span
              style={{
                fontSize: "var(--text-xs)",
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
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
              }}
            >
              <Clock size={10} /> Posted 3h ago
            </span>
          </div>
          <h3
            style={{
              fontSize: "var(--text-base)",
              fontWeight: 600,
              color: "var(--text)",
              lineHeight: 1.4,
              margin: "0 0 var(--space-1)",
            }}
          >
            {title}
          </h3>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              <Building2 size={11} /> {company}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-1)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
              }}
            >
              <MapPin size={11} /> {location}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--space-2)",
          }}
        >
          <ScoreBadge score={score} size="sm" />
          <ExternalLink size={11} style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
      <p
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-secondary)",
          margin: "0 0 var(--space-3)",
          lineHeight: 1.5,
        }}
      >
        {summary}
      </p>
      <div className="job-card-footer" style={{ paddingTop: "var(--space-3)" }}>
        <span
          className="job-card-status-select"
          style={{ color: "var(--accent)", fontSize: "var(--text-xs)" }}
        >
          {status}
        </span>
      </div>
    </div>
  );
}

const DEMO_STRENGTHS = [
  "5+ years of production React and TypeScript, matches the core stack directly.",
  "Shipped and maintained CI/CD pipelines end to end, exactly what this listing asks for.",
];
const DEMO_GAPS = ["No hands-on GraphQL experience yet, this role lists it as required."];
const DEMO_VERDICT =
  "Strong overall fit. Your frontend and DevOps background covers most of this listing, the GraphQL gap is worth addressing in your cover letter.";

function DemoJobDetailModal({
  job,
  onClose,
}: {
  job: (typeof PREVIEW_JOBS)[number];
  onClose: () => void;
}) {
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
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card job-detail-modal"
        style={{ width: "100%", maxWidth: 680, maxHeight: "88dvh", overflow: "auto" }}
      >
        <div className="job-modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: "var(--accent)",
              }}
            >
              Demo preview, not a real job
            </span>
            <h2 className="job-modal-title">{job.title}</h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <Building2 size={13} /> {job.company}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                <MapPin size={13} /> {job.location}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <ScoreBadge score={job.score} size="lg" />
            <button
              onClick={onClose}
              className="btn btn-ghost"
              style={{ padding: "var(--space-2)" }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div style={{ padding: "0 var(--space-6) var(--space-6)" }}>
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
            {DEMO_VERDICT}
          </p>

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
            {DEMO_STRENGTHS.map((s) => (
              <div
                key={s}
                style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-2)" }}
              >
                <span style={{ color: "var(--success)", fontWeight: 700, flexShrink: 0 }}>+</span>
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

          <div style={{ marginBottom: "var(--space-6)" }}>
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
            {DEMO_GAPS.map((g) => (
              <div
                key={g}
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

          <p
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
              background: "var(--accent-light)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "var(--space-3) var(--space-4)",
              margin: "0 0 var(--space-5)",
            }}
          >
            <Sparkles size={14} style={{ flexShrink: 0, color: "var(--accent)" }} />
            Download apply pack builds a ready CV + cover letter PDF from this fit analysis. Copy
            apply pack instead if you'd rather hand the raw info to your own ChatGPT/Claude and
            build it yourself.
          </p>

          <div className="job-modal-footer">
            <Link
              to="/login"
              className="btn btn-primary job-modal-apply-pack"
              title="Generates a tailored CV + cover letter PDF from your real CV and this job"
            >
              <Download size={15} />
              Download apply pack
            </Link>

            <div className="job-modal-footer-actions">
              <Link
                to="/login"
                className="btn btn-ghost job-modal-action-btn"
                title="Opens the original job listing in a new tab"
              >
                <ExternalLink size={14} /> View posting
              </Link>
              <Link
                to="/login"
                className="btn btn-ghost job-modal-action-btn"
                title="Re-checks this job against your current CV and preferences"
              >
                <RefreshCw size={14} /> Re-rate
              </Link>
              <Link
                to="/login"
                className="btn btn-ghost job-modal-action-btn"
                title="Copies job + CV context, paste into ChatGPT/Claude/Grok to build your own CV"
              >
                <ClipboardCopy size={14} /> Copy apply pack
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_TILT_RESTING = { x: 6, y: -4 };

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoJob, setDemoJob] = useState<(typeof PREVIEW_JOBS)[number] | null>(null);
  const [previewTilt, setPreviewTilt] = useState(PREVIEW_TILT_RESTING);
  const year = new Date().getFullYear();
  const navRef = useRef<HTMLDivElement>(null);

  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handlePreviewMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (reducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setPreviewTilt({ x: py * -14, y: px * 14 });
  };
  const handlePreviewLeave = () => setPreviewTilt(PREVIEW_TILT_RESTING);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [menuOpen]);

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <div className="landing-nav-inner" ref={navRef}>
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
            <a href="#privacy" onClick={() => setMenuOpen(false)}>
              Privacy & GDPR
            </a>
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
            <h1 className="landing-hero-title">
              {heroWords.map((word, i) => (
                <span
                  key={`${word}-${i}`}
                  className={HERO_HIGHLIGHT.has(word) ? "landing-hero-highlight" : undefined}
                  style={{ "--word-i": i } as React.CSSProperties}
                >
                  {word}
                </span>
              ))}
            </h1>

            <p className="landing-hero-sub">
              Upload your CV, tell us which markets and roles you want, and JobRadar searches the
              boards, scores every listing against your profile, and keeps the pipeline on a Kanban.
              For jobs that fit, download a tailored CV and cover letter PDF.
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
                <StatTile key={stat.label} label={stat.label} value={stat.value} tone={stat.tone} />
              ))}
            </div>
          </div>

          <div className="landing-hero-radar-wrap">
            <RadarSweep />
          </div>
        </section>

        <section className="landing-section landing-explainer-section">
          <div className="landing-section-head">
            <p className="landing-section-label">In plain terms</p>
            <h2>What JobRadar actually does</h2>
            <p>Not a new job board. A layer on top of the ones you already check.</p>
          </div>

          <Reveal className="landing-explainer-grid landing-stagger">
            {EXPLAINER.map((item) => (
              <div key={item.title} className="card landing-explainer-card">
                <span className="landing-explainer-icon">
                  <item.icon size={20} strokeWidth={2} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            ))}
          </Reveal>
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

          <Reveal
            className="landing-preview-wrap"
            onMouseMove={handlePreviewMove}
            onMouseLeave={handlePreviewLeave}
          >
            <div
              className="landing-preview-browser card"
              style={{
                transform: `rotateX(${previewTilt.x}deg) rotateY(${previewTilt.y}deg)`,
              }}
            >
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
                  <StatTile label="Active pipeline" value={47} hint="12 total saved" />
                  <StatTile
                    label="Strong matches"
                    value={12}
                    tone="success"
                    hint="Score 7+ · tap to filter"
                  />
                  <StatTile
                    label="Apply soon"
                    value={4}
                    tone="warning"
                    highlight
                    hint="8+ still New · tap to view"
                  />
                  <StatTile
                    label="Needs rating"
                    value={5}
                    tone="accent"
                    hint="Waiting for AI · tap to filter"
                  />
                </div>

                <div className="landing-preview-toolbar">
                  <Link to="/login" className="btn btn-ghost" style={{ fontSize: 12 }}>
                    <Plus size={14} /> Paste JD
                  </Link>
                  <Link to="/login" className="btn btn-primary" style={{ fontSize: 12 }}>
                    <Search size={14} /> Search jobs
                  </Link>
                  <Link to="/login" className="btn btn-secondary" style={{ fontSize: 12 }}>
                    <Sparkles size={14} /> Rate now
                  </Link>
                  <span className="landing-preview-filter">6+</span>
                  <span className="landing-preview-filter is-active">7+</span>
                  <span className="landing-preview-filter">8+</span>
                </div>

                <div className="landing-preview-grid">
                  {PREVIEW_JOBS.map((job) => (
                    <PreviewJobCard key={job.title} {...job} onClick={() => setDemoJob(job)} />
                  ))}
                </div>
              </div>
            </div>
            <p className="landing-preview-caption">
              Mockup only. Sign in, set up your profile in Settings, then run real searches for live
              ratings tuned to your roles and markets.
            </p>
          </Reveal>
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

          <Reveal className="landing-feature-grid landing-stagger">
            {FEATURES.map((f) => (
              <article key={f.title} className="card card-hover landing-feature-card">
                <span className="landing-feature-icon">
                  <f.Icon size={20} strokeWidth={2} />
                </span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </article>
            ))}
          </Reveal>
        </section>

        <section id="how-it-works" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-section-label">Workflow</p>
            <h2>How it works</h2>
          </div>

          <Reveal className="landing-steps landing-stagger">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={step.title} className="landing-step">
                <div className="landing-step-num">{i + 1}</div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
            ))}
          </Reveal>
        </section>

        <section className="landing-section landing-compare-section">
          <Reveal className="landing-compare landing-stagger">
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
          </Reveal>
        </section>

        <section id="stack" className="landing-section">
          <div className="landing-stack">
            <div className="landing-stack-copy">
              <p className="landing-section-label">Tech stack</p>
              <h2>How it's built</h2>
              <p>
                React frontend on TanStack Query, FastAPI backend, MongoDB in the EU. LangChain
                splits three jobs: bulk rating, apply-pack CVs, and CV parsing. You pick each from
                the list in Settings (local or hosted). FAISS retrieval picks the relevant JD
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

            <Reveal className="card landing-flow-card">
              <div className="landing-flow-head">
                <Shield size={18} />
                <h3>How a search works</h3>
              </div>
              <FlowDiagram steps={SEARCH_FLOW} />
            </Reveal>
          </div>
        </section>

        <section id="privacy" className="landing-section">
          <div className="landing-section-head">
            <p className="landing-section-label">Privacy & GDPR</p>
            <h2>Where your data actually goes</h2>
            <p>
              Not a policy PDF nobody reads, the actual path your CV takes, and the rights you have
              over it at every step.
            </p>
          </div>

          <Reveal className="card landing-flow-card" delay={80}>
            <FlowDiagram steps={DATA_FLOW} />
          </Reveal>

          <Reveal className="gdpr-rights-grid" delay={160}>
            {GDPR_RIGHTS.map((right) => (
              <div key={right.title} className="card gdpr-right-card">
                <span className="gdpr-right-icon">
                  <right.icon size={17} strokeWidth={2} />
                </span>
                <div>
                  <h4>{right.title}</h4>
                  <p>{right.desc}</p>
                </div>
              </div>
            ))}
          </Reveal>

          <p className="landing-preview-caption" style={{ marginTop: 20 }}>
            <Link to="/privacy" style={{ color: "var(--accent)" }}>
              Read the full Privacy Policy
            </Link>{" "}
            for retention periods, every third party we share data with, and how to exercise these
            rights.
          </p>
        </section>

        <section className="landing-section landing-cta-section">
          <div className="card landing-cta-card">
            <h2>Ready to stop scrolling?</h2>
            <p>
              Sign up, upload a CV, set markets and roles, and run a search. Score listings, then
              download a tailored CV and letter for the ones that fit.
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
              <a href="#privacy">Privacy & GDPR</a>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <Link to="/cookies">Cookie Policy</Link>
              <Link to="/login">Log in</Link>
            </nav>

            <p className="landing-footer-copy">© {year} JobRadar</p>
          </div>
        </div>
      </footer>

      {demoJob && <DemoJobDetailModal job={demoJob} onClose={() => setDemoJob(null)} />}
    </div>
  );
}
