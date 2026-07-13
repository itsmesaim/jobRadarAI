import { useEffect, useState } from "react";
import {
  Cpu,
  Zap,
  Trash2,
  ChevronDown,
  ChevronUp,
  Database,
  Clock,
  Star,
  TrendingDown,
  Layers,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { ProgressBar } from "../components/ProgressBar";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuthStore } from "../hooks/useStores";
import { adminApi } from "../api";
import { toast } from "react-hot-toast";

interface AiUsageSnapshot {
  total_tokens?: number;
  llm_calls?: number;
  embedding_calls?: number;
  estimated_cost_usd?: number;
}

interface AiUsage {
  cost_estimation_enabled?: boolean;
  lifetime?: AiUsageSnapshot;
  today?: AiUsageSnapshot;
  this_month?: AiUsageSnapshot & { month?: string };
}

interface PlatformAiSummary {
  providers?: {
    main_llm?: string;
    rating_llm?: string;
    rating_model?: string;
  };
  cost_estimation_enabled?: boolean;
  monthly_budget_usd?: number | null;
  monthly_spent_usd?: number;
  monthly_remaining_usd?: number | null;
  today?: AiUsageSnapshot;
  this_month?: AiUsageSnapshot & { month?: string };
  lifetime?: AiUsageSnapshot;
  note?: string;
}

const DEFAULT_DAILY_TOKEN_LIMIT = 250_000;

interface AdminUser {
  id: string;
  email: string;
  name: string;
  searches_used: number;
  ratings_used: number;
  search_limit: number;
  rating_limit: number;
  daily_tokens_used?: number;
  monthly_tokens_used?: number;
  daily_token_limit?: number;
  monthly_token_limit?: number;
  daily_tokens_remaining?: number | null;
  monthly_tokens_remaining?: number | null;
  unlimited?: boolean;
  full_access?: boolean;
  full_access_until?: string;
  admin_notes?: string;
  ai_usage?: AiUsage;
  last_login_at?: string;
  last_active_at?: string;
  last_search_at?: string;
  last_manual_rate_at?: string;
  suspended?: boolean;
  suspended_reason?: string;
  suspended_at?: string;
}

