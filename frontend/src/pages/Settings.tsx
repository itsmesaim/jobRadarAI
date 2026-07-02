import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  Check,
  Loader,
  Plus,
  X,
  Save,
  Info,
  Brain,
  Trash2,
  Download,
  ShieldAlert,
  Skull,
  Mail,
  Clock,
  Star,
  FolderX,
  AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";
import { authApi, cvApi, userApi, jobsApi } from "../api/index";
import { useAuthStore } from "../hooks/useStores";
import {
  LimitContactModal,
  parseLimitKindFromDetail,
  type LimitKind,
} from "../components/LimitContactModal";
import type { DataSummary, UserPreferences } from "../types";

const DEFAULT_PREFS: UserPreferences = {
  preferred_locations: [],
  primary_role: "Full Stack Developer",
  secondary_roles: [],
  job_types: {
    full_time: true,
    internship: false,
    contract: false,
    remote: true,
    graduate: false,
  },
  min_salary: 0,
  key_skills: [],
  experience_level: "mid",
  work_authorization: "",
  avoid_industries: [],
  work_mode: { remote: true, hybrid: true, onsite: false },
  about_me: "",
  email_reminders_enabled: true,
};

const EXPERIENCE_LEVELS: {
  value: UserPreferences["experience_level"];
  label: string;
  hint: string;
}[] = [
  { value: "junior", label: "Junior", hint: "0-2 years" },
  { value: "mid", label: "Mid-level", hint: "2-5 years" },
  { value: "senior", label: "Senior", hint: "5+ years" },
];

const CURRENCIES = ["EUR", "USD", "INR", "AED", "GBP", "SGD"];

const LOCATION_EXAMPLES = [
  "Dublin Ireland",
  "Remote",
  "Bangalore India",
  "Dubai UAE",
  "London UK",
  "Berlin Germany",
];

