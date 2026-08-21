import { Link } from "react-router-dom";
import { LegalSection, LegalShell } from "../components/LegalShell";

export function TermsPage() {
  return (
    <LegalShell title="Terms of Service">
      <LegalSection title="1. Acceptance of these terms">
        <p>
          By creating an account or using JobRadar, you agree to these Terms and our{" "}
          <Link to="/privacy" style={{ color: "var(--accent)" }}>
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link to="/cookies" style={{ color: "var(--accent)" }}>
            Cookie Policy
          </Link>
          . If you don't agree, don't use the service.
        </p>
      </LegalSection>

      <LegalSection title="2. What JobRadar does">
        <p>
          JobRadar crawls third-party job boards, rates listings against your CV using AI, can
          generate a tailored CV and cover letter PDF from your CV, and helps you track applications
          on a Kanban board. It does not apply to jobs for you. It does not guarantee interviews or
          offers.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account">
        <p>
          You must provide accurate information and keep your login credentials confidential. You
          are responsible for activity under your account. You must be old enough to enter this
          agreement in your jurisdiction.
        </p>
      </LegalSection>

      <LegalSection title="4. Listings, scores, and generated documents are not guarantees">
        <p>
          Job listings come from third-party APIs (Jooble, Indeed/JobsAPI) and may be incomplete,
          outdated, or wrong. We do not verify them. Fit scores, gaps, tips, and apply-pack CVs and
          letters are automated suggestions, not professional, immigration, or legal advice. Always
          read the original listing. Generated documents must only contain experience you actually
          have.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
          <li>Scrape, resell, or redistribute job data from JobRadar at scale.</li>
          <li>Bypass rate limits, quotas, or authentication.</li>
          <li>Upload a CV or content that is not yours or that infringes someone else's rights.</li>
          <li>Use the service for any unlawful purpose.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Your content">
        <p>
          You keep ownership of your CV and anything you upload. By uploading it, you allow us to
          process it (including sending redacted portions to an AI provider, as described in the
          Privacy Policy) solely to provide the service to you.
        </p>
      </LegalSection>

      <LegalSection title="7. Termination">
        <p>
          You may delete your account at any time from Settings. That permanently removes your
          account, CV, and job data from our database. Operational server logs are separate; see the
          Privacy Policy. We may suspend or terminate accounts that violate these terms or abuse the
          service.
        </p>
      </LegalSection>

      <LegalSection title="8. Disclaimer of warranties">
        <p>
          JobRadar is provided "as is" and "as available," without warranties of any kind. We do not
          warrant that the service will be uninterrupted or error-free, or that matches, ratings, or
          generated documents will be accurate.
        </p>
      </LegalSection>

      <LegalSection title="9. Limitation of liability">
        <p>
          To the fullest extent permitted by law, JobRadar and its operator are not liable for
          indirect, incidental, or consequential damages from your use of the service, including
          missed opportunities or reliance on AI-generated content.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to these terms">
        <p>
          We may update these terms as the product changes. Material changes update the date at the
          top of this page. Continued use after a change means you accept the revised terms.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p>
          Questions? Email{" "}
          <a href="mailto:saimkaskar1@gmail.com" style={{ color: "var(--accent)" }}>
            saimkaskar1@gmail.com
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