function formatTokens(n?: number) {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function formatUsd(n?: number, enabled = true) {
  if (!enabled) return "—";
  return `$${(n ?? 0).toFixed(4)}`;
}

function formatCostLine(tokens?: number, llmCalls?: number, cost?: number, costEnabled = true) {
  const parts = [`${formatTokens(tokens)} tokens`, `${llmCalls ?? 0} LLM calls`];
  if (costEnabled) parts.push(formatUsd(cost, true));
  return parts.join(" · ");
}

function formatRelativeTime(value?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

function isInactive24h(value?: string) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  return Date.now() - date.getTime() > 24 * 60 * 60 * 1000;
}

type AccessLevel = "free" | "limited" | "full" | "temp_12h" | "temp_1d";

interface EditForm {
  access_level: AccessLevel;
  // "" represents a field the user has cleared while typing a new value —
  // it must NOT be coerced to 0 immediately, or the input becomes
  // impossible to clear (every keystroke re-adds a leading "0").
  search_limit: number | "";
  rating_limit: number | "";
  daily_token_limit: number | "";
  monthly_token_limit: number | "";
  notes: string;
}

const ACCESS_LEVELS: { value: AccessLevel; label: string }[] = [
  { value: "free", label: "Free tier" },
  { value: "limited", label: "Custom limits" },
  { value: "full", label: "Full (permanent)" },
  { value: "temp_12h", label: "Full (12h)" },
  { value: "temp_1d", label: "Full (1 day)" },
];

function getPct(used: number, limit: number) {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
}

function isUnlimitedTokenCap(limit?: number) {
  return !limit || limit <= 0;
}

function formatTokenCap(limit?: number) {
  return isUnlimitedTokenCap(limit) ? "Unlimited" : formatTokens(limit);
}

function isUserFullAccess(u: AdminUser) {
  return !!u.full_access || !!(u.full_access_until && new Date(u.full_access_until) > new Date());
}

function UnlimitedBadge() {
  return (
    <span
      style={{
        fontSize: "var(--text-xs)",
        fontWeight: 700,
        color: "var(--success)",
        background: "var(--success-bg)",
        border: "1px solid var(--success-border)",
        borderRadius: "var(--radius-pill)",
        padding: "1px 6px",
        lineHeight: 1.6,
        fontFamily: "sans-serif",
      }}
    >
      ∞
    </span>
  );
}

function DataStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="admin-stat-box">
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          marginBottom: "var(--space-1)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--text-lg)", fontWeight: 600, color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

function UsageStat({
  label,
  used,
  limit,
  unlimited,
  color,
}: {
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
  color: string;
}) {
  const pct = getPct(used, limit);
  return (
    <div className="admin-stat-box">
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          marginBottom: "var(--space-1)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
        <span
          style={{
            fontFamily: "monospace",
            fontWeight: 600,
            fontSize: "var(--text-base)",
            color: "var(--text)",
          }}
        >
          {formatTokens(used)}
          {!unlimited && ` / ${formatTokens(limit)}`}
        </span>
        {unlimited && (
          <span
            style={{
              fontSize: "var(--text-xs)",
              fontWeight: 700,
              color: "var(--success)",
              background: "var(--success-bg)",
              border: "1px solid var(--success-border)",
              borderRadius: "var(--radius-pill)",
              padding: "1px 6px",
              lineHeight: 1.6,
            }}
          >
            ∞
          </span>
        )}
      </div>
      {!unlimited && <ProgressBar pct={pct} color={color} />}
    </div>
  );
}

function StatusBadge({ user }: { user: AdminUser }) {
  const isFull = isUserFullAccess(user);
  if (user.suspended) {
    return (
      <span
        className="badge"
        style={{
          background: "var(--danger-bg)",
          color: "var(--danger)",
          border: "1px solid var(--danger-border)",
        }}
      >
        Paused
      </span>
    );
  }
  if (isFull) {
    const untilText = user.full_access_until
      ? ` until ${new Date(user.full_access_until).toLocaleDateString()}`
      : "";
    return (
      <span
        className="badge"
        style={{
          background: "var(--success-bg)",
          color: "var(--success)",
          border: "1px solid var(--success-border)",
        }}
      >
        Full access{untilText}
      </span>
    );
  }
  return (
    <span
      className="badge"
      style={{
        background: "var(--warning-bg)",
        color: "var(--warning)",
        border: "1px solid var(--warning-border)",
      }}
    >
      Limited
    </span>
  );
}

function UserEditForm({
  form,
  setForm,
  onSave,
  onCancel,
}: {
  form: EditForm;
  setForm: (form: EditForm) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const handleAccessLevelChange = (level: AccessLevel) => {
    const next = { ...form, access_level: level };
    if (level === "full" || level === "temp_12h" || level === "temp_1d") {
      next.search_limit = 9999;
      next.rating_limit = 9999;
      next.daily_token_limit = 0;
      next.monthly_token_limit = 0;
    } else if (level === "free") {
      next.search_limit = 3;
      next.rating_limit = 10;
      next.daily_token_limit = DEFAULT_DAILY_TOKEN_LIMIT;
      next.monthly_token_limit = 0;
    }
    setForm(next);
  };

  const limitsDisabled =
    form.access_level === "full" ||
    form.access_level === "temp_12h" ||
    form.access_level === "temp_1d";

  return (
    <div
      style={{
        marginTop: "var(--space-4)",
        paddingTop: 14,
        borderTop: "1px solid var(--border)",
      }}
    >
      <p className="label" style={{ marginBottom: "var(--space-2)" }}>
        Access level
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          marginBottom: "var(--space-4)",
        }}
      >
        {ACCESS_LEVELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={`admin-access-btn${form.access_level === value ? " is-active" : ""}`}
            onClick={() => handleAccessLevelChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {(form.access_level === "full" ||
        form.access_level === "temp_12h" ||
        form.access_level === "temp_1d") && (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--success)",
            background: "var(--success-bg)",
            border: "1px solid var(--success-border)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 12px",
            marginBottom: "var(--space-4)",
          }}
        >
          {form.access_level === "full"
            ? "Full access grants unlimited searches, ratings, and AI tokens."
            : "Temporary full access for the selected period."}
        </div>
      )}

      <div style={{ marginBottom: "var(--space-4)" }}>
        <label className="label">Notes</label>
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="input"
          placeholder="Internal notes..."
        />
      </div>

      {(form.access_level === "limited" || form.access_level === "free") && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "var(--space-3)",
            marginBottom: "var(--space-4)",
          }}
        >
          {form.access_level === "limited" && (
            <>
              <div>
                <label className="label">Search limit</label>
                <input
                  type="number"
                  value={form.search_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      search_limit: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                    })
                  }
                  onBlur={() => form.search_limit === "" && setForm({ ...form, search_limit: 0 })}
                  className="input"
                  disabled={limitsDisabled}
                />
              </div>
              <div>
                <label className="label">Rating limit</label>
                <input
                  type="number"
                  value={form.rating_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rating_limit: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                    })
                  }
                  onBlur={() => form.rating_limit === "" && setForm({ ...form, rating_limit: 0 })}
                  className="input"
                  disabled={limitsDisabled}
                />
              </div>
            </>
          )}
          <div>
            <label className="label">Daily token cap</label>
            <input
              type="number"
              value={form.daily_token_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  daily_token_limit: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                })
              }
              onBlur={() =>
                form.daily_token_limit === "" && setForm({ ...form, daily_token_limit: 0 })
              }
              className="input"
              disabled={limitsDisabled}
              placeholder="0 = unlimited"
            />
          </div>
          <div>
            <label className="label">Monthly token cap</label>
            <input
              type="number"
              value={form.monthly_token_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  monthly_token_limit: e.target.value === "" ? "" : parseInt(e.target.value, 10),
                })
              }
              onBlur={() =>
                form.monthly_token_limit === "" && setForm({ ...form, monthly_token_limit: 0 })
              }
              className="input"
              disabled={limitsDisabled}
              placeholder="0 = unlimited"
            />
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button type="button" onClick={onSave} className="btn btn-primary">
          Save changes
        </button>
        <button type="button" onClick={onCancel} className="btn btn-ghost">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AdminUserCard({ user, onOpen }: { user: AdminUser; onOpen: () => void }) {
  const isFull = isUserFullAccess(user);
  const inactive = isInactive24h(user.last_active_at);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="admin-user-card"
      style={{
        width: "100%",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        display: "block",
        appearance: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: "var(--text-base)",
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {user.name || "Unnamed"}
          </div>
          <div
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              fontFamily: "monospace",
              marginTop: 2,
              wordBreak: "break-all",
            }}
          >
            {user.email}
          </div>
        </div>
        <StatusBadge user={user} />
      </div>

      <div className="admin-stat-row">
        <UsageStat
          label="Searches"
          used={user.searches_used}
          limit={user.search_limit}
          unlimited={isFull}
          color="var(--success)"
        />
        <UsageStat
          label="Ratings"
          used={user.ratings_used}
          limit={user.rating_limit}
          unlimited={isFull}
          color="var(--warning)"
        />
        <UsageStat
          label="AI tokens (today)"
          used={user.daily_tokens_used ?? user.ai_usage?.today?.total_tokens ?? 0}
          limit={user.daily_token_limit ?? DEFAULT_DAILY_TOKEN_LIMIT}
          unlimited={isFull || isUnlimitedTokenCap(user.daily_token_limit)}
          color="var(--accent)"
        />
      </div>

      <div
        style={{
          marginTop: "var(--space-3)",
          fontSize: "var(--text-xs)",
          color: inactive ? "var(--text-muted)" : "var(--text-secondary)",
        }}
      >
        Last active: {formatRelativeTime(user.last_active_at)}
        {inactive && " · idle"}
      </div>

      {user.admin_notes && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: "var(--text-xs)",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          {user.admin_notes}
        </p>
      )}
    </button>
  );
}

