import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "../api/index";
import { AuthPageShell } from "../components/AuthPageShell";
import { useAuthStore } from "../hooks/useStores";
import { clearUserScopedCache } from "../queryClient";

export function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);

  const validate = () => {
    const e: Record<string, string> = {};
    if (mode === "register" && !form.name.trim()) e.name = "Name is required";
    if (!form.email.trim()) e.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Enter a valid email";
    if (!form.password) e.password = "Password is required";
    else if (form.password.length < 8) e.password = "At least 8 characters";
    if (mode === "register" && !agreedToTerms) {
      e.terms = "You must agree to the Privacy Policy and Terms of Service";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      let data;
      if (mode === "login") {
        data = await authApi.login(form.email, form.password);
      } else {
        data = await authApi.register(form.name, form.email, form.password);
      }
      clearUserScopedCache();
      setToken(data.access_token);
      try {
        const me = await authApi.me();
        useAuthStore.getState().setUser(me);
      } catch {}
      navigate("/");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPageShell>
      <div className="card" style={{ padding: 28 }}>
        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--bg-secondary)",
            borderRadius: 8,
            padding: 3,
            marginBottom: 24,
          }}
        >
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setErrors({});
              }}
              style={{
                flex: 1,
                padding: "7px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background: mode === m ? "var(--bg-card)" : "transparent",
                color: mode === m ? "var(--text)" : "var(--text-muted)",
                boxShadow: mode === m ? "var(--shadow)" : "none",
                textTransform: "capitalize",
                transition: "all 0.15s",
              }}
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {mode === "register" && (
            <div>
              <label className="label">Full name</label>
              <input
                className="input"
                placeholder="Saim Kaskar"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={errors.name ? { borderColor: "var(--danger)" } : {}}
              />
              {errors.name && (
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--danger)",
                    marginTop: 4,
                  }}
                >
                  {errors.name}
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="saim@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={errors.email ? { borderColor: "var(--danger)" } : {}}
            />
            {errors.email && (
              <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{errors.email}</p>
            )}
          </div>

          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              placeholder={mode === "register" ? "Min. 8 characters" : "Your password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={errors.password ? { borderColor: "var(--danger)" } : {}}
            />
            {errors.password && (
              <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
                {errors.password}
              </p>
            )}
            {mode === "login" && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: 12,
                  textAlign: "right",
                }}
              >
                <Link to="/forgot-password" style={{ color: "var(--accent)" }}>
                  Forgot password?
                </Link>
              </p>
            )}
          </div>

          {mode === "register" && (
            <div>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  I agree to the{" "}
                  <Link to="/privacy" target="_blank" style={{ color: "var(--accent)" }}>
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link to="/terms" target="_blank" style={{ color: "var(--accent)" }}>
                    Terms of Service
                  </Link>
                </span>
              </label>
              {errors.terms && (
                <p style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>{errors.terms}</p>
              )}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              padding: "10px",
              marginTop: 4,
              fontSize: 14,
            }}
          >
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>

      <p
        style={{
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-muted)",
          marginTop: 20,
        }}
      >
        Your data stays on your server. No ads, no tracking.
      </p>
    </AuthPageShell>
  );
}
