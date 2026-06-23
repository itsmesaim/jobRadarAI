import { useEffect, useState } from "react";
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

export function AdminPage() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    access_level: "limited" as
      | "free"
      | "limited"
      | "full"
      | "temp_12h"
      | "temp_1d",
    search_limit: 0,
    rating_limit: 0,
    notes: "",
  });

  const basePath = user?.adminBasePath || "";

  const loadUsers = async () => {
    if (!basePath) return;
    setLoading(true);
    try {
      const data = await adminApi.listUsers(basePath);
      setUsers(data.users || []);
    } catch (e: any) {
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
    let level: any = "limited";
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

  const handleAccessLevelChange = (level: any) => {
    let newForm = { ...form, access_level: level };
    if (level === "full" || level === "temp_12h" || level === "temp_1d") {
      newForm.search_limit = 9999;
      newForm.rating_limit = 9999;
    } else if (level === "free") {
      newForm.search_limit = 3;
      newForm.rating_limit = 10;
    }
    setForm(newForm);
  };

  const save = async (id: string) => {
    try {
      const payload: any = { notes: form.notes };
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

  const cancelEdit = () => {
    setEditing(null);
  };

  // Helper to compute used percent safely
  const getPct = (used: number, limit: number) =>
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  if (!user?.isAdmin) {
    return <div className="p-10 text-center">Access denied</div>;
  }

  const getStatusBadge = (u: AdminUser) => {
    const isFull =
      u.full_access ||
      (u.full_access_until && new Date(u.full_access_until) > new Date());
    if (isFull) {
      const untilText = u.full_access_until
        ? ` until ${new Date(u.full_access_until).toLocaleDateString()}`
        : "";
      return (
        <span className="px-2.5 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded-full">
          Full Access{untilText}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 text-xs font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full">
        Limited
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-8 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 min-h-screen">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Admin Panel</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage user access • Full access or temporary grants (12h/1d)
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users by name or email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">Loading users...</div>
      ) : (
        <div className="border border-gray-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
                <th className="text-left px-6 py-3.5 font-medium text-gray-600 dark:text-zinc-300">
                  User
                </th>
                <th className="text-left px-6 py-3.5 font-medium text-gray-600 dark:text-zinc-300">
                  Status
                </th>
                <th className="text-left px-6 py-3.5 font-medium text-gray-600 dark:text-zinc-300">
                  Searches
                </th>
                <th className="text-left px-6 py-3.5 font-medium text-gray-600 dark:text-zinc-300">
                  Ratings
                </th>
                <th className="text-left px-6 py-3.5 font-medium text-gray-600 dark:text-zinc-300">
                  Notes
                </th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-gray-400"
                  >
                    No users found
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => {
                const isEditingThis = editing === u.id;
                const isFull =
                  u.full_access ||
                  (u.full_access_until &&
                    new Date(u.full_access_until) > new Date());
                const searchPct =
                  u.search_limit > 0
                    ? Math.min(100, (u.searches_used / u.search_limit) * 100)
                    : 0;
                const ratingPct =
                  u.rating_limit > 0
                    ? Math.min(100, (u.ratings_used / u.rating_limit) * 100)
                    : 0;

                return (
                  <tr
                    key={u.id}
                    className="border-t hover:bg-gray-50/50 dark:hover:bg-zinc-800/60 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="font-medium">{u.name || "Unnamed"}</div>
                      <div className="text-xs text-gray-500 dark:text-zinc-400 font-mono mt-0.5">
                        {u.email}
                      </div>
                    </td>

                    <td className="px-6 py-4">{getStatusBadge(u)}</td>

                    <td className="px-6 py-4">
                      {isEditingThis ? (
                        <input
                          type="number"
                          value={form.search_limit}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              search_limit: parseInt(e.target.value) || 0,
                            })
                          }
                          className="w-20 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-sm"
                          disabled={form.access_level === "full"}
                        />
                      ) : (
                        <div>
                          <div className="font-mono font-semibold tabular-nums text-base">
                            {isFull
                              ? "Unlimited"
                              : `${u.searches_used} / ${u.search_limit}`}
                          </div>
                          {!isFull && (
                            <div className="h-1.5 mt-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-1.5 bg-emerald-500 transition-all"
                                style={{ width: `${searchPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      {isEditingThis ? (
                        <input
                          type="number"
                          value={form.rating_limit}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              rating_limit: parseInt(e.target.value) || 0,
                            })
                          }
                          className="w-20 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-sm"
                          disabled={form.access_level === "full"}
                        />
                      ) : (
                        <div>
                          <div className="font-mono font-semibold tabular-nums text-base">
                            {isFull
                              ? "Unlimited"
                              : `${u.ratings_used} / ${u.rating_limit}`}
                          </div>
                          {!isFull && (
                            <div className="h-1.5 mt-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                              <div
                                className="h-1.5 bg-amber-500 transition-all"
                                style={{ width: `${ratingPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-zinc-400 max-w-[220px] truncate">
                      {isEditingThis ? (
                        <input
                          value={form.notes}
                          onChange={(e) =>
                            setForm({ ...form, notes: e.target.value })
                          }
                          className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-2 py-1 text-sm"
                          placeholder="Internal notes..."
                        />
                      ) : (
                        u.admin_notes || (
                          <span className="text-gray-300">—</span>
                        )
                      )}
                    </td>

                    <td className="px-6 py-4 text-right">
                      {isEditingThis ? (
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => save(u.id)}
                            className="px-3 py-1 text-xs bg-black dark:bg-white text-white dark:text-black rounded hover:opacity-90"
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="px-3 py-1 text-xs border dark:border-zinc-700 rounded hover:bg-gray-50 dark:hover:bg-zinc-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(u)}
                          className="px-3 py-1 text-xs border dark:border-zinc-700 rounded text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800"
                        >
                          Manage
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit panel for access level */}
      {editing && (
        <div className="mt-4 p-4 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl">
          <div className="font-medium mb-3 text-sm">Access Level</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {(["free", "limited", "full", "temp_12h", "temp_1d"] as const).map(
              (level) => (
                <button
                  key={level}
                  onClick={() => handleAccessLevelChange(level)}
                  className={`px-4 py-1.5 text-sm rounded-xl border transition-all ${
                    form.access_level === level
                      ? "bg-zinc-900 dark:bg-white text-white dark:text-black border-transparent"
                      : "border-gray-200 dark:border-zinc-700 hover:bg-gray-50 dark:hover:bg-zinc-800"
                  }`}
                >
                  {level === "free" && "Free Tier"}
                  {level === "limited" && "Custom Limits"}
                  {level === "full" && "Full Access (permanent)"}
                  {level === "temp_12h" && "Full Access (12h)"}
                  {level === "temp_1d" && "Full Access (1 day)"}
                </button>
              ),
            )}
          </div>

          {form.access_level === "limited" && (
            <div className="grid grid-cols-2 gap-3 max-w-sm">
              <div>
                <div className="text-xs text-gray-500 dark:text-zinc-400 mb-1">
                  Search Limit
                </div>
                <input
                  type="number"
                  value={form.search_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      search_limit: parseInt(e.target.value) || 0,
                    })
                  }
                  className="border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-3 py-1.5 w-full"
                />
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-zinc-400 mb-1">
                  Rating Limit
                </div>
                <input
                  type="number"
                  value={form.rating_limit}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rating_limit: parseInt(e.target.value) || 0,
                    })
                  }
                  className="border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded px-3 py-1.5 w-full"
                />
              </div>
            </div>
          )}

          {form.access_level === "full" && (
            <div className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 p-3 rounded">
              Full Access grants unlimited searches and ratings.
            </div>
          )}
          {(form.access_level === "temp_12h" ||
            form.access_level === "temp_1d") && (
            <div className="text-sm text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 p-3 rounded">
              Temporary full access granted for this period.
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                const id = editing;
                if (id) save(id);
              }}
              className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-sm font-medium rounded-xl"
            >
              Save Changes
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 border border-gray-300 dark:border-zinc-700 rounded-xl text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 text-xs text-gray-500 dark:text-zinc-400 max-w-md">
        <strong>Lifetime limits</strong> for free users. Use Full or temporary
        options for more access. High numbers (9999) also act as unlimited.
      </div>
    </div>
  );
}
