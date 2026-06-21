import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Check, Loader, Plus, X, Save, Info } from "lucide-react";
import toast from "react-hot-toast";
import { cvApi, userApi } from "../api/index";
import type { UserPreferences } from "../types";

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

export function SettingsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [dirty, setDirty] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newIndustry, setNewIndustry] = useState("");

  const { data: cv } = useQuery({
    queryKey: ["cv"],
    queryFn: cvApi.get,
    retry: false,
  });

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: userApi.getPreferences,
  });

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

      {/* Experience level — NEW */}
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

      {/* Work authorization — NEW */}
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
            Be specific — this gets passed directly to the rating engine, so
            "Stamp 1G, no sponsorship needed" works much better than just "Irish
            work visa."
          </p>
        </div>
      </Section>

      {/* Locations */}
      <Section
        title="Locations"
        subtitle="Where should we search? Include city + country."
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
      </Section>

      {/* Work mode — NEW, replaces simple remote checkbox */}
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

      {/* Avoid industries — NEW */}
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

      {/* Salary */}
      <Section
        title="Minimum salary"
        subtitle="Jobs below this are flagged (€/year)."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>€</span>
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
      </Section>

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
