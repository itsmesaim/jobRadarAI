import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

export function TermsPage() {
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
          Terms of Service
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 40 }}>
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>

        <Section title="1. Acceptance of these terms">
          <p>
            By creating an account or using JobRadar, you agree to these Terms of Service and our{" "}
            <Link to="/privacy" style={{ color: "var(--accent)" }}>
              Privacy Policy
            </Link>
            . If you don't agree, don't use the service.
          </p>
        </Section>

        <Section title="2. What JobRadar does">
          <p>
            JobRadar crawls third-party job boards on your behalf, rates listings against your CV
            using an AI model, and helps you track applications on a Kanban board. It's a tool to
            help your job search. It doesn't apply to jobs for you, and it doesn't guarantee
            interviews or offers.
          </p>
        </Section>

        <Section title="3. Your account">
          <p>
            You must provide accurate information when registering and keep your login credentials
            confidential. You're responsible for all activity under your account. You must be old
            enough to legally enter into this agreement in your jurisdiction to use JobRadar.
          </p>
        </Section>

        <Section title="4. Job listings and AI ratings are not guarantees">
          <p>
            Job listings are sourced from third-party APIs (Jooble, Indeed/JobsAPI) and may be
            incomplete, outdated, expired, or inaccurate. We don't control or verify them. AI-
            generated fit scores, strengths, gaps, and tailoring tips are automated suggestions, not
            professional or legal advice. Always read the original listing and verify requirements
            yourself before applying.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
            <li>Scrape, resell, or redistribute job data obtained through JobRadar at scale.</li>
            <li>Attempt to bypass rate limits, usage quotas, or authentication.</li>
            <li>
              Upload a CV or content that isn't yours or that infringes someone else's rights.
            </li>
            <li>Use the service for any unlawful purpose.</li>
          </ul>
        </Section>

        <Section title="6. Your content">
          <p>
            You retain ownership of your CV and any content you upload. By uploading it, you allow
            us to process it (including sending redacted portions to an AI provider, as described in
            the Privacy Policy) solely to provide the service to you.
          </p>
        </Section>

        <Section title="7. Termination">
          <p>
            You may delete your account at any time from Settings, which permanently and immediately
            removes your account, CV, and job data from our database. Operational server logs are
            handled separately — see the Privacy Policy for retention details. We may suspend or
            terminate accounts that violate these terms or abuse the service.
          </p>
        </Section>

        <Section title="8. Disclaimer of warranties">
          <p>
            JobRadar is provided "as is" and "as available," without warranties of any kind, express
            or implied. We don't warrant that the service will be uninterrupted, error-free, or that
            job matches/ratings will be accurate.
          </p>
        </Section>

        <Section title="9. Limitation of liability">
          <p>
            To the fullest extent permitted by law, JobRadar and its operator are not liable for any
            indirect, incidental, or consequential damages arising from your use of the service,
            including missed job opportunities or reliance on AI-generated content.
          </p>
        </Section>

        <Section title="10. Changes to these terms">
          <p>
            We may update these terms as the product changes. If we make a material change, we'll
            update the date at the top of this page. Continued use of the service after a change
            means you accept the revised terms.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about these terms? Reach out to the site operator through the contact details
            published on the production site.
          </p>
        </Section>
      </main>
    </div>
  );
}