function buildFormFromUser(u: AdminUser): EditForm {
  let level: AccessLevel = "limited";
  if (u.full_access) level = "full";
  else if (u.full_access_until) level = "temp_12h";
  return {
    access_level: level,
    search_limit: u.search_limit,
    rating_limit: u.rating_limit,
    daily_token_limit: u.daily_token_limit ?? DEFAULT_DAILY_TOKEN_LIMIT,
    monthly_token_limit: u.monthly_token_limit ?? 0,
    notes: u.admin_notes || "",
  };
}

function buildAccessPayload(form: EditForm): Record<string, unknown> {
  const payload: Record<string, unknown> = { notes: form.notes };
  const level = form.access_level;
  if (level === "full") {
    payload.full_access = true;
  } else if (level === "temp_12h") {
    payload.full_access_duration_hours = 12;
  } else if (level === "temp_1d") {
    payload.full_access_duration_hours = 24;
  } else if (level === "free") {
    payload.full_access = false;
    payload.search_limit = 3;
    payload.rating_limit = 10;
    payload.daily_token_limit = form.daily_token_limit || 0;
    payload.monthly_token_limit = form.monthly_token_limit || 0;
  } else {
    payload.full_access = false;
    payload.search_limit = form.search_limit || 0;
    payload.rating_limit = form.rating_limit || 0;
    payload.daily_token_limit = form.daily_token_limit || 0;
    payload.monthly_token_limit = form.monthly_token_limit || 0;
  }
  return payload;
}

