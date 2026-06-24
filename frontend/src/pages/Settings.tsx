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
} from "lucide-react";
import toast from "react-hot-toast";
import { cvApi, userApi } from "../api/index";
import { useAuthStore } from "../hooks/useStores";
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
  },
  min_salary: 0,
  key_skills: [],
  experience_level: "mid",
  work_authorization: "",
  avoid_industries: [],
  work_mode: { remote: true, hybrid: true, onsite: false },
  about_me: "",
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
  const [uploading, setUploading] = useState(false);
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
      setLocalPrefs({ ...DEFAULT_PREFS, ...prefs });
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
    mutationFn: () =>
      userApi.addSkillOverride(
        newOverrideSkill.trim(),
        newOverrideContext.trim(),
      ),
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
    mutationFn: userApi.deleteAccount,
    onSuccess: () => {
      logout();
      window.location.href = "/login";
    },
    onError: () => toast.error("Failed to delete account"),
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
      toast.error(err.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const addLocation = () => {
    if (!newLocation.trim()) return;
    update({
      preferred_locations: [
        ...localPrefs.preferred_locations,
        newLocation.trim(),
      ],
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

  const overrides: { skill: string; context: string }[] =
    overridesData?.overrides ?? [];

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <h2
          style={{
            fontSize: 17,
            fontWeight: 600,
            margin: 0,
            color: "var(--text)",
          }}
        >
          Settings
        </h2>
        {dirty && (
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
        )}
      </div>

      {/* CV Section */}
      <Section
        title="CV"
        subtitle="Upload your master CV. Used for job rating and tailoring."
      >
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
                if (
                  window.confirm(
                    "Delete your CV from JobRadar? You can upload again later.",
                  )
                ) {
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
              {cv.structured?.skills?.length} skills ·{" "}
              {cv.structured?.projects?.length} projects ·{" "}
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
                <Loader
                  size={20}
                  className="animate-spin"
                  style={{ color: "var(--accent)" }}
                />
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  Uploading...
                </span>
              </>
            ) : (
              <>
                <Upload size={20} style={{ color: "var(--text-muted)" }} />
                <span style={{ fontSize: 13, color: "var(--text)" }}>
                  Click to upload your CV
                </span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  PDF · Max 5MB
                </span>
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
            className="input"
            value={localPrefs.primary_role}
            onChange={(e) => update({ primary_role: e.target.value })}
            style={{ maxWidth: 320 }}
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
                    secondary_roles: localPrefs.secondary_roles.filter(
                      (x) => x !== r,
                    ),
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
        <div style={{ display: "flex", gap: 8 }}>
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
                  border: active
                    ? "1.5px solid var(--accent)"
                    : "1px solid var(--border)",
                  background: active
                    ? "var(--accent-light)"
                    : "var(--bg-secondary)",
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
          <Info
            size={13}
            style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
          />
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Be specific — "Stamp 1G, no sponsorship needed" works much better
            than just "Irish work visa."
          </p>
        </div>
      </Section>

      {/* Locations */}
      <Section
        title="Locations"
        subtitle="Every location gets its own separate search. Add as many as you want."
      >
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}
        >
          {localPrefs.preferred_locations.map((l) => (
            <Tag
              key={l}
              label={l}
              onRemove={() =>
                update({
                  preferred_locations: localPrefs.preferred_locations.filter(
                    (x) => x !== l,
                  ),
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
            {LOCATION_EXAMPLES.filter(
              (ex) => !localPrefs.preferred_locations.includes(ex),
            ).map((ex) => (
              <button
                key={ex}
                onClick={() =>
                  update({
                    preferred_locations: [
                      ...localPrefs.preferred_locations,
                      ex,
                    ],
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
            ))}
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
              <span
                style={{ color: "var(--text)", textTransform: "capitalize" }}
              >
                {mode}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {/* Job types */}
      <Section title="Job types" subtitle="What types of roles to include?">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {(
            Object.keys(
              localPrefs.job_types,
            ) as (keyof typeof localPrefs.job_types)[]
          ).map((key) => (
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
              <span
                style={{ color: "var(--text)", textTransform: "capitalize" }}
              >
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
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}
        >
          {localPrefs.avoid_industries.map((ind) => (
            <Tag
              key={ind}
              label={ind}
              onRemove={() =>
                update({
                  avoid_industries: localPrefs.avoid_industries.filter(
                    (x) => x !== ind,
                  ),
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
      <Section
        title="Key skills"
        subtitle="Used to generate personalised search queries."
      >
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}
        >
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
            onChange={(e) =>
              update({ min_salary: parseInt(e.target.value) || 0 })
            }
            style={{ maxWidth: 140 }}
          />
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            per year
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            marginTop: 8,
          }}
        >
          <Info
            size={13}
            style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
          />
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            €40-70k is mid-level in Ireland · ₹20-40 LPA is strong in India ·
            AED 15-25k/mo is good in UAE (tax-free, higher real value than EUR
            equivalent).
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
            <p
              style={{ fontSize: 11.5, color: "var(--text-muted)", margin: 0 }}
            >
              e.g. "plotly" → "used in BEng for ML model visualisation across 3
              projects"
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

      {/* Data & privacy */}
      <DataPrivacySection
        summary={dataSummary}
        onExport={handleExportData}
        onDeleteCv={() => {
          if (
            window.confirm(
              "Delete your CV from JobRadar? You can upload again later.",
            )
          ) {
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
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Delete everything?
              </h3>
            </div>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 14,
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              This permanently deletes your account, CV, preferences, skill
              overrides, and all saved jobs. No undo. No backup. Gone.
            </p>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              Type <strong>DELETE</strong> to confirm
            </p>
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
                  deleteConfirm !== "DELETE" || deleteAccountMutation.isPending
                }
                className="btn btn-danger"
                style={{ flex: 1 }}
              >
                {deleteAccountMutation.isPending
                  ? "Deleting..."
                  : "Yes, delete my account"}
              </button>
              <button
                onClick={() => {
                  setShowDeleteAccount(false);
                  setDeleteConfirm("");
                }}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating save bar */}
      {dirty && (
        <div
          style={{
            position: "sticky",
            bottom: 16,
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            You have unsaved changes
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                setLocalPrefs(
                  prefs ? { ...DEFAULT_PREFS, ...prefs } : DEFAULT_PREFS,
                );
                setDirty(false);
              }}
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
            >
              Discard
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn btn-primary"
              style={{ fontSize: 12 }}
            >
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
      )}
    </div>
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
    <Section
      title="Your data"
      subtitle="What we store, who sees it, and how to nuke it."
    >
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
          <Skull
            size={18}
            style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }}
          />
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
              {summary?.roast ??
                "Yes, we store your data. No, we're not pretending otherwise."}
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
            <DataStat
              label="Skill overrides"
              value={String(summary.skill_overrides_count)}
            />
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
              CV: <strong>{summary.cv.filename}</strong> —{" "}
              {summary.cv.skills_count} skills, {summary.cv.experience_count}{" "}
              roles, {summary.cv.projects_count} projects
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
                    background: item.stored
                      ? "var(--success)"
                      : "var(--border)",
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
        <p
          style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}
        >
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
      <div
        style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}
      >
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
        {value}
      </div>
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
    <div className="card" style={{ padding: 20, marginBottom: 16 }}>
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
      <p
        style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 14px" }}
      >
        {subtitle}
      </p>
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
    <div style={{ display: "flex", gap: 6, maxWidth: 320 }}>
      <input
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onAdd()}
      />
      <button
        onClick={onAdd}
        className="btn btn-secondary"
        style={{ flexShrink: 0 }}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
