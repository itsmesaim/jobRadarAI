import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

type AuthPageShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  showBrand?: boolean;
};

export function AuthPageShell({ children, title, subtitle, showBrand = true }: AuthPageShellProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "var(--bg)",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 16, right: 16 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: "100%", maxWidth: 380 }}>
        {showBrand && (
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <Link
              to="/"
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 10,
                textDecoration: "none",
              }}
            >
              <Logo size={40} wordmarkSize={24} centered />
            </Link>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              AI-powered job matching for developers
            </p>
          </div>
        )}

        {(title || subtitle) && (
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            {title && (
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  margin: "0 0 6px",
                  color: "var(--text)",
                }}
              >
                {title}
              </h1>
            )}
            {subtitle && (
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        )}

        {children}
      </div>
    </div>
  );
}