export function SettingsPage() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [limitModalKind, setLimitModalKind] = useState<LimitKind | null>(null);
  const [pwForm, setPwForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [dirty, setDirty] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("EUR");
  const [newOverrideSkill, setNewOverrideSkill] = useState("");
  const [newOverrideContext, setNewOverrideContext] = useState("");
  const [addingOverride, setAddingOverride] = useState(false);

  const { data: cv } = useQuery({
    queryKey: ["cv"],
    queryFn: cvApi.get,
    retry: false,
  });

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: userApi.getPreferences,
  });

  const { data: overridesData, refetch: refetchOverrides } = useQuery({
    queryKey: ["skill-overrides"],
    queryFn: userApi.getSkillOverrides,
  });

  const { data: dataSummary, refetch: refetchDataSummary } = useQuery({
    queryKey: ["data-summary"],
    queryFn: userApi.getDataSummary,
  });

  // sync server prefs into local state once loaded
  useEffect(() => {
    if (prefs) {
      setLocalPrefs({
        ...DEFAULT_PREFS,
        ...prefs,
        job_types: { ...DEFAULT_PREFS.job_types, ...(prefs.job_types || {}) },
        work_mode: { ...DEFAULT_PREFS.work_mode, ...(prefs.work_mode || {}) },
      });
      setDirty(false);
    }
  }, [prefs]);

  const saveMutation = useMutation({
    mutationFn: () => userApi.updatePreferences(localPrefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      setDirty(false);
      toast.success("Preferences saved");
    },
    onError: () => toast.error("Failed to save"),
  });

  const addOverrideMutation = useMutation({
    mutationFn: () => userApi.addSkillOverride(newOverrideSkill.trim(), newOverrideContext.trim()),
    onSuccess: () => {
      refetchOverrides();
      setNewOverrideSkill("");
      setNewOverrideContext("");
      setAddingOverride(false);
      toast.success("Skill override saved");
    },
    onError: () => toast.error("Failed to save override"),
  });

  const deleteOverrideMutation = useMutation({
    mutationFn: (skill: string) => userApi.deleteSkillOverride(skill),
    onSuccess: () => {
      refetchOverrides();
      toast.success("Override removed");
    },
  });

  const deleteCvMutation = useMutation({
    mutationFn: cvApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cv"] });
      refetchDataSummary();
      toast.success("CV deleted from our servers");
    },
    onError: () => toast.error("Failed to delete CV"),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: () => userApi.deleteAccount(deletePassword),
    onSuccess: () => {
      logout();
      window.location.href = "/login";
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      toast.error(
        detail === "Incorrect password." ? "Incorrect password." : "Failed to delete account",
      );
    },
  });

  const handleExportData = async () => {
    try {
      const data = await userApi.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jobradar-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data downloaded");
    } catch {
      toast.error("Export failed");
    }
  };

  const update = (updates: Partial<UserPreferences>) => {
    setLocalPrefs((p) => ({ ...p, ...updates }));
    setDirty(true);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("PDF only");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5MB");
      return;
    }
    setUploading(true);
    try {
      await cvApi.upload(file);
      queryClient.invalidateQueries({ queryKey: ["cv"] });
      toast.success("CV uploaded and parsed");
    } catch (err: any) {
      const detail = err.response?.data?.detail || "Upload failed";
      if (detail.toLowerCase().includes("limit")) {
        toast.error(detail, { duration: 6000 });
        setLimitModalKind(parseLimitKindFromDetail(detail));
      } else {
        toast.error(detail);
      }
    } finally {
      setUploading(false);
    }
  };

  const addLocation = () => {
    if (!newLocation.trim()) return;
    update({
      preferred_locations: [...localPrefs.preferred_locations, newLocation.trim()],
    });
    setNewLocation("");
  };

  const addSkill = () => {
    if (!newSkill.trim()) return;
    update({ key_skills: [...localPrefs.key_skills, newSkill.trim()] });
    setNewSkill("");
  };

  const addRole = () => {
    if (!newRole.trim()) return;
    update({
      secondary_roles: [...localPrefs.secondary_roles, newRole.trim()],
    });
    setNewRole("");
  };

  const addIndustry = () => {
    if (!newIndustry.trim()) return;
    update({
      avoid_industries: [...localPrefs.avoid_industries, newIndustry.trim()],
    });
    setNewIndustry("");
  };

  const overrides: { skill: string; context: string }[] = overridesData?.overrides ?? [];

  const discardChanges = () => {
    if (prefs) {
      setLocalPrefs({
        ...DEFAULT_PREFS,
        ...prefs,
        job_types: { ...DEFAULT_PREFS.job_types, ...(prefs.job_types || {}) },
        work_mode: { ...DEFAULT_PREFS.work_mode, ...(prefs.work_mode || {}) },
      });
    } else {
      setLocalPrefs(DEFAULT_PREFS);
    }
    setDirty(false);
  };

  return (
    <div className={`settings-page${dirty ? " has-unsaved" : ""}`}>
      <div className="settings-header">
        <h2 className="settings-title">Settings</h2>
        {dirty && <span className="settings-unsaved-pill">Unsaved changes</span>}
      </div>

      {/* CV Section */}
      <Section title="CV" subtitle="Upload your master CV. Used for job rating and tailoring.">
        {cv ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--success-bg)",
                border: "1px solid var(--success)",
                borderRadius: 7,
                padding: "8px 14px",
              }}
            >
              <Check size={14} style={{ color: "var(--success)" }} />
              <span
                style={{
                  fontSize: 13,
                  color: "var(--success)",
                  fontWeight: 500,
                }}
              >
                {cv.filename}
              </span>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
            >
              <Upload size={13} /> Replace
            </button>
            <button
              onClick={() => {
                if (window.confirm("Delete your CV from JobRadar? You can upload again later.")) {
                  deleteCvMutation.mutate();
                }
              }}
              disabled={deleteCvMutation.isPending}
              className="btn btn-ghost"
              style={{ fontSize: 12, color: "var(--danger)" }}
            >
              <Trash2 size={13} /> Delete CV
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {cv.structured?.skills?.length} skills · {cv.structured?.projects?.length} projects ·{" "}
              {cv.structured?.experience?.length} roles
            </span>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
              padding: "32px 20px",
              border: "2px dashed var(--border)",
              borderRadius: 10,
              background: "var(--bg-secondary)",
              cursor: "pointer",
              gap: 8,
            }}
          >
            {uploading ? (
              <>
                <Loader size={20} className="animate-spin" style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Uploading...</span>
              </>
            ) : (
              <>
                <Upload size={20} style={{ color: "var(--text-muted)" }} />
                <span style={{ fontSize: 13, color: "var(--text)" }}>Click to upload your CV</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>PDF · Max 5MB</span>
              </>
            )}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </Section>

      {/* Email reminders */}
      <Section
        title="Email reminders"
        subtitle="Get up to 2 emails per day when you have unapplied jobs scoring 8+/10 — same nudge as the dashboard banner."
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            cursor: "pointer",
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-secondary)",
          }}
        >
          <input
            type="checkbox"
            checked={localPrefs.email_reminders_enabled}
            onChange={(e) => update({ email_reminders_enabled: e.target.checked })}
            style={{ marginTop: 3, accentColor: "var(--accent)" }}
          />
          <span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 4,
              }}
            >
              <Mail size={15} />
              Remind me to apply to high-scoring jobs
            </span>
            <span
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              Requires SMTP on the server. Lists your top matches with scores and links. Disable
              anytime here.
            </span>
          </span>
        </label>
      </Section>

      {/* About you — NEW */}
      <Section
        title="About you"
        subtitle="Career context fed directly to the rating engine. Pivot goals, constraints, priorities — injected before the JD so the LLM factors it into strengths, not just gaps."
      >
        <textarea
          className="input"
          placeholder="e.g. Looking to move from backend into AI engineering. Built production LangChain apps but PyTorch isn't on my CV — comfortable learning on the job. Not interested in pure enterprise Java roles."
          value={localPrefs.about_me}
          onChange={(e) => update({ about_me: e.target.value })}
          rows={4}
          style={{ resize: "vertical", lineHeight: 1.6 }}
        />
      </Section>

      {/* Role */}
      <Section title="Role" subtitle="What roles should we search for?">
        <div style={{ marginBottom: 12 }}>
          <label className="label">Primary role</label>
          <input
            className="input settings-field-narrow"
            value={localPrefs.primary_role}
            onChange={(e) => update({ primary_role: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Also search for</label>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 8,
            }}
          >
            {localPrefs.secondary_roles.map((r) => (
              <Tag
                key={r}
                label={r}
                onRemove={() =>
                  update({
                    secondary_roles: localPrefs.secondary_roles.filter((x) => x !== r),
                  })
                }
              />
            ))}
          </div>
          <TagInput
            value={newRole}
            onChange={setNewRole}
            onAdd={addRole}
            placeholder="e.g. AI Engineer"
          />
        </div>
      </Section>

      {/* Experience level */}
      <Section
        title="Experience level"
        subtitle="Helps the rating engine catch seniority mismatches (e.g. a role requiring 'lead a team' when you're IC)."
      >
        <div className="settings-exp-levels">
          {EXPERIENCE_LEVELS.map((lvl) => {
            const active = localPrefs.experience_level === lvl.value;
            return (
              <button
                key={lvl.value}
                onClick={() => update({ experience_level: lvl.value })}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: active ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                  background: active ? "var(--accent-light)" : "var(--bg-secondary)",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? "var(--accent)" : "var(--text)",
                  }}
                >
                  {lvl.label}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {lvl.hint}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Work authorization */}
      <Section
        title="Work authorization"
        subtitle="Used to flag jobs requiring sponsorship you don't have, or citizenship you can't meet."
      >
        <input
          className="input"
          placeholder="e.g. Stamp 1G, Ireland — no sponsorship needed"
          value={localPrefs.work_authorization}
          onChange={(e) => update({ work_authorization: e.target.value })}
        />
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 8,
          }}
        >
          <Info size={13} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Be specific — "Stamp 1G, no sponsorship needed" works much better than just "Irish work
            visa."
          </p>
        </div>
      </Section>

      {/* Locations */}
      <Section
        title="Locations"
        subtitle="Every location gets its own separate search. Add as many as you want."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {localPrefs.preferred_locations.map((l) => (
            <Tag
              key={l}
              label={l}
              onRemove={() =>
                update({
                  preferred_locations: localPrefs.preferred_locations.filter((x) => x !== l),
                })
              }
            />
          ))}
        </div>
        <TagInput
          value={newLocation}
          onChange={setNewLocation}
          onAdd={addLocation}
          placeholder="e.g. Dublin Ireland"
        />
        {/* quick-add examples */}
        <div style={{ marginTop: 10 }}>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              margin: "0 0 6px",
            }}
          >
            Quick add:
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {LOCATION_EXAMPLES.filter((ex) => !localPrefs.preferred_locations.includes(ex)).map(
              (ex) => (
                <button
                  key={ex}
                  onClick={() =>
                    update({
                      preferred_locations: [...localPrefs.preferred_locations, ex],
                    })
                  }
                  style={{
                    fontSize: 11,
                    padding: "3px 9px",
                    borderRadius: 20,
                    cursor: "pointer",
                    border: "1px dashed var(--border)",
                    background: "transparent",
                    color: "var(--text-muted)",
                  }}
                >
                  + {ex}
                </button>
              ),
            )}
          </div>
        </div>
      </Section>

      {/* Work mode */}
      <Section
        title="Work mode"
        subtitle="Onsite-only roles will be flagged as a mismatch if not selected here."
      >
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {(["remote", "hybrid", "onsite"] as const).map((mode) => (
            <label
              key={mode}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={localPrefs.work_mode[mode]}
                onChange={(e) =>
                  update({
                    work_mode: {
                      ...localPrefs.work_mode,
                      [mode]: e.target.checked,
                    },
                  })
                }
              />
              <span style={{ color: "var(--text)", textTransform: "capitalize" }}>{mode}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Job types */}
      <Section title="Job types" subtitle="What types of roles to include?">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(Object.keys(localPrefs.job_types) as (keyof typeof localPrefs.job_types)[])
            .filter((key) => key !== "remote")
            .map((key) => (
              <label
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                <input
                  type="checkbox"
                  checked={localPrefs.job_types[key]}
                  onChange={(e) =>
                    update({
                      job_types: {
                        ...localPrefs.job_types,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                <span style={{ color: "var(--text)", textTransform: "capitalize" }}>
                  {key.replace("_", " ")}
                </span>
              </label>
            ))}
        </div>
      </Section>

      {/* Avoid industries */}
      <Section
        title="Industries to avoid"
        subtitle="Jobs in these sectors will be flagged even if technically a skills fit."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {localPrefs.avoid_industries.map((ind) => (
            <Tag
              key={ind}
              label={ind}
              onRemove={() =>
                update({
                  avoid_industries: localPrefs.avoid_industries.filter((x) => x !== ind),
                })
              }
              color="var(--danger-bg)"
              textColor="var(--danger)"
            />
          ))}
        </div>
        <TagInput
          value={newIndustry}
          onChange={setNewIndustry}
          onAdd={addIndustry}
          placeholder="e.g. Payments, Healthcare compliance"
        />
      </Section>

      {/* Key skills */}
      <Section title="Key skills" subtitle="Used to generate personalised search queries.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {localPrefs.key_skills.map((s) => (
            <Tag
              key={s}
              label={s}
              onRemove={() =>
                update({
                  key_skills: localPrefs.key_skills.filter((x) => x !== s),
                })
              }
              color="var(--accent-light)"
              textColor="var(--accent)"
            />
          ))}
        </div>
        <TagInput
          value={newSkill}
          onChange={setNewSkill}
          onAdd={addSkill}
          placeholder="e.g. React"
        />
      </Section>

      {/* Minimum salary */}
      <Section
        title="Minimum salary"
        subtitle="Jobs below this are flagged. Pick the currency that matches your target market."
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <select
            value={salaryCurrency}
            onChange={(e) => setSalaryCurrency(e.target.value)}
            className="input"
            style={{ maxWidth: 90, cursor: "pointer" }}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            value={localPrefs.min_salary}
            onChange={(e) => update({ min_salary: parseInt(e.target.value) || 0 })}
            style={{ maxWidth: 140 }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>per year</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 8,
          }}
        >
          <Info size={13} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            €40-70k is mid-level in Ireland · ₹20-40 LPA is strong in India · AED 15-25k/mo is good
            in UAE (tax-free, higher real value than EUR equivalent).
          </p>
        </div>
      </Section>

      {/* Skill overrides — NEW */}
      <Section
        title="Skill overrides"
        subtitle="Skills you have that aren't on your CV. Injected into every rating call so the LLM stops flagging them as gaps."
      >
        {overrides.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 14,
            }}
          >
            {overrides.map((o) => (
              <div
                key={o.skill}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  background: "var(--purple-bg)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                }}
              >
                <Brain
                  size={13}
                  style={{
                    color: "var(--purple)",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--purple)",
                      marginBottom: 2,
                    }}
                  >
                    {o.skill}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {o.context}
                  </div>
                </div>
                <button
                  onClick={() => deleteOverrideMutation.mutate(o.skill)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    display: "flex",
                    padding: 2,
                    flexShrink: 0,
                  }}
                  title="Remove override"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {!addingOverride ? (
          <button
            onClick={() => setAddingOverride(true)}
            className="btn btn-ghost"
            style={{ fontSize: 12.5 }}
          >
            <Plus size={13} /> Add skill override
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                placeholder="Skill (e.g. plotly)"
                value={newOverrideSkill}
                onChange={(e) => setNewOverrideSkill(e.target.value)}
                style={{ maxWidth: 160 }}
                autoFocus
              />
              <input
                className="input"
                placeholder="Your experience with it..."
                value={newOverrideContext}
                onChange={(e) => setNewOverrideContext(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  newOverrideSkill &&
                  newOverrideContext &&
                  addOverrideMutation.mutate()
                }
              />
            </div>
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: 0 }}>
              e.g. "plotly" → "used in BEng for ML model visualisation across 3 projects"
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => addOverrideMutation.mutate()}
                disabled={
                  !newOverrideSkill.trim() ||
                  !newOverrideContext.trim() ||
                  addOverrideMutation.isPending
                }
                className="btn btn-primary"
                style={{ fontSize: 12 }}
              >
                {addOverrideMutation.isPending ? "Saving..." : "Save override"}
              </button>
              <button
                onClick={() => {
                  setAddingOverride(false);
                  setNewOverrideSkill("");
                  setNewOverrideContext("");
                }}
                className="btn btn-ghost"
                style={{ fontSize: 12 }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Password" subtitle="Change your sign-in password">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">Current password</label>
            <input
              className="input"
              type="password"
              value={pwForm.current}
              onChange={(e) => setPwForm({ ...pwForm, current: e.target.value })}
            />
          </div>
          <div>
            <label className="label">New password</label>
            <input
              className="input"
              type="password"
              placeholder="Min. 8 characters"
              value={pwForm.next}
              onChange={(e) => setPwForm({ ...pwForm, next: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input
              className="input"
              type="password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={changingPassword}
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              if (pwForm.next.length < 8) {
                toast.error("New password must be at least 8 characters");
                return;
              }
              if (pwForm.next !== pwForm.confirm) {
                toast.error("New passwords do not match");
                return;
              }
              setChangingPassword(true);
              try {
                const res = await authApi.changePassword(pwForm.current, pwForm.next);
                toast.success(res.message);
                setPwForm({ current: "", next: "", confirm: "" });
              } catch (err: any) {
                toast.error(err.response?.data?.detail || "Could not change password");
              } finally {
                setChangingPassword(false);
              }
            }}
          >
            {changingPassword ? "Updating..." : "Change password"}
          </button>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>
            Forgot your password?{" "}
            <a href="/forgot-password" style={{ color: "var(--accent)" }}>
              Reset via email
            </a>
          </p>
        </div>
      </Section>

      {/* Job cleanup */}
      <JobCleanupSection />

      {/* Data & privacy */}
      <DataPrivacySection
        summary={dataSummary}
        onExport={handleExportData}
        onDeleteCv={() => {
          if (window.confirm("Delete your CV from JobRadar? You can upload again later.")) {
            deleteCvMutation.mutate();
          }
        }}
        deleteCvPending={deleteCvMutation.isPending}
        onDeleteAccount={() => setShowDeleteAccount(true)}
      />

      {showDeleteAccount && (
        <div
          onClick={() => {
            setShowDeleteAccount(false);
            setDeleteConfirm("");
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              maxWidth: 420,
              width: "100%",
              padding: 24,
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <Skull size={22} style={{ color: "var(--danger)" }} />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Delete everything?</h3>
            </div>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 14,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              This permanently deletes your account, CV, preferences, skill overrides, and all saved
              jobs. No undo. No backup. Gone.
            </p>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              Enter your password and type <strong>DELETE</strong> to confirm
            </p>
            <input
              className="input"
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
              style={{ marginBottom: 10 }}
            />
            <input
              className="input"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => deleteAccountMutation.mutate()}
                disabled={
                  deleteConfirm !== "DELETE" || !deletePassword || deleteAccountMutation.isPending
                }
                className="btn btn-danger"
                style={{ flex: 1 }}
              >
                {deleteAccountMutation.isPending ? "Deleting..." : "Yes, delete my account"}
              </button>
              <button
                onClick={() => {
                  setShowDeleteAccount(false);
                  setDeleteConfirm("");
                  setDeletePassword("");
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {dirty && (
        <div className="settings-save-bar" role="region" aria-label="Unsaved changes">
          <span className="settings-save-bar-label">You have unsaved changes</span>
          <div className="settings-save-bar-actions">
            <button onClick={discardChanges} className="btn btn-ghost" style={{ fontSize: 13 }}>
              Discard
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn btn-primary"
              style={{ fontSize: 13 }}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader size={13} className="animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save size={13} /> Save changes
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {limitModalKind && (
        <LimitContactModal kind={limitModalKind} onClose={() => setLimitModalKind(null)} />
      )}
    </div>
  );
}

type UserFilterType = "old" | "by_status" | "unrated";

const USER_CLEANUP_OPTIONS: {
  value: UserFilterType;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "old",
    label: "Old listings",
    desc: "Jobs crawled more than N days ago",
    icon: <Clock size={18} />,
  },
  {
    value: "by_status",
    label: "Terminal stages",
    desc: "REJECTED, OFFER, or APPLIED jobs you're done with",
    icon: <FolderX size={18} />,
  },
  {
    value: "unrated",
    label: "Unrated jobs",
    desc: "Jobs with no AI rating yet (reduces clutter)",
    icon: <Star size={18} />,
  },
];

const TERMINAL_STATUSES = ["REJECTED", "OFFER", "APPLIED"] as const;

function JobCleanupSection() {
  const [filterType, setFilterType] = useState<UserFilterType>("old");
  const [olderThanDays, setOlderThanDays] = useState(30);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["REJECTED"]);
  const [preview, setPreview] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const resetPreview = () => {
    setPreview(null);
    setConfirmed(false);
  };

  const toggleStatus = (s: string) =>
    setSelectedStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const buildReq = () => ({
    filter_type: filterType,
    older_than_days: filterType === "old" ? olderThanDays : undefined,
    statuses: filterType === "by_status" ? selectedStatuses : undefined,
  });

  const handlePreview = async () => {
    if (filterType === "by_status" && selectedStatuses.length === 0) {
      return toast.error("Select at least one status");
    }
    setLoading(true);
    resetPreview();
    try {
      const res = await jobsApi.previewCleanup(buildReq());
      setPreview(res.count);
    } catch {
      toast.error("Preview failed — try again");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (preview === null || !confirmed) return;
    setLoading(true);
    try {
      const res = await jobsApi.executeCleanup(buildReq());
      toast.success(`Removed ${res.deleted} job${res.deleted !== 1 ? "s" : ""}`);
      resetPreview();
    } catch {
      toast.error("Deletion failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section
      title="Clean up jobs"
      subtitle="Remove old or irrelevant jobs from your list. The auto-crawler may re-add them in the next scheduled run."
    >
      {/* Re-crawl warning */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          marginBottom: 16,
        }}
      >
        <AlertTriangle size={14} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Deleted jobs may reappear after the next auto-crawl if they're still live on job boards.
          This only removes them from your list, not the source.
        </p>
      </div>

      {/* Option cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {USER_CLEANUP_OPTIONS.map((opt) => {
          const active = filterType === opt.value;
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
                border: `1.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "var(--accent-light)" : "var(--bg-secondary)",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                {opt.icon}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: active ? "var(--accent)" : "var(--text)",
                  marginBottom: 2,
                }}
              >
                {opt.label}
              </div>
              <div
                style={{
                  fontSize: 11,
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

      {/* Config for selected filter */}
      {filterType === "old" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Older than</span>
          <input
            type="number"
            value={olderThanDays}
            min={1}
            onChange={(e) => {
              setOlderThanDays(parseInt(e.target.value) || 1);
              resetPreview();
            }}
            className="input"
            style={{ maxWidth: 80, textAlign: "center" }}
          />
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>days</span>
        </div>
      )}

      {filterType === "by_status" && (
        <div style={{ marginBottom: 14 }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            Include these stages:
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TERMINAL_STATUSES.map((s) => {
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
                    padding: "5px 14px",
                    borderRadius: 20,
                    border: checked ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                    background: checked ? "var(--accent-light)" : "var(--bg-secondary)",
                    color: checked ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: 12,
                    fontWeight: checked ? 600 : 400,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview + confirm */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading}
          className="btn btn-secondary"
          style={{ fontSize: 13 }}
        >
          {loading && preview === null ? "Checking..." : "Preview count"}
        </button>

        {preview !== null && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              background: preview > 0 ? "var(--warning-bg)" : "var(--success-bg)",
              border: `1px solid ${preview > 0 ? "var(--warning-border)" : "var(--success-border)"}`,
              fontSize: 13,
              fontWeight: 600,
              color: preview > 0 ? "var(--warning)" : "var(--success)",
            }}
          >
            {preview === 0
              ? "No jobs match"
              : `${preview} job${preview !== 1 ? "s" : ""} will be removed`}
          </span>
        )}
      </div>

      {preview !== null && preview > 0 && (
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
              marginBottom: 10,
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--danger)" }}
            />
            <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>
              I understand these {preview} jobs will be permanently deleted. They may reappear after
              the next crawl.
            </span>
          </label>

          {confirmed && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="btn btn-danger"
              style={{ fontSize: 13, gap: 6 }}
            >
              <Trash2 size={13} />
              {loading ? "Deleting..." : `Delete ${preview} jobs`}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function DataPrivacySection({
  summary,
  onExport,
  onDeleteCv,
  deleteCvPending,
  onDeleteAccount,
}: {
  summary?: DataSummary;
  onExport: () => void;
  onDeleteCv: () => void;
  deleteCvPending: boolean;
  onDeleteAccount: () => void;
}) {
  return (
    <Section title="Your data" subtitle="What we store, who sees it, and how to nuke it.">
      <div
        style={{
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Skull size={18} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                lineHeight: 1.45,
              }}
            >
              {summary?.roast ?? "Yes, we store your data. No, we're not pretending otherwise."}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: 12,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              {summary?.legal_note ??
                "Job listings come from third-party APIs. Your CV may be sent to an AI for matching. Download or delete your data anytime below."}
            </p>
          </div>
        </div>
      </div>

      {summary ? (
        <>
          <p
            className="label"
            style={{
              marginBottom: 10,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ShieldAlert size={14} /> What's on file right now
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 8,
              marginBottom: 14,
            }}
          >
            <DataStat label="Jobs saved" value={String(summary.jobs.total)} />
            <DataStat label="Jobs rated" value={String(summary.jobs.rated)} />
            <DataStat label="CV uploaded" value={summary.cv ? "Yes" : "No"} />
            <DataStat label="Skill overrides" value={String(summary.skill_overrides_count)} />
          </div>

          {summary.cv && (
            <p
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                margin: "0 0 12px",
                lineHeight: 1.5,
              }}
            >
              CV: <strong>{summary.cv.filename}</strong> — {summary.cv.skills_count} skills,{" "}
              {summary.cv.experience_count} roles, {summary.cv.projects_count} projects
            </p>
          )}

          <ul
            style={{
              margin: "0 0 14px",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {summary.stored_items.map((item) => (
              <li
                key={item.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: item.stored ? "var(--text)" : "var(--text-muted)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: item.stored ? "var(--success)" : "var(--border)",
                    flexShrink: 0,
                  }}
                />
                {item.label}
              </li>
            ))}
          </ul>

          <p className="label" style={{ marginBottom: 8 }}>
            Third-party services we use
          </p>
          <ul
            style={{
              margin: "0 0 16px",
              paddingLeft: 18,
              fontSize: 12,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            {summary.third_party_services.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
          Loading your data summary...
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={onExport} className="btn btn-secondary">
          <Download size={14} /> Download my data
        </button>
        {summary?.cv && (
          <button
            onClick={onDeleteCv}
            disabled={deleteCvPending}
            className="btn btn-ghost"
            style={{ color: "var(--danger)" }}
          >
            <Trash2 size={14} />
            {deleteCvPending ? "Deleting..." : "Delete CV only"}
          </button>
        )}
        <button onClick={onDeleteAccount} className="btn btn-danger">
          <Skull size={14} /> Delete account & all data
        </button>
      </div>
    </Section>
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card settings-section-card">
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          margin: "0 0 2px",
          color: "var(--text)",
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}>{subtitle}</p>
      {children}
    </div>
  );
}

function Tag({
  label,
  onRemove,
  color = "var(--bg-secondary)",
  textColor = "var(--text)",
}: {
  label: string;
  onRemove: () => void;
  color?: string;
  textColor?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: color,
        color: textColor,
        padding: "3px 8px 3px 10px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        border: "1px solid var(--border)",
      }}
    >
      {label}
      <button
        onClick={onRemove}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          display: "flex",
          padding: 0,
        }}
      >
        <X size={11} />
      </button>
    </span>
  );
}

function TagInput({
  value,
  onChange,
  onAdd,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div className="settings-tag-input">
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
      />
      <button onClick={onAdd} className="btn btn-secondary" style={{ flexShrink: 0 }}>
        <Plus size={13} />
      </button>
    </div>
  );
}
