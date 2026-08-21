import { Link } from "react-router-dom";
import { Logo } from "./Logo";

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "var(--text)" }}>
        {title}
      </h2>
      <div style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.75 }}>
        {children}
      </div>
    </section>
  );
}

export function LegalShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 24px",
          maxWidth: 780,
          margin: "0 auto",
        }}
      >
        <Link to="/" style={{ display: "flex" }}>
          <Logo size={28} wordmarkSize={17} />
        </Link>
        <Link to="/login" className="btn btn-secondary">
          Log in
        </Link>
      </header>
      <main style={{ maxWidth: 780, margin: "0 auto", padding: "16px 24px 96px" }}>
        <h1
          style={{
            fontSize: "clamp(32px, 5vw, 44px)",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            margin: "0 0 10px",
            color: "var(--text)",
          }}
        >
          {title}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 40 }}>
          Last updated: 2026-08-21
        </p>
        {children}
        <nav
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            marginTop: 48,
            fontSize: 14,
          }}
        >
          <Link to="/privacy" style={{ color: "var(--accent)" }}>
            Privacy Policy
          </Link>
          <Link to="/terms" style={{ color: "var(--accent)" }}>
            Terms of Service
          </Link>
          <Link to="/cookies" style={{ color: "var(--accent)" }}>
            Cookie Policy
          </Link>
        </nav>
      </main>
    </div>
  );
}
