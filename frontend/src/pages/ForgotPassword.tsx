import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "../api/index";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !/\S+@\S+\.\S+/.test(email)) {
      toast.error("Enter a valid email");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.forgotPassword(email.trim());
      setSent(true);
      toast.success(res.message);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Could not send reset email");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              margin: "0 0 6px",
              color: "var(--text)",
            }}
          >
            Reset password
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
            We&apos;ll email you a reset link
          </p>
        </div>

        <div className="card" style={{ padding: 28 }}>
          {sent ? (
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                margin: "0 0 16px",
              }}
            >
              If an account exists for that email, instructions were sent. In
              local dev without SMTP, check the{" "}
              <strong>backend terminal</strong> for the reset link.
            </p>
          ) : (
            <>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="btn btn-primary"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  marginTop: 16,
                  padding: "10px",
                }}
              >
                {loading ? "Sending..." : "Send reset link"}
              </button>
            </>
          )}

          <p style={{ textAlign: "center", marginTop: 20, fontSize: 13 }}>
            <Link to="/login" style={{ color: "var(--accent)" }}>
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
