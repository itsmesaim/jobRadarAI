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
          padding: "0 20px",
          display: "flex",
          alignItems: "center",
          height: 60,
        }}
      >
        <Link to="/" style={{ textDecoration: "none", marginRight: 36 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
            Job<span style={{ color: "var(--accent)" }}>Radar</span>
          </span>
        </Link>

        <div style={{ display: "flex", gap: 4, flex: 1 }}>
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
                  <span className="hidden sm:inline">{label}</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={toggle}
            className="btn btn-ghost"
            style={{ padding: "8px 10px" }}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            onClick={() => {
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
