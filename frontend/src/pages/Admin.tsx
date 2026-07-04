import { Fragment, useEffect, useState } from "react";
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
        fontSize: 10,
        fontWeight: 700,
        color: "var(--success)",
        background: "var(--success-bg)",
        border: "1px solid var(--success-border)",
        borderRadius: 20,
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
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{value}</div>
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
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span
          style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 14, color: "var(--text)" }}
        >
          {formatTokens(used)}
          {!unlimited && ` / ${formatTokens(limit)}`}
        </span>
        {unlimited && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "var(--success)",
              background: "var(--success-bg)",
              border: "1px solid var(--success-border)",
              borderRadius: 20,
              padding: "1px 6px",
              lineHeight: 1.6,
            }}
          >
            ∞
          </span>
        )}
      </div>
      {!unlimited && (
        <div className="admin-progress">
          <span style={{ width: `${pct}%`, background: color }} />
        </div>
      )}
    </div>
  );
}

function StatusBadge({ user }: { user: AdminUser }) {
  const isFull = isUserFullAccess(user);
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
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px solid var(--border)",
      }}
    >
      <p className="label" style={{ marginBottom: 8 }}>
        Access level
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 14,
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
            fontSize: 13,
            color: "var(--success)",
            background: "var(--success-bg)",
            border: "1px solid var(--success-border)",
            borderRadius: 8,
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          {form.access_level === "full"
            ? "Full access grants unlimited searches, ratings, and AI tokens."
            : "Temporary full access for the selected period."}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
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
            gap: 10,
            marginBottom: 14,
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

