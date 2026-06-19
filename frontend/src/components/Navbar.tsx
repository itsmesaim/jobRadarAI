import { Link, useLocation } from "react-router-dom";
import { Sun, Moon, LogOut, LayoutGrid, Kanban, Settings } from "lucide-react";
import { useAuthStore, useThemeStore } from "../hooks/useStores";

export function Navbar() {
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const { dark, toggle } = useThemeStore();

  const links = [
    { to: "/", label: "Jobs", icon: LayoutGrid },
    { to: "/kanban", label: "Pipeline", icon: Kanban },
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav className="nav">
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          height: 52,
        }}
      >
        {/* Logo */}
        <Link to="/" style={{ textDecoration: "none", marginRight: 32 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            Job<span style={{ color: "var(--accent)" }}>Radar</span>
          </span>
        </Link>

        {/* Nav links */}
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {links.map(({ to, label, icon: Icon }) => {
            const active = location.pathname === to;
            return (
              <Link key={to} to={to} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px",
                    borderRadius: 7,
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? "var(--accent)" : "var(--text-secondary)",
                    background: active ? "var(--accent-light)" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <Icon size={14} />
                  <span className="hidden sm:inline">{label}</span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={toggle}
            className="btn btn-ghost"
            style={{ padding: "6px 8px" }}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => {
              logout();
              window.location.href = "/login";
            }}
            className="btn btn-ghost"
            style={{ padding: "6px 8px" }}
            title="Sign out"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
}
