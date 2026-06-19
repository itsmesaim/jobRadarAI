import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Check, Loader, Plus, X } from "lucide-react";
import toast from "react-hot-toast";
import { cvApi, userApi } from "../api/index";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");

  const { data: cv, isLoading: cvLoading } = useQuery({
    queryKey: ["cv"],
    queryFn: cvApi.get,
    retry: false,
  });

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: userApi.getPreferences,
  });

  const prefsMutation = useMutation({
    mutationFn: userApi.updatePreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      toast.success("Preferences saved");
    },
  });

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

  const updatePrefs = (updates: object) => {
    if (!prefs) return;
    prefsMutation.mutate({ ...prefs, ...updates });
  };

  const removeLocation = (loc: string) => {
    if (!prefs) return;
    updatePrefs({
      preferred_locations: prefs.preferred_locations.filter((l) => l !== loc),
    });
  };

  const addLocation = () => {
    if (!newLocation.trim() || !prefs) return;
    updatePrefs({
      preferred_locations: [...prefs.preferred_locations, newLocation.trim()],
    });
    setNewLocation("");
  };

  const removeSkill = (skill: string) => {
    if (!prefs) return;
    updatePrefs({ key_skills: prefs.key_skills.filter((s) => s !== skill) });
  };

  const addSkill = () => {
    if (!newSkill.trim() || !prefs) return;
    updatePrefs({ key_skills: [...prefs.key_skills, newSkill.trim()] });
    setNewSkill("");
  };

  const removeRole = (role: string) => {
    if (!prefs) return;
    updatePrefs({
      secondary_roles: prefs.secondary_roles.filter((r) => r !== role),
    });
  };

  const addRole = () => {
    if (!newRole.trim() || !prefs) return;
    updatePrefs({
      secondary_roles: [...prefs.secondary_roles, newRole.trim()],
    });
    setNewRole("");
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "24px 16px" }}>
      <h2
        style={{
          fontSize: 17,
          fontWeight: 600,
          margin: "0 0 24px",
          color: "var(--text)",
        }}
      >
        Settings
      </h2>

      {/* CV Section */}
      <Section
        title="CV"
        subtitle="Upload your master CV. Used for job rating and tailoring."
      >
        {cvLoading ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading...</p>
        ) : cv ? (
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
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {cv.structured?.skills?.length} skills ·{" "}
              {cv.structured?.projects?.length} projects ·{" "}
              {cv.structured?.experience?.length} roles extracted
            </div>
          </div>
        ) : (
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: "100%",
                padding: "32px 20px",
                border: "2px dashed var(--border)",
                borderRadius: 10,
                background: "var(--bg-secondary)",
                cursor: "pointer",
                gap: 8,
                transition: "all 0.15s",
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
                    Uploading and parsing...
                  </span>
                </>
              ) : (
                <>
                  <Upload size={20} style={{ color: "var(--text-muted)" }} />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>
                    Click to upload your CV
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    PDF only · Max 5MB
                  </span>
                </>
              )}
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
          style={{ display: "none" }}
          onChange={handleUpload}
        />
      </Section>

      {/* Job preferences */}
      {prefs && (
        <>
          <Section title="Role" subtitle="What roles should we search for?">
            <div style={{ marginBottom: 12 }}>
              <label className="label">Primary role</label>
              <input
                className="input"
                value={prefs.primary_role}
                onChange={(e) => updatePrefs({ primary_role: e.target.value })}
                onBlur={(e) => updatePrefs({ primary_role: e.target.value })}
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
                {prefs.secondary_roles.map((r) => (
                  <Tag key={r} label={r} onRemove={() => removeRole(r)} />
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
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {prefs.preferred_locations.map((l) => (
                <Tag key={l} label={l} onRemove={() => removeLocation(l)} />
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
                Object.keys(prefs.job_types) as (keyof typeof prefs.job_types)[]
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
                    checked={prefs.job_types[key]}
                    onChange={(e) =>
                      updatePrefs({
                        job_types: {
                          ...prefs.job_types,
                          [key]: e.target.checked,
                        },
                      })
                    }
                  />
                  <span
                    style={{
                      color: "var(--text)",
                      textTransform: "capitalize",
                    }}
                  >
                    {key.replace("_", " ")}
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Section
            title="Key skills"
            subtitle="Used to generate personalised search queries from your CV."
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginBottom: 8,
              }}
            >
              {prefs.key_skills.map((s) => (
                <Tag
                  key={s}
                  label={s}
                  onRemove={() => removeSkill(s)}
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
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                €
              </span>
              <input
                className="input"
                type="number"
                value={prefs.min_salary}
                onChange={(e) =>
                  updatePrefs({ min_salary: parseInt(e.target.value) || 0 })
                }
                onBlur={(e) =>
                  updatePrefs({ min_salary: parseInt(e.target.value) || 0 })
                }
                style={{ maxWidth: 140 }}
              />
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                per year
              </span>
            </div>
          </Section>
        </>
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
