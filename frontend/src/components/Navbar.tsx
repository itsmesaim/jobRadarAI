import { Link, useLocation } from "react-router-dom";
import { LogOut, LayoutGrid, Kanban, Settings, Shield, HelpCircle } from "lucide-react";
import { useAuthStore } from "../hooks/useStores";
import { clearUserScopedCache } from "../queryClient";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

interface Props {
  onHelpClick?: () => void;
}

export function Navbar({ onHelpClick }: Props = {}) {
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);

  const { user } = useAuthStore();
  const links = [
    { to: "/", label: "Jobs", icon: LayoutGrid },
    { to: "/kanban", label: "Pipeline", icon: Kanban },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  const isAdmin = !!user?.isAdmin;
  const adminBase = user?.adminBasePath;

  return (
    <nav className="nav">
      <div
        className="nav-inner"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          height: 60,
          minWidth: 0,
        }}
      >
        <Link
          to="/"
          className="nav-brand"
          style={{ textDecoration: "none", marginRight: 36, flexShrink: 0 }}
        >
          <Logo size={28} wordmarkSize={17} />
        </Link>

        <div
          style={{
            display: "flex",
            gap: 4,
            flex: 1,
            minWidth: 0,
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          {links.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 14px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 500,
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    background: active ? "var(--accent-light)" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <Icon size={15} />
                  <span className="nav-label">{label}</span>
                </div>
              </Link>
            );
          })}
          {isAdmin && (
            <Link to="/admin" style={{ textDecoration: "none" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 14px",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 500,
                  color: location.pathname === "/admin" ? "var(--accent)" : "var(--text-secondary)",
                  background:
                    location.pathname === "/admin" ? "var(--accent-light)" : "transparent",
                }}
              >
                <Shield size={15} />
                <span className="nav-label">Admin</span>
              </div>
            </Link>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onHelpClick && (
            <button
              onClick={onHelpClick}
              className="btn btn-ghost"
              style={{ padding: "8px 10px" }}
              title="How JobRadar works"
              aria-label="Help"
            >
              <HelpCircle size={16} />
            </button>
          )}
          <ThemeToggle />
          <button
            onClick={() => {
              clearUserScopedCache();
              logout();
              window.location.href = "/login";
            }}
            className="btn btn-ghost"
            style={{ padding: "8px 10px" }}
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}
