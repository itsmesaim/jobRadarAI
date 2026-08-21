import { Link } from "react-router-dom";
import { LegalSection, LegalShell } from "../components/LegalShell";

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <LegalSection title="Who we are">
        <p>
          JobRadar ("we", "us") is a job-search tool. It crawls job boards, rates listings against
          your CV using AI, can generate a tailored CV and cover letter PDF, and helps you track
          applications. This policy explains what personal data we collect, why, and the rights you
          have over it.
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: "var(--text)" }}>Account data:</strong> name, email, and a bcrypt
          hash of your password. We never store the password itself.
        </p>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: "var(--text)" }}>CV data:</strong> when you upload a CV (PDF,
          Word, ODT, text, or TeX), we extract text and use AI to produce a structured breakdown
          (skills, experience, projects, education, links). We store the extracted text and
          structured data, not the original file.
        </p>
        <p style={{ marginBottom: 10 }}>
          <strong style={{ color: "var(--text)" }}>Preferences:</strong> target roles, locations,
          salary, key skills, visa/work authorization, work mode, timezone, flagship projects/jobs
          you mark, about-me notes, and which AI models you picked for rating, apply packs, and CV
          parsing.
        </p>
        <p>
          <strong style={{ color: "var(--text)" }}>Activity data:</strong> job listings crawled for
          you, AI fit scores, strengths, gaps, tailoring tips, rating feedback you leave, Kanban
          status, and cached apply-pack content (tailored CV and cover letter text) until you
          re-rate that job or replace your CV.
        </p>
      </LegalSection>

      <LegalSection title="How we use your data">
        <p>
          We use your CV and preferences to search job boards, score listings, and generate
          tailoring tips and apply-pack documents for you. Account data is used to sign you in and
          run the service. We do not sell your data, and we do not use it for advertising.
        </p>
      </LegalSection>

      <LegalSection title="Protecting your contact details from AI providers">
        <p>
          When your CV is parsed, we redact phone number and email before sending the text to an AI
          provider. Real contact details are restored locally into your stored CV so generated
          documents can still show them.
        </p>
      </LegalSection>

      <LegalSection title="Third parties we share data with">
        <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>Jooble and JobsAPI (Indeed):</strong> receive
            search terms from your job preferences. They do not receive your CV or identity.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>AI providers:</strong> the model you pick in
            Settings for CV parsing, job rating, or apply packs receives the CV/job text needed for
            that step (contact details redacted for parsing). OpenAI also receives CV and job text
            to create similarity embeddings for a fast pre-filter, even if you picked another
            provider for rating.
          </li>
          <li>
            <strong style={{ color: "var(--text)" }}>MongoDB:</strong> stores account, CV,
            preference, and job data described above.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Where your data is stored and processed">
        <p>
          Our app servers and database run in the EU (Lauterbourg, France). If you pick an AI
          provider outside the EU, that party processes the data they receive. Switching an AI
          provider in Settings requires your confirmation.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We keep your data for as long as your account exists. Deleting your account removes your
          user record and every job listing tied to it from our database immediately. That cannot be
          undone.
        </p>
        <p>
          Server operational logs (for example an email address on a failed request) rotate out
          within 30 days. Those logs are not the database and are not wiped by account deletion, but
          they expire on their own.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can export everything we hold, delete only your CV, or delete the whole account from{" "}
          <strong style={{ color: "var(--text)" }}>Settings → Data &amp; privacy</strong>. In the
          EU/EEA or UK these are your GDPR rights of access, portability, and erasure.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Passwords are hashed with bcrypt. Sessions use a signed access token. Admin tools are
          limited to one configured operator account.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and tracking">
        <p style={{ marginBottom: 10 }}>
          JobRadar does not set advertising or analytics cookies. The public landing page loads no
          third-party scripts. Fonts and JavaScript are self-hosted.
        </p>
        <p>
          After you sign in, your session token and theme sit in your browser's local storage, not
          in cookies, and are only sent to our API. See the{" "}
          <Link to="/cookies" style={{ color: "var(--accent)" }}>
            Cookie Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If this policy changes in a material way, we update the date at the top. Continued use
          after a change means you accept the revised policy.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy or your data? Email{" "}
          <a href="mailto:saimkaskar1@gmail.com" style={{ color: "var(--accent)" }}>
            saimkaskar1@gmail.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
