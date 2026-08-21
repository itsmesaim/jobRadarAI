import { Link } from "react-router-dom";
import { LegalSection, LegalShell } from "../components/LegalShell";

export function CookiesPage() {
  return (
    <LegalShell title="Cookie Policy">
      <LegalSection title="What we use">
        <p>
          JobRadar does not use advertising cookies, analytics cookies, or tracking pixels. The
          public site does not load third-party scripts.
        </p>
      </LegalSection>

      <LegalSection title="Local storage, not cookies">
        <p>
          After you sign in, your session token and theme preference are stored in your browser's
          local storage. They are sent only to our API. Clearing site data in your browser signs you
          out.
        </p>
      </LegalSection>

      <LegalSection title="More detail">
        <p>
          See the{" "}
          <Link to="/privacy" style={{ color: "var(--accent)" }}>
            Privacy Policy
          </Link>{" "}
          for what we store and who we share it with, and the{" "}
          <Link to="/terms" style={{ color: "var(--accent)" }}>
            Terms of Service
          </Link>{" "}
          for use of the product.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