function ActivityStat({ label, value, stale }: { label: string; value: string; stale?: boolean }) {
  return (
    <div className="admin-stat-box">
      <div
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          marginBottom: "var(--space-1)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--text-base)",
          fontWeight: 600,
          color: stale ? "var(--text-muted)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function UserDetailModal({
  user,
  basePath,
  onClose,
  onChanged,
}: {
  user: AdminUser;
  basePath: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [editingAccess, setEditingAccess] = useState(false);
  const [form, setForm] = useState<EditForm>(() => buildFormFromUser(user));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(buildFormFromUser(user));
    setEditingAccess(false);
  }, [user.id]);

  const saveAccess = async () => {
    setBusy(true);
    try {
      await adminApi.updateAccess(basePath, user.id, buildAccessPayload(form));
      toast.success("Access updated");
      setEditingAccess(false);
      onChanged();
    } catch {
      toast.error("Failed to update access");
    } finally {
      setBusy(false);
    }
  };

  const toggleSuspend = async () => {
    if (!user.suspended) {
      const reason = window.prompt("Reason for pausing this account (optional):") || "";
      if (
        !window.confirm(
          `Pause ${user.email}? They'll be logged out immediately and blocked from logging in, searching, or rating until reactivated.`,
        )
      )
        return;
      setBusy(true);
      try {
        await adminApi.suspendUser(basePath, user.id, { suspended: true, reason });
        toast.success(`Paused ${user.email}`);
        onChanged();
      } catch {
        toast.error("Failed to pause user");
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(true);
      try {
        await adminApi.suspendUser(basePath, user.id, { suspended: false });
        toast.success(`Reactivated ${user.email}`);
        onChanged();
      } catch {
        toast.error("Failed to reactivate user");
      } finally {
        setBusy(false);
      }
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Permanently delete ${user.email} and every job crawled for them? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await adminApi.deleteUser(basePath, user.id);
      toast.success(`Deleted ${res.deleted_user} (${res.deleted_jobs} jobs)`);
      onChanged();
      onClose();
    } catch {
      toast.error("Failed to delete user");
    } finally {
      setBusy(false);
    }
  };

  const isFull = isUserFullAccess(user);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-user-modal-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
      className="admin-modal-overlay"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="admin-modal"
        style={{
          background: "var(--bg-card)",
          color: "var(--text)",
          borderRadius: "var(--radius-lg)",
          width: "100%",
          maxWidth: 560,
          maxHeight: "92vh",
          overflowY: "auto",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
          padding: "var(--space-6)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3
              id="admin-user-modal-title"
              style={{
                margin: 0,
                fontSize: "var(--text-xl)",
                fontWeight: 700,
                color: "var(--text)",
                wordBreak: "break-word",
              }}
            >
              {user.name || "Unnamed"}
            </h3>
            <div
              style={{
                fontSize: "var(--text-sm)",
                color: "var(--text-muted)",
                fontFamily: "monospace",
                marginTop: 2,
                wordBreak: "break-all",
              }}
            >
              {user.email}
            </div>
          </div>
          <StatusBadge user={user} />
        </div>

        {user.suspended && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              color: "var(--danger)",
              fontSize: "var(--text-xs)",
              marginBottom: "var(--space-4)",
              lineHeight: 1.5,
            }}
          >
            Paused {formatRelativeTime(user.suspended_at)}
            {user.suspended_reason ? `: ${user.suspended_reason}` : ""}
          </div>
        )}

        <p className="label" style={{ marginBottom: "var(--space-2)" }}>
          Activity
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: "var(--space-3)",
            marginBottom: "var(--space-5)",
          }}
        >
          <ActivityStat
            label="Last login"
            value={formatRelativeTime(user.last_login_at)}
            stale={isInactive24h(user.last_login_at)}
          />
          <ActivityStat
            label="Last active"
            value={formatRelativeTime(user.last_active_at)}
            stale={isInactive24h(user.last_active_at)}
          />
          <ActivityStat
            label="Last manual search"
            value={formatRelativeTime(user.last_search_at)}
          />
          <ActivityStat
            label="Last manual rate"
            value={formatRelativeTime(user.last_manual_rate_at)}
          />
        </div>

        <p className="label" style={{ marginBottom: "var(--space-2)" }}>
          Usage
        </p>
        <div className="admin-stat-row" style={{ marginBottom: "var(--space-5)", marginTop: 0 }}>
          <UsageStat
            label="Searches"
            used={user.searches_used}
            limit={user.search_limit}
            unlimited={isFull}
            color="var(--success)"
          />
          <UsageStat
            label="Ratings"
            used={user.ratings_used}
            limit={user.rating_limit}
            unlimited={isFull}
            color="var(--warning)"
          />
          <UsageStat
            label="AI tokens (today)"
            used={user.daily_tokens_used ?? user.ai_usage?.today?.total_tokens ?? 0}
            limit={user.daily_token_limit ?? DEFAULT_DAILY_TOKEN_LIMIT}
            unlimited={isFull || isUnlimitedTokenCap(user.daily_token_limit)}
            color="var(--accent)"
          />
        </div>

        {user.ai_usage && (
          <div
            style={{
              marginBottom: "var(--space-5)",
              padding: "10px 12px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-1)",
              }}
            >
              <Cpu size={13} style={{ color: "var(--accent)" }} />
              <span style={{ fontWeight: 600, color: "var(--text)" }}>AI usage</span>
            </div>
            Today:{" "}
            {formatCostLine(
              user.ai_usage.today?.total_tokens,
              user.ai_usage.today?.llm_calls,
              user.ai_usage.today?.estimated_cost_usd,
              user.ai_usage.cost_estimation_enabled,
            )}
            <br />
            Month: {formatTokens(user.ai_usage.this_month?.total_tokens)} tokens
            {user.ai_usage.cost_estimation_enabled &&
              ` · ${formatUsd(user.ai_usage.this_month?.estimated_cost_usd)}`}
            <br />
            Lifetime: {formatTokens(user.ai_usage.lifetime?.total_tokens)} tokens ·{" "}
            {user.ai_usage.lifetime?.llm_calls ?? 0} LLM
            {user.ai_usage.cost_estimation_enabled &&
              ` · ${formatUsd(user.ai_usage.lifetime?.estimated_cost_usd)}`}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "var(--space-2)",
          }}
        >
          <p className="label" style={{ margin: 0 }}>
            Access
          </p>
          {!editingAccess && (
            <button
              type="button"
              onClick={() => setEditingAccess(true)}
              className="btn btn-secondary"
              style={{ fontSize: "var(--text-xs)", padding: "6px 10px" }}
            >
              Manage access
            </button>
          )}
        </div>

        {editingAccess ? (
          <UserEditForm
            form={form}
            setForm={setForm}
            onSave={saveAccess}
            onCancel={() => setEditingAccess(false)}
          />
        ) : (
          <p
            style={{
              margin: "0 0 18px",
              fontSize: "var(--text-sm)",
              color: "var(--text-secondary)",
            }}
          >
            {user.admin_notes || "No notes."}
          </p>
        )}

        <div
          style={{
            marginTop: "var(--space-5)",
            paddingTop: 18,
            borderTop: "1px solid var(--border)",
          }}
        >
          <p className="label" style={{ marginBottom: "var(--space-3)", color: "var(--danger)" }}>
            Danger zone
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={toggleSuspend}
              disabled={busy}
              className="btn btn-secondary"
              style={{ gap: "var(--space-2)" }}
            >
              <Ban size={14} />
              {user.suspended ? "Reactivate account" : "Pause account"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="btn btn-danger"
              style={{ gap: "var(--space-2)" }}
            >
              <Trash2 size={14} />
              Delete account
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost"
          style={{ width: "100%", marginTop: "var(--space-5)", justifyContent: "center" }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

const JOB_STATUSES = [
  "NEW",
  "SAVED",
  "APPLIED",
  "HALF_APPLIED",
  "INTERVIEWING",
  "FOLLOWUP",
  "OFFER",
  "REJECTED",
] as const;

type FilterType =
  "all" | "old" | "unrated" | "low_score" | "below_score" | "by_status" | "auto_rejected";

const FILTER_OPTIONS: {
  value: FilterType;
  label: string;
  desc: string;
  icon: React.ReactNode;
  danger?: boolean;
}[] = [
  {
    value: "old",
    label: "Old jobs",
    desc: "Crawled more than N days ago",
    icon: <Clock size={18} />,
  },
  { value: "unrated", label: "Unrated", desc: "No AI rating stored yet", icon: <Star size={18} /> },
  {
    value: "low_score",
    label: "Low-scored",
    desc: "Score ≤ N (includes 0)",
    icon: <TrendingDown size={18} />,
  },
  {
    value: "below_score",
    label: "Below 6",
    desc: "Score 0 or rated below 6/10",
    icon: <TrendingDown size={18} />,
  },
  {
    value: "by_status",
    label: "By status",
    desc: "Jobs in specific pipeline stages",
    icon: <Layers size={18} />,
  },
  {
    value: "auto_rejected",
    label: "Auto-rejected",
    desc: "Hard disqualifiers flagged by AI",
    icon: <Ban size={18} />,
  },
  {
    value: "all",
    label: "All jobs",
    desc: "Every job crawled by this user",
    icon: <Database size={18} />,
    danger: true,
  },
];

function JobCleanupPanel({ users, basePath }: { users: AdminUser[]; basePath: string }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [filterType, setFilterType] = useState<FilterType>("old");
  const [olderThanDays, setOlderThanDays] = useState<number | "">(30);
  const [maxScore, setMaxScore] = useState<number | "">(3);
  const [minScore, setMinScore] = useState<number | "">(6);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["REJECTED"]);
  const [preview, setPreview] = useState<{ count: number; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const resetPreview = () => {
    setPreview(null);
    setConfirmed(false);
  };

  const toggleStatus = (s: string) =>
    setSelectedStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const buildPayload = (dry: boolean) => ({
    user_id: userId,
    filter_type: filterType,
    older_than_days: filterType === "old" ? olderThanDays || 1 : undefined,
    max_score: filterType === "low_score" ? maxScore || 0 : undefined,
    min_score: filterType === "below_score" ? minScore || 6 : undefined,
    statuses: filterType === "by_status" ? selectedStatuses : undefined,
    dry_run: dry,
  });

  const handlePreview = async () => {
    if (!userId) return toast.error("Select a user first");
    if (filterType === "by_status" && selectedStatuses.length === 0)
      return toast.error("Select at least one status");
    setLoading(true);
    resetPreview();
    try {
      const res = await adminApi.cleanupJobs(basePath, buildPayload(true));
      setPreview({ count: res.would_delete ?? 0, email: res.target_email ?? "" });
    } catch {
      toast.error("Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!preview || !confirmed) return;
    setLoading(true);
    try {
      const res = await adminApi.cleanupJobs(basePath, buildPayload(false));
      toast.success(`Deleted ${res.deleted} jobs for ${res.target_email}`);
      resetPreview();
      setConfirmed(false);
    } catch {
      toast.error("Deletion failed");
    } finally {
      setLoading(false);
    }
  };

  const selectedOpt = FILTER_OPTIONS.find((o) => o.value === filterType)!;

  return (
    <div className="card" style={{ padding: 0, marginTop: "var(--space-6)", overflow: "hidden" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "none",
          border: "none",
          cursor: "pointer",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              background: "var(--danger-bg)",
              border: "1px solid var(--danger-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Trash2 size={15} style={{ color: "var(--danger)" }} />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: "var(--text-base)", fontWeight: 600, color: "var(--text)" }}>
              Job database cleanup
            </div>
            <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Permanently delete jobs, scoped per user, cannot be undone
            </div>
          </div>
        </div>
        {open ? (
          <ChevronUp size={16} style={{ color: "var(--text-muted)" }} />
        ) : (
          <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />
        )}
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {/* Step 1 — User */}
          <div style={{ padding: "20px 20px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-3)",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                1
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                Select user
              </span>
            </div>
            <select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                resetPreview();
              }}
              className="input"
              style={{ maxWidth: 360 }}
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
          </div>

          {/* Step 2 — Filter cards */}
          <div style={{ padding: "20px 20px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-3)",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                Choose filter
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: "var(--space-2)",
              }}
            >
              {FILTER_OPTIONS.map((opt) => {
                const active = filterType === opt.value;
                const borderColor = active
                  ? opt.danger
                    ? "var(--danger)"
                    : "var(--accent)"
                  : "var(--border)";
                const bgColor = active
                  ? opt.danger
                    ? "var(--danger-bg)"
                    : "var(--accent-light)"
                  : "var(--bg-secondary)";
                const iconColor = active
                  ? opt.danger
                    ? "var(--danger)"
                    : "var(--accent)"
                  : "var(--text-muted)";
                const textColor = active
                  ? opt.danger
                    ? "var(--danger)"
                    : "var(--accent)"
                  : "var(--text)";

                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setFilterType(opt.value);
                      resetPreview();
                    }}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "var(--radius)",
                      border: `1.5px solid ${borderColor}`,
                      background: bgColor,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ color: iconColor, marginBottom: "var(--space-2)" }}>
                      {opt.icon}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-sm)",
                        fontWeight: 600,
                        color: textColor,
                        marginBottom: 2,
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontSize: "var(--text-xs)",
                        color: "var(--text-muted)",
                        lineHeight: 1.4,
                      }}
                    >
                      {opt.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step 3 — Options for selected filter */}
          <div style={{ padding: "20px 20px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-3)",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                3
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                Configure:{" "}
                <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                  {selectedOpt.label}
                </span>
              </span>
            </div>

            {filterType === "all" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  padding: "12px 14px",
                  borderRadius: "var(--radius)",
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger-border)",
                  marginBottom: "var(--space-1)",
                }}
              >
                <AlertTriangle
                  size={15}
                  style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }}
                />
                <p
                  style={{
                    margin: 0,
                    fontSize: "var(--text-sm)",
                    color: "var(--danger)",
                    lineHeight: 1.5,
                  }}
                >
                  This will delete <strong>every</strong> job crawled by the selected user. There is
                  no undo.
                </p>
              </div>
            )}

            {filterType === "old" && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  Crawled more than
                </span>
                <input
                  type="number"
                  value={olderThanDays}
                  min={1}
                  onChange={(e) => {
                    setOlderThanDays(e.target.value === "" ? "" : parseInt(e.target.value, 10));
                    resetPreview();
                  }}
                  onBlur={() => olderThanDays === "" && setOlderThanDays(1)}
                  className="input"
                  style={{ maxWidth: 80, textAlign: "center" }}
                />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  days ago
                </span>
              </div>
            )}

            {filterType === "low_score" && (
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  AI score ≤
                </span>
                <input
                  type="number"
                  value={maxScore}
                  min={0}
                  max={9}
                  onChange={(e) => {
                    setMaxScore(e.target.value === "" ? "" : parseInt(e.target.value, 10));
                    resetPreview();
                  }}
                  onBlur={() => maxScore === "" && setMaxScore(0)}
                  className="input"
                  style={{ maxWidth: 70, textAlign: "center" }}
                />
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  out of 10 (0–9)
                </span>
              </div>
            )}

            {filterType === "below_score" && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                  Delete jobs scored below
                </span>
                <input
                  type="number"
                  value={minScore}
                  min={2}
                  max={10}
                  onChange={(e) => {
                    setMinScore(e.target.value === "" ? "" : parseInt(e.target.value, 10));
                    resetPreview();
                  }}
                  onBlur={() => minScore === "" && setMinScore(6)}
                  className="input"
                  style={{ maxWidth: 70, textAlign: "center" }}
                />
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  / 10 (includes score 0, failed or weak fits)
                </span>
              </div>
            )}

            {filterType === "by_status" && (
              <div>
                <p
                  style={{
                    margin: "0 0 10px",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                  }}
                >
                  Select statuses to include in deletion:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                  {JOB_STATUSES.map((s) => {
                    const checked = selectedStatuses.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          toggleStatus(s);
                          resetPreview();
                        }}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "var(--radius-pill)",
                          border: checked ? "1.5px solid var(--danger)" : "1px solid var(--border)",
                          background: checked ? "var(--danger-bg)" : "var(--bg-secondary)",
                          color: checked ? "var(--danger)" : "var(--text-secondary)",
                          fontSize: "var(--text-xs)",
                          fontWeight: checked ? 600 : 400,
                          cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        {s.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {(filterType === "unrated" || filterType === "auto_rejected") && (
              <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
                No extra configuration needed. Preview to see how many match.
              </p>
            )}
          </div>

          {/* Step 4 — Preview + confirm */}
          <div style={{ padding: "20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                marginBottom: "var(--space-4)",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: preview && preview.count > 0 ? "var(--danger)" : "var(--accent)",
                  color: "#fff",
                  fontSize: "var(--text-xs)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                4
              </span>
              <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--text)" }}>
                Preview & confirm
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading || !userId}
                className="btn btn-secondary"
                style={{ fontSize: "var(--text-sm)" }}
              >
                {loading && !preview ? "Checking..." : "Preview count"}
              </button>

              {preview !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "8px 14px",
                    borderRadius: "var(--radius)",
                    background: preview.count > 0 ? "var(--danger-bg)" : "var(--success-bg)",
                    border: `1px solid ${preview.count > 0 ? "var(--danger-border)" : "var(--success-border)"}`,
                  }}
                >
                  {preview.count > 0 ? (
                    <AlertTriangle size={14} style={{ color: "var(--danger)", flexShrink: 0 }} />
                  ) : null}
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: 600,
                      color: preview.count > 0 ? "var(--danger)" : "var(--success)",
                    }}
                  >
                    {preview.count === 0
                      ? "Nothing to delete, filter matches 0 jobs"
                      : `${preview.count} job${preview.count !== 1 ? "s" : ""} match for ${preview.email}`}
                  </span>
                </div>
              )}
            </div>

            {preview !== null && preview.count > 0 && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-3)",
                    cursor: "pointer",
                    padding: "12px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${confirmed ? "var(--danger)" : "var(--border)"}`,
                    background: confirmed ? "var(--danger-bg)" : "var(--bg-secondary)",
                    transition: "all 0.15s",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    style={{ marginTop: 2, accentColor: "var(--danger)" }}
                  />
                  <span
                    style={{ fontSize: "var(--text-sm)", color: "var(--text)", lineHeight: 1.5 }}
                  >
                    I understand that deleting {preview.count} job{preview.count !== 1 ? "s" : ""}{" "}
                    for <strong>{preview.email}</strong> is permanent and cannot be undone.
                  </span>
                </label>

                {confirmed && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={loading}
                    className="btn btn-danger"
                    style={{ width: "100%", justifyContent: "center", gap: "var(--space-2)" }}
                  >
                    <Trash2 size={14} />
                    {loading ? "Deleting..." : `Delete ${preview.count} jobs permanently`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const basePath = user?.adminBasePath || "";
  const isMobile = useIsMobile();
  const [aiSummary, setAiSummary] = useState<PlatformAiSummary | null>(null);

  const loadUsers = async () => {
    if (!basePath) return;
    setLoading(true);
    try {
      const data = await adminApi.listUsers(basePath);
      setUsers(data.users || []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const loadAiSummary = async () => {
    if (!basePath) return;
    try {
      const data = await adminApi.getAiSummary(basePath);
      setAiSummary(data);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    loadUsers();
    loadAiSummary();
  }, [basePath]);

  const filteredUsers = users.filter(
    (u) =>
      u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const selectedUser = users.find((u) => u.id === selectedUserId) || null;

  const handleChanged = async () => {
    await loadUsers();
    await loadAiSummary();
  };

  if (!user?.isAdmin) {
    return (
      <div className="page-shell" style={{ textAlign: "center", paddingTop: 60 }}>
        Access denied
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div style={{ marginBottom: "var(--space-5)" }}>
        <h1
          style={{
            fontSize: "var(--text-2xl)",
            fontWeight: 700,
            margin: "0 0 4px",
            color: "var(--text)",
          }}
        >
          Admin panel
        </h1>
        <p style={{ margin: 0, fontSize: "var(--text-base)", color: "var(--text-muted)" }}>
          Manage user access, full access or temporary grants (12h / 1 day)
        </p>
      </div>

      {aiSummary && (
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            marginBottom: "var(--space-4)",
            background: "var(--accent-light)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              marginBottom: "var(--space-3)",
            }}
          >
            <Zap size={18} style={{ color: "var(--accent)" }} />
            <h2
              style={{
                margin: 0,
                fontSize: "var(--text-base)",
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              Platform AI usage
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "var(--space-3)",
              marginBottom: "var(--space-3)",
            }}
          >
            <DataStat label="Today tokens" value={formatTokens(aiSummary.today?.total_tokens)} />
            <DataStat
              label="Month tokens"
              value={formatTokens(aiSummary.this_month?.total_tokens)}
            />
            <DataStat
              label="LLM calls (lifetime)"
              value={String(aiSummary.lifetime?.llm_calls ?? 0)}
            />
            {aiSummary.cost_estimation_enabled ? (
              aiSummary.monthly_budget_usd != null && aiSummary.monthly_budget_usd > 0 ? (
                <DataStat
                  label="Budget left"
                  value={formatUsd(aiSummary.monthly_remaining_usd ?? 0, true)}
                />
              ) : (
                <DataStat
                  label="Month cost (est.)"
                  value={formatUsd(aiSummary.this_month?.estimated_cost_usd, true)}
                />
              )
            ) : (
              <DataStat label="Cost (est.)" value="Not configured" />
            )}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Rating: {aiSummary.providers?.rating_llm} / {aiSummary.providers?.rating_model}
            {aiSummary.cost_estimation_enabled
              ? aiSummary.monthly_budget_usd
                ? ` · Monthly budget: ${formatUsd(aiSummary.monthly_budget_usd, true)}`
                : ` · Month cost: ${formatUsd(aiSummary.this_month?.estimated_cost_usd, true)}`
              : " · Showing tokens only, set AI_COST_PER_1K_* in .env for $ estimates"}
          </p>
        </div>
      )}

      <input
        type="text"
        placeholder="Search users by name or email..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="input"
        style={{ marginBottom: "var(--space-4)", maxWidth: "100%" }}
      />

      {loading ? (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "var(--text-base)",
          }}
        >
          Loading users...
        </div>
      ) : filteredUsers.length === 0 ? (
        <div
          className="card"
          style={{
            padding: "var(--space-8)",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: "var(--text-base)",
          }}
        >
          No users found
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {filteredUsers.map((u) => (
            <AdminUserCard key={u.id} user={u} onOpen={() => setSelectedUserId(u.id)} />
          ))}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                fontSize: "var(--text-sm)",
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "var(--bg-secondary)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {[
                    "User",
                    "Status",
                    "Last active",
                    "Searches",
                    "Ratings",
                    "AI (month)",
                    "Notes",
                    "",
                  ].map((col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "left",
                        padding: "12px 16px",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isFull = isUserFullAccess(u);
                  const searchPct = getPct(u.searches_used, u.search_limit);
                  const ratingPct = getPct(u.ratings_used, u.rating_limit);
                  const inactive = isInactive24h(u.last_active_at);

                  return (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <td style={{ padding: "14px 16px", minWidth: 180 }}>
                        <div style={{ fontWeight: 600 }}>{u.name || "Unnamed"}</div>
                        <div
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                            fontFamily: "monospace",
                            marginTop: 2,
                          }}
                        >
                          {u.email}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <StatusBadge user={u} />
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          minWidth: 110,
                          color: inactive ? "var(--text-muted)" : "var(--text-secondary)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatRelativeTime(u.last_active_at)}
                      </td>
                      <td style={{ padding: "14px 16px", minWidth: 120 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-1)",
                            fontFamily: "monospace",
                            fontWeight: 600,
                          }}
                        >
                          {u.searches_used}
                          {isFull ? (
                            <UnlimitedBadge />
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                              / {u.search_limit}
                            </span>
                          )}
                        </div>
                        {!isFull && <ProgressBar pct={searchPct} color="var(--success)" />}
                      </td>
                      <td style={{ padding: "14px 16px", minWidth: 120 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-1)",
                            fontFamily: "monospace",
                            fontWeight: 600,
                          }}
                        >
                          {u.ratings_used}
                          {isFull ? (
                            <UnlimitedBadge />
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                              / {u.rating_limit}
                            </span>
                          )}
                        </div>
                        {!isFull && <ProgressBar pct={ratingPct} color="var(--warning)" />}
                      </td>
                      <td style={{ padding: "14px 16px", minWidth: 130 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-1)",
                            fontFamily: "monospace",
                            fontWeight: 600,
                            fontSize: "var(--text-xs)",
                          }}
                        >
                          {formatTokens(u.daily_tokens_used ?? u.ai_usage?.today?.total_tokens)}{" "}
                          today
                          {isFull || isUnlimitedTokenCap(u.daily_token_limit) ? (
                            <UnlimitedBadge />
                          ) : (
                            <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                              / {formatTokenCap(u.daily_token_limit)}
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--text-xs)",
                            color: "var(--text-muted)",
                            marginTop: 2,
                          }}
                        >
                          {formatTokens(u.ai_usage?.this_month?.total_tokens)} this month
                          {u.ai_usage?.cost_estimation_enabled &&
                            ` · ${formatUsd(u.ai_usage?.this_month?.estimated_cost_usd, true)}`}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          color: "var(--text-secondary)",
                          maxWidth: 200,
                        }}
                      >
                        {u.admin_notes || "—"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedUserId(u.id);
                          }}
                          className="btn btn-ghost"
                          style={{ fontSize: "var(--text-xs)", padding: "6px 10px" }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          basePath={basePath}
          onClose={() => setSelectedUserId(null)}
          onChanged={handleChanged}
        />
      )}

      <JobCleanupPanel users={users} basePath={basePath} />

      <p
        style={{
          marginTop: "var(--space-6)",
          fontSize: "var(--text-xs)",
          color: "var(--text-muted)",
          lineHeight: 1.6,
          maxWidth: 480,
        }}
      >
        Lifetime limits apply to free users. Use full or temporary options for more access. High
        numbers (9999) also act as unlimited.
      </p>
    </div>
  );
}
