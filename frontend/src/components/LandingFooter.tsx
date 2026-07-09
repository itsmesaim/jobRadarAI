import { Link } from "react-router-dom";
import { Logo } from "./Logo";

export function LandingFooter() {
  const year = new Date().getFullYear();

  return (
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
  );
}
