import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { authApi } from "../api/index";
import { AuthPageShell } from "../components/AuthPageShell";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!token) {
      toast.error("Missing reset token, request a new link");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPassword(token, password);
      toast.success(res.message);
      navigate("/login");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Invalid or expired reset link");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthPageShell showBrand={false}>
        <div className="card" style={{ padding: 28 }}>
          <p style={{ margin: "0 0 16px", color: "var(--text-secondary)" }}>
            This reset link is invalid. Request a new one.
          </p>
          <Link to="/forgot-password" className="btn btn-primary">
            Request reset link
          </Link>
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Choose new password" showBrand={false}>
      <div className="card" style={{ padding: 28 }}>
        <label className="label">New password</label>
        <input
          className="input"
          type="password"
          placeholder="Min. 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <label className="label" style={{ marginTop: 12 }}>
          Confirm password
        </label>
        <input
          className="input"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
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
          {loading ? "Updating..." : "Update password"}
        </button>
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 13 }}>
          <Link to="/login" style={{ color: "var(--accent)" }}>
            Back to sign in
          </Link>
        </p>
      </div>
    </AuthPageShell>
  );
}
