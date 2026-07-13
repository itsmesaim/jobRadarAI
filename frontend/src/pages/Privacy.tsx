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

export function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 40 }}>
          Last updated: {new Date().toISOString().slice(0, 10)}
        </p>

        <Section title="Who we are">
          <p>
            JobRadar ("we", "us") is a job-search tool that crawls job boards, rates listings
            against your CV using AI, and helps you track applications. This policy explains what
            personal data we collect, why, and the rights you have over it.
          </p>
        </Section>

        <Section title="Information we collect">
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: "var(--text)" }}>Account data:</strong> your name, email
            address, and a securely hashed password. We never store your password in plain text and
            cannot recover it, only reset it.
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: "var(--text)" }}>CV data:</strong> when you upload a CV, we
            extract the text from your PDF and use AI to produce a structured breakdown (skills,
            experience, education, contact details). We store the extracted text and structured
            data, not the original PDF file.
          </p>
          <p style={{ marginBottom: 10 }}>
            <strong style={{ color: "var(--text)" }}>Preferences:</strong> your target roles,
            locations, salary range, key skills, work authorization, preferred work mode, and any
            free-text notes you add about yourself.
          </p>
          <p>
            <strong style={{ color: "var(--text)" }}>Activity data:</strong> job listings crawled on
            your behalf, the AI-generated fit scores/strengths/gaps tied to your account, and your
            Kanban pipeline status for each listing.
          </p>
        </Section>

        <Section title="How we use your data">
          <p>
            Your CV and preferences are used to search job boards on your behalf and to generate AI
            fit ratings, tailoring tips, and application briefs. We use your account data solely to
            authenticate you and operate the service, never for advertising, and never sold to
            anyone.
          </p>
        </Section>

        <Section title="Protecting your contact details from AI providers">
          <p>
            When your CV is parsed, we redact your phone number and email address before sending the
            text to our AI provider, so the provider never sees them. Your real contact details are
            extracted locally and restored directly into your stored CV data, so your structured CV
            and any documents generated from it still include them correctly.
          </p>
        </Section>

        <Section title="Third parties we share data with">
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Jooble and JobsAPI (Indeed):</strong> receive
              search terms derived from your job preferences to find listings. They never receive
              your CV or identity.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Mistral (EU-based):</strong> receives your CV
              text (with phone/email redacted, see above) and job descriptions to parse your CV into
              structured data, generate fit ratings, gaps, tailoring tips, briefs, and roasts.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>OpenAI:</strong> receives your CV text and
              job description text solely to generate similarity embeddings (a numeric vector) used
              for a fast pre-filter step before rating — this text is not used for parsing or
              rating.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>MongoDB:</strong> our database provider,
              which stores all account, CV, preference, and job data described above.
            </li>
          </ul>
        </Section>

        <Section title="Where your data is stored and processed">
          <p>
            Our servers and database run on infrastructure located in Lauterbourg, France (EU).
            Combined with Mistral (EU-based) handling CV parsing and job rating, the core processing
            of your CV and job data stays within the EU end to end.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            We keep your data for as long as your account exists. Deleting your account permanently
            and immediately removes your user record and every job listing tied to it from our
            database. This action cannot be undone.
          </p>
          <p>
            Separately, our server keeps short-lived operational logs (e.g. your email address, to
            trace a failed search or rating for debugging) for up to 30 days, after which they are
            automatically rotated out. These logs are not part of the database and are not covered
            by the account-deletion action above, but they age out on their own within that window.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            You can download a complete export of everything we hold about you, or permanently
            delete your account and all associated data, at any time from{" "}
            <strong style={{ color: "var(--text)" }}>Settings → Data &amp; privacy</strong>. If
            you're in the EU/EEA or UK, these are your rights to access, portability, and erasure
            under GDPR.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Passwords are hashed with bcrypt and never stored in plain text. Your session uses a
            signed access token. Admin functionality is restricted to a single, explicitly
            configured administrator account and cannot be reached by any other user.
          </p>
        </Section>

        <Section title="Cookies and tracking">
          <p style={{ marginBottom: 10 }}>
            JobRadar does not use cookies, analytics, or advertising trackers. The public landing
            page loads no third-party scripts or CDN assets. Fonts and JavaScript are self-hosted
            and bundled at build time (Vite), so visiting the homepage does not contact Google,
            Cloudflare, or any other external tracker.
          </p>
          <p>
            After you sign in, your session token and theme preference are stored in your browser's
            local storage, not cookies, and are only sent to our own API, never to third-party
            analytics or ad networks.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            If this policy changes in a material way, we'll update the date at the top of this page.
            Continued use of JobRadar after a change means you accept the revised policy.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or your data? Email{" "}
            <a href="mailto:saimkaskar1@gmail.com" style={{ color: "var(--accent)" }}>
              saimkaskar1@gmail.com
            </a>
            .
          </p>
        </Section>
      </main>
    </div>
  );
}
