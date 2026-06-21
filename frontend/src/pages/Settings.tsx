import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Check, Loader, Plus, X, Save } from "lucide-react";
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
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [dirty, setDirty] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");

  const { data: cv } = useQuery({
    queryKey: ["cv"],
    queryFn: cvApi.get,
    retry: false,
  });

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: userApi.getPreferences,
  });

  // sync server prefs into local state once loaded
  useEffect(() => {
    if (prefs) {
      setLocalPrefs(prefs);
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

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header + Save button */}
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
                setLocalPrefs(prefs ?? DEFAULT_PREFS);
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
