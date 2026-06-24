import { Fragment, useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useAuthStore } from "../hooks/useStores";
import { adminApi } from "../api";
import { toast } from "react-hot-toast";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  searches_used: number;
  ratings_used: number;
  search_limit: number;
  rating_limit: number;
  full_access?: boolean;
  full_access_until?: string;
  admin_notes?: string;
}

type AccessLevel = "free" | "limited" | "full" | "temp_12h" | "temp_1d";

interface EditForm {
  access_level: AccessLevel;
  search_limit: number;
  rating_limit: number;
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

function isUserFullAccess(u: AdminUser) {
  return (
    !!u.full_access ||
    !!(u.full_access_until && new Date(u.full_access_until) > new Date())
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
          fontSize: 11,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "monospace",
          fontWeight: 600,
          fontSize: 14,
          color: "var(--text)",
        }}
      >
        {unlimited ? "Unlimited" : `${used} / ${limit}`}
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
    } else if (level === "free") {
      next.search_limit = 3;
      next.rating_limit = 10;
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
            ? "Full access grants unlimited searches and ratings."
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

      {form.access_level === "limited" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div>
            <label className="label">Search limit</label>
            <input
              type="number"
              value={form.search_limit}
              onChange={(e) =>
                setForm({
                  ...form,
                  search_limit: parseInt(e.target.value) || 0,
                })
              }
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
                  rating_limit: parseInt(e.target.value) || 0,
                })
              }
              className="input"
              disabled={limitsDisabled}
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
          </div>

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
        <UserEditForm
          form={form}
          setForm={setForm}
          onSave={onSave}
          onCancel={onCancel}
        />
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
    notes: "",
  });

  const basePath = user?.adminBasePath || "";
  const isMobile = useIsMobile();

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

  useEffect(() => {
    loadUsers();
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
      } else {
        payload.full_access = false;
        payload.search_limit = form.search_limit;
        payload.rating_limit = form.rating_limit;
      }

      await adminApi.updateAccess(basePath, id, payload);
      toast.success("Access updated");
      setEditing(null);
      await loadUsers();
    } catch {
      toast.error("Failed to update");
    }
  };

  if (!user?.isAdmin) {
    return (
      <div
        className="page-shell"
        style={{ textAlign: "center", paddingTop: 60 }}
      >
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
                  {["User", "Status", "Searches", "Ratings", "Notes", ""].map(
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
                          <div style={{ fontWeight: 600 }}>
                            {u.name || "Unnamed"}
                          </div>
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
                              fontFamily: "monospace",
                              fontWeight: 600,
                            }}
                          >
                            {isFull
                              ? "Unlimited"
                              : `${u.searches_used} / ${u.search_limit}`}
                          </div>
                          {!isFull && (
                            <div className="admin-progress">
                              <span
                                style={{
                                  width: `${searchPct}%`,
                                  background: "var(--success)",
                                }}
                              />
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", minWidth: 120 }}>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontWeight: 600,
                            }}
                          >
                            {isFull
                              ? "Unlimited"
                              : `${u.ratings_used} / ${u.rating_limit}`}
                          </div>
                          {!isFull && (
                            <div className="admin-progress">
                              <span
                                style={{
                                  width: `${ratingPct}%`,
                                  background: "var(--warning)",
                                }}
                              />
                            </div>
                          )}
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
                        <td
                          style={{ padding: "14px 16px", textAlign: "right" }}
                        >
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
                          <td colSpan={6} style={{ padding: "16px" }}>
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

      <p
        style={{
          marginTop: 24,
          fontSize: 12,
          color: "var(--text-muted)",
          lineHeight: 1.6,
          maxWidth: 480,
        }}
      >
        Lifetime limits apply to free users. Use full or temporary options for
        more access. High numbers (9999) also act as unlimited.
      </p>
    </div>
  );
}