function AdminUserCard({
  user,
  editing,
  form,
  setForm,
  onStartEdit,
  onSave,
  onCancel,
}: {
  user: AdminUser;
  editing: boolean;
  form: EditForm;
  setForm: (form: EditForm) => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isFull = isUserFullAccess(user);

  return (
    <div className="admin-user-card">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 15,
              color: "var(--text)",
              wordBreak: "break-word",
            }}
          >
            {user.name || "Unnamed"}
          </div>
          <div
            style={{
              fontSize: 12,
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

      {!editing && (
        <>
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

          {user.ai_usage && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--bg-secondary)",
                border: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
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

          {user.admin_notes && (
            <p
              style={{
                margin: "12px 0 0",
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              {user.admin_notes}
            </p>
          )}

          <button
            type="button"
            onClick={onStartEdit}
            className="btn btn-secondary"
            style={{ width: "100%", marginTop: 14, justifyContent: "center" }}
          >
            Manage access
          </button>
        </>
      )}

      {editing && (
        <UserEditForm form={form} setForm={setForm} onSave={onSave} onCancel={onCancel} />
      )}
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
    <div className="card" style={{ padding: 0, marginTop: 24, overflow: "hidden" }}>
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
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
              Job database cleanup
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Permanently delete jobs — scoped per user, cannot be undone
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
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                1
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
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
              <option value="">— Select a user —</option>
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
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Choose filter
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 8,
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
                      borderRadius: 10,
                      border: `1.5px solid ${borderColor}`,
                      background: bgColor,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ color: iconColor, marginBottom: 6 }}>{opt.icon}</div>
                    <div
                      style={{ fontSize: 13, fontWeight: 600, color: textColor, marginBottom: 2 }}
                    >
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
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
                gap: 8,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                3
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Configure —{" "}
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
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger-border)",
                  marginBottom: 4,
                }}
              >
                <AlertTriangle
                  size={15}
                  style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }}
                />
                <p style={{ margin: 0, fontSize: 13, color: "var(--danger)", lineHeight: 1.5 }}>
                  This will delete <strong>every</strong> job crawled by the selected user. There is
                  no undo.
                </p>
              </div>
            )}

            {filterType === "old" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
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
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>days ago</span>
              </div>
            )}

            {filterType === "low_score" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>AI score ≤</span>
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
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>out of 10 (0–9)</span>
              </div>
            )}

            {filterType === "below_score" && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
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
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  / 10 (includes score 0 — failed or weak fits)
                </span>
              </div>
            )}

            {filterType === "by_status" && (
              <div>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--text-muted)" }}>
                  Select statuses to include in deletion:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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
                          borderRadius: 20,
                          border: checked ? "1.5px solid var(--danger)" : "1px solid var(--border)",
                          background: checked ? "var(--danger-bg)" : "var(--bg-secondary)",
                          color: checked ? "var(--danger)" : "var(--text-secondary)",
                          fontSize: 12,
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
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary)" }}>
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
                gap: 8,
                marginBottom: 14,
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: preview && preview.count > 0 ? "var(--danger)" : "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                4
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Preview & confirm
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={handlePreview}
                disabled={loading || !userId}
                className="btn btn-secondary"
                style={{ fontSize: 13 }}
              >
                {loading && !preview ? "Checking..." : "Preview count"}
              </button>

              {preview !== null && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 14px",
                    borderRadius: 10,
                    background: preview.count > 0 ? "var(--danger-bg)" : "var(--success-bg)",
                    border: `1px solid ${preview.count > 0 ? "var(--danger-border)" : "var(--success-border)"}`,
                  }}
                >
                  {preview.count > 0 ? (
                    <AlertTriangle size={14} style={{ color: "var(--danger)", flexShrink: 0 }} />
                  ) : null}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: preview.count > 0 ? "var(--danger)" : "var(--success)",
                    }}
                  >
                    {preview.count === 0
                      ? "Nothing to delete — filter matches 0 jobs"
                      : `${preview.count} job${preview.count !== 1 ? "s" : ""} match for ${preview.email}`}
                  </span>
                </div>
              )}
            </div>

            {preview !== null && preview.count > 0 && (
              <div style={{ marginTop: 14 }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: `1px solid ${confirmed ? "var(--danger)" : "var(--border)"}`,
                    background: confirmed ? "var(--danger-bg)" : "var(--bg-secondary)",
                    transition: "all 0.15s",
                    marginBottom: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    style={{ marginTop: 2, accentColor: "var(--danger)" }}
                  />
                  <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
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
                    style={{ width: "100%", justifyContent: "center", gap: 8 }}
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
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>({
    access_level: "limited",
    search_limit: 0,
    rating_limit: 0,
    daily_token_limit: DEFAULT_DAILY_TOKEN_LIMIT,
    monthly_token_limit: 0,
    notes: "",
  });

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

  const startEdit = (u: AdminUser) => {
    let level: AccessLevel = "limited";
    if (u.full_access) level = "full";
    else if (u.full_access_until) level = "temp_12h";

    setEditing(u.id);
    setForm({
      access_level: level,
      search_limit: u.search_limit,
      rating_limit: u.rating_limit,
      daily_token_limit: u.daily_token_limit ?? DEFAULT_DAILY_TOKEN_LIMIT,
      monthly_token_limit: u.monthly_token_limit ?? 0,
      notes: u.admin_notes || "",
    });
  };

  const save = async (id: string) => {
    try {
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

      await adminApi.updateAccess(basePath, id, payload);
      toast.success("Access updated");
      setEditing(null);
      await loadUsers();
      await loadAiSummary();
    } catch {
      toast.error("Failed to update");
    }
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
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: "0 0 4px",
            color: "var(--text)",
          }}
        >
          Admin panel
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
          Manage user access — full access or temporary grants (12h / 1 day)
        </p>
      </div>

      {aiSummary && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 16,
            background: "var(--accent-light)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Zap size={18} style={{ color: "var(--accent)" }} />
            <h2
              style={{
                margin: 0,
                fontSize: 15,
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
              gap: 10,
              marginBottom: 10,
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
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Rating: {aiSummary.providers?.rating_llm} / {aiSummary.providers?.rating_model}
            {aiSummary.cost_estimation_enabled
              ? aiSummary.monthly_budget_usd
                ? ` · Monthly budget: ${formatUsd(aiSummary.monthly_budget_usd, true)}`
                : ` · Month cost: ${formatUsd(aiSummary.this_month?.estimated_cost_usd, true)}`
              : " · Showing tokens only — set AI_COST_PER_1K_* in .env for $ estimates"}
          </p>
        </div>
      )}

      <input
        type="text"
        placeholder="Search users by name or email..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="input"
        style={{ marginBottom: 16, maxWidth: "100%" }}
      />

      {loading ? (
        <div
          style={{
            padding: "48px 0",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          Loading users...
        </div>
      ) : filteredUsers.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No users found
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredUsers.map((u) => (
            <AdminUserCard
              key={u.id}
              user={u}
              editing={editing === u.id}
              form={form}
              setForm={setForm}
              onStartEdit={() => startEdit(u)}
              onSave={() => save(u.id)}
              onCancel={() => setEditing(null)}
            />
          ))}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                fontSize: 13,
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
                  {["User", "Status", "Searches", "Ratings", "AI (month)", "Notes", ""].map(
                    (col) => (
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
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isEditingThis = editing === u.id;
                  const isFull = isUserFullAccess(u);
                  const searchPct = getPct(u.searches_used, u.search_limit);
                  const ratingPct = getPct(u.ratings_used, u.rating_limit);

                  return (
                    <Fragment key={u.id}>
                      <tr style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "14px 16px", minWidth: 180 }}>
                          <div style={{ fontWeight: 600 }}>{u.name || "Unnamed"}</div>
                          <div
                            style={{
                              fontSize: 11,
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
                        <td style={{ padding: "14px 16px", minWidth: 120 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
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
                          {!isFull && (
                            <div className="admin-progress">
                              <span
                                style={{ width: `${searchPct}%`, background: "var(--success)" }}
                              />
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", minWidth: 120 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
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
                          {!isFull && (
                            <div className="admin-progress">
                              <span
                                style={{ width: `${ratingPct}%`, background: "var(--warning)" }}
                              />
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", minWidth: 130 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              fontFamily: "monospace",
                              fontWeight: 600,
                              fontSize: 12,
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
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
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
                          {!isEditingThis && (
                            <button
                              type="button"
                              onClick={() => startEdit(u)}
                              className="btn btn-ghost"
                              style={{ fontSize: 12, padding: "6px 10px" }}
                            >
                              Manage
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditingThis && (
                        <tr style={{ background: "var(--bg-secondary)" }}>
                          <td colSpan={7} style={{ padding: "16px" }}>
                            <UserEditForm
                              form={form}
                              setForm={setForm}
                              onSave={() => save(u.id)}
                              onCancel={() => setEditing(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <JobCleanupPanel users={users} basePath={basePath} />

      <p
        style={{
          marginTop: 24,
          fontSize: 12,
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
