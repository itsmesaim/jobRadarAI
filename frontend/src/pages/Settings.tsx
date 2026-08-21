import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
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
  UserCircle,
  SlidersHorizontal,
  Bell,
  KeyRound,
  DatabaseZap,
  Menu,
  ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import { authApi, cvApi, userApi, jobsApi } from "../api/index";
import { useAuthStore } from "../hooks/useStores";
import {
  LimitContactModal,
  parseLimitKindFromDetail,
  type LimitKind,
} from "../components/LimitContactModal";
import { RatingProviderConfirmModal } from "../components/RatingProviderConfirmModal";
import { RequestModelModal } from "../components/RequestModelModal";
import { ClearanceStamp } from "../components/ui/ClearanceStamp";
import { getMissingProfileFields } from "../utils/profileCompleteness";
import type { AiModelCatalogEntry, DataSummary, ModelPurpose, UserPreferences } from "../types";

const CV_UPLOAD_MESSAGES = [
  "Uploading your CV...",
  "Parsing with AI...",
  "Extracting skills, projects, and experience...",
  "Almost done...",
];

const DEFAULT_PREFS: UserPreferences = {
  preferred_locations: [],
  primary_role: "",
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
  nationality: "",
  visa_status: "",
  work_authorization: "",
  avoid_industries: [],
  work_mode: { remote: true, hybrid: true, onsite: false },
  about_me: "",
  about_me_from_cv: "",
  showcase_projects: [],
  email_reminders_enabled: true,
  reminder_hours: [],
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  rating_provider: "",
  rating_model: "",
  apply_pack_provider: "",
  apply_pack_model: "",
  cv_parsing_provider: "",
  cv_parsing_model: "",
  calibration_notes: "",
  calibration_notes_updated_at: null,
  calibration_notes_source_count: 0,
};

const DEFAULT_MODEL_VALUE = "__default__";

// tsconfig targets ES2020, which predates Intl.supportedValuesOf's types.
const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
  .supportedValuesOf;
const TIMEZONE_OPTIONS: string[] = supportedValuesOf
  ? supportedValuesOf("timeZone")
  : [DEFAULT_PREFS.timezone];

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

const REMINDER_HOUR_OPTIONS: { hour: number; label: string }[] = [
  { hour: 6, label: "6am" },
  { hour: 9, label: "9am" },
  { hour: 12, label: "12pm" },
  { hour: 14, label: "2pm" },
  { hour: 17, label: "5pm" },
  { hour: 19, label: "7pm" },
  { hour: 21, label: "9pm" },
];
const DEFAULT_REMINDER_HOURS_LABEL = "9am, 2pm, 7pm";

const LOCATION_EXAMPLES = [
  "Dublin Ireland",
  "Remote",
  "Bangalore India",
  "Dubai UAE",
  "London UK",
  "Berlin Germany",
];

const SETTINGS_GROUPS: {
  id: string;
  icon: React.ElementType;
  label: string;
}[] = [
  { id: "profile", icon: UserCircle, label: "Profile & CV" },
  { id: "ai-models", icon: Brain, label: "AI models" },
  { id: "preferences", icon: SlidersHorizontal, label: "Job search" },
  { id: "notifications", icon: Bell, label: "Notifications" },
  { id: "account", icon: KeyRound, label: "Account" },
  { id: "data", icon: DatabaseZap, label: "Data & privacy" },
];

const AUTOFILL_LABELS: Record<string, string> = {
  primary_role: "your role",
  preferred_locations: "location",
  key_skills: "key skills",
  about_me_from_cv: "CV summary",
};

function SettingsSidebar({
  activeGroup,
  onSelect,
  complete,
  mobileOpen,
}: {
  activeGroup: string;
  onSelect: (id: string) => void;
  complete: Record<string, boolean | null>;
  mobileOpen: boolean;
}) {
  return (
    <nav
      className={`settings-sidebar${mobileOpen ? " settings-sidebar-open" : ""}`}
      aria-label="Settings sections"
    >
      {SETTINGS_GROUPS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={`settings-sidebar-link${activeGroup === id ? " settings-sidebar-link-active" : ""}`}
          aria-current={activeGroup === id ? "page" : undefined}
        >
          <span>
            <Icon size={14} />
            {label}
          </span>
          {complete[id] != null && <ClearanceStamp complete={!!complete[id]} />}
        </button>
      ))}
    </nav>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadMsgIdx, setUploadMsgIdx] = useState(0);
  const [limitModalKind, setLimitModalKind] = useState<LimitKind | null>(null);
  const [pwForm, setPwForm] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [localPrefs, setLocalPrefs] = useState<UserPreferences>(DEFAULT_PREFS);
  const [dirty, setDirty] = useState(false);
  const [activeGroup, setActiveGroup] = useState(SETTINGS_GROUPS[0].id);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [newShowcase, setNewShowcase] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newIndustry, setNewIndustry] = useState("");
  const [salaryCurrency, setSalaryCurrency] = useState("EUR");
  // Raw text for the salary field so it can be genuinely emptied while
  // typing, binding straight to a number forces it back to "0" on every
  // keystroke once cleared, making it impossible to type a fresh value.
  const [minSalaryInput, setMinSalaryInput] = useState<string>(String(DEFAULT_PREFS.min_salary));
  const [newOverrideSkill, setNewOverrideSkill] = useState("");
  const [newOverrideContext, setNewOverrideContext] = useState("");
  const [addingOverride, setAddingOverride] = useState(false);
  const [autofilledFields, setAutofilledFields] = useState<string[] | null>(null);

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

  // Cycle the fun status line while a CV upload/parse is in flight, so the
  // page doesn't sit silently for the several seconds the LLM call takes.
  useEffect(() => {
    if (!uploading) {
      setUploadMsgIdx(0);
      return;
    }
    const id = setInterval(() => {
      setUploadMsgIdx((i) => Math.min(i + 1, CV_UPLOAD_MESSAGES.length - 1));
    }, 1600);
    return () => clearInterval(id);
  }, [uploading]);

  // sync server prefs into local state once loaded
  useEffect(() => {
    if (prefs) {
      setLocalPrefs({
        ...DEFAULT_PREFS,
        ...prefs,
        job_types: { ...DEFAULT_PREFS.job_types, ...(prefs.job_types || {}) },
        work_mode: { ...DEFAULT_PREFS.work_mode, ...(prefs.work_mode || {}) },
      });
      setMinSalaryInput(String(prefs.min_salary ?? DEFAULT_PREFS.min_salary));
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
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!["pdf", "docx", "odt", "txt", "tex"].includes(extension)) {
      toast.error("Only PDF, Word (.docx), OpenDocument (.odt), .txt, or .tex files are accepted");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Max 5MB");
      return;
    }
    setUploading(true);
    try {
      const { autofilled_fields, structured } = await cvApi.upload(file);
      queryClient.invalidateQueries({ queryKey: ["cv"] });
      if (autofilled_fields?.length) {
        queryClient.invalidateQueries({ queryKey: ["prefs"] });
        setAutofilledFields(autofilled_fields);
      }
      toast.success("CV uploaded and parsed");
      for (const warning of structured?.parse_warnings ?? []) {
        toast(warning, { icon: "⚠️", duration: 8000 });
      }
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

  const addShowcase = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (localPrefs.showcase_projects.includes(n)) return;
    if (localPrefs.showcase_projects.length >= 12) return;
    update({ showcase_projects: [...localPrefs.showcase_projects, n] });
    setNewShowcase("");
  };

  const toggleShowcase = (name: string) => {
    if (localPrefs.showcase_projects.includes(name)) {
      update({
        showcase_projects: localPrefs.showcase_projects.filter((x) => x !== name),
      });
      return;
    }
    addShowcase(name);
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

  // Only "profile" (CV) and "preferences" (role/location/experience/nationality/
  // visa) map to fields that are actually required elsewhere (search gating),
  // the other tabs have no equivalent "required" concept, so no stamp for them.
  const missingFields = getMissingProfileFields(cv, localPrefs);
  const TOTAL_REQUIRED_FIELDS = 6;
  const sectionComplete: Record<string, boolean | null> = {
    profile: !missingFields.some((f) => f.group === "profile"),
    "ai-models": null,
    preferences: !missingFields.some((f) => f.group === "preferences"),
    notifications: null,
    account: null,
    data: null,
  };

  return (
    <div className={`settings-page${dirty ? " has-unsaved" : ""}`}>
      <div className="settings-header">
        <h2 className="settings-title text-display">Settings</h2>
        {dirty && <span className="settings-unsaved-pill">Unsaved changes</span>}
      </div>

      {/* Always visible regardless of active tab, so missing fields on other
          tabs are obvious without clicking into each one to check. */}
      <div className="settings-completeness-bar">
        {missingFields.length === 0 ? (
          <span className="settings-completeness-complete">
            <ClearanceStamp complete /> Profile complete
          </span>
        ) : (
          <>
            <span className="settings-completeness-label">
              {TOTAL_REQUIRED_FIELDS - missingFields.length} of {TOTAL_REQUIRED_FIELDS} required
              fields set
            </span>
            <div className="settings-completeness-chips">
              {missingFields.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className="settings-completeness-chip"
                  onClick={() => setActiveGroup(f.group)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        className="settings-mobile-nav-toggle"
        onClick={() => setMobileNavOpen((v) => !v)}
        aria-expanded={mobileNavOpen}
      >
        <span>
          <Menu size={16} />
          {SETTINGS_GROUPS.find((g) => g.id === activeGroup)?.label}
        </span>
        <ChevronDown
          size={16}
          style={{
            transition: "transform 0.15s",
            transform: mobileNavOpen ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      <SettingsSidebar
        activeGroup={activeGroup}
        onSelect={(id) => {
          setActiveGroup(id);
          setMobileNavOpen(false);
        }}
        complete={sectionComplete}
        mobileOpen={mobileNavOpen}
      />

      <div className="settings-content">
        {activeGroup === "profile" && (
          <SectionGroup id="profile" icon={UserCircle} label="Profile & CV">
            <AiModelPicker
              purpose="cv_parsing"
              title="CV parsing model"
              subtitle="Which AI turns your uploaded CV into structured data."
              providerField="cv_parsing_provider"
              modelField="cv_parsing_model"
              requestField="cv_parsing_model_request"
              localPrefs={localPrefs}
              setLocalPrefs={setLocalPrefs}
            />
            {/* CV Section */}
            <Section
              title="CV"
              subtitle="Upload your master CV. Used for job rating and tailoring."
            >
              {uploading ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    width: "100%",
                    padding: "16px 20px",
                    border: "2px dashed var(--accent)",
                    borderRadius: "var(--radius)",
                    background: "var(--bg-secondary)",
                  }}
                >
                  <Loader size={20} className="animate-spin" style={{ color: "var(--accent)" }} />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>
                    {cv ? "Replacing your CV: " : ""}
                    {CV_UPLOAD_MESSAGES[uploadMsgIdx]}
                  </span>
                </div>
              ) : cv ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      background: "var(--success-bg)",
                      border: "1px solid var(--success)",
                      borderRadius: "var(--radius-sm)",
                      padding: "8px 14px",
                    }}
                  >
                    <Check size={14} style={{ color: "var(--success)" }} />
                    <span
                      style={{
                        fontSize: "var(--text-sm)",
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
                    style={{ fontSize: "var(--text-xs)" }}
                  >
                    <Upload size={13} /> Replace
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm("Delete your CV from JobRadar? You can upload again later.")
                      ) {
                        deleteCvMutation.mutate();
                      }
                    }}
                    disabled={deleteCvMutation.isPending}
                    className="btn btn-ghost"
                    style={{ fontSize: "var(--text-xs)", color: "var(--danger)" }}
                  >
                    <Trash2 size={13} /> Delete CV
                  </button>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    {cv.structured?.skills?.length} skills · {cv.structured?.projects?.length}{" "}
                    projects · {cv.structured?.experience?.length} roles
                    {cv.structured?.parsed_by_model && (
                      <> · parsed by {cv.structured.parsed_by_model}</>
                    )}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: "100%",
                    padding: "32px 20px",
                    border: "2px dashed var(--border)",
                    borderRadius: "var(--radius)",
                    background: "var(--bg-secondary)",
                    cursor: "pointer",
                    gap: "var(--space-2)",
                  }}
                >
                  <Upload size={20} style={{ color: "var(--text-muted)" }} />
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text)" }}>
                    Click to upload your CV
                  </span>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                    PDF, Word, ODT, TXT, or TeX · Max 5MB
                  </span>
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.odt,.txt,.tex"
                style={{ display: "none" }}
                onChange={handleUpload}
              />
            </Section>

            {autofilledFields && (
              <div className="settings-autofill-banner">
                <span>
                  We filled in {autofilledFields.map((f) => AUTOFILL_LABELS[f] || f).join(", ")}{" "}
                  from your CV, below and on the <strong>Job search</strong> tab. Review and adjust
                  before saving.
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAutofilledFields(null)}
                >
                  Dismiss
                </button>
              </div>
            )}

            <Section
              title="Flagship work"
              subtitle="Click in the order you want them on the tailored CV. 1 is first. Click again to drop it. Save after you pick."
            >
              <div className="settings-pick-why">
                <p>
                  <strong>Why this exists.</strong> Your CV has many projects and jobs. The AI does
                  not know which ones you want to be known for. Click in order (1, 2, 3). Click
                  again to remove. Save when done.
                </p>
                <ul>
                  <li>
                    <strong>For rating:</strong> scores and tailoring tips weight these first. A job
                    that matches your flagship work ranks higher than one that only matches a side
                    project.
                  </li>
                  <li>
                    <strong>For the tailored CV and letter:</strong> Key Projects and the cover
                    letter lead with #1, then #2, then #3. Without this, the model often puts a
                    school or keyword-match project on top.
                  </li>
                </ul>
              </div>
              {!cv?.structured ? (
                <p className="settings-pick-empty">
                  Upload a CV above and we will list your projects and jobs here.
                </p>
              ) : (
                <>
                  {(cv.structured.projects || []).length > 0 && (
                    <div className="settings-pick-group">
                      <p className="settings-pick-heading">Projects on your CV</p>
                      <ul className="settings-pick-list">
                        {(cv.structured.projects || []).map((p) => {
                          const name = (p.name || "").trim();
                          if (!name) return null;
                          const order = localPrefs.showcase_projects.indexOf(name);
                          const meta = [p.description, (p.tech || []).slice(0, 4).join(", ")]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <li key={name}>
                              <ShowcaseRow
                                name={name}
                                meta={meta}
                                order={order}
                                onToggle={() => toggleShowcase(name)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {(cv.structured.experience || []).length > 0 && (
                    <div className="settings-pick-group">
                      <p className="settings-pick-heading">Jobs on your CV</p>
                      <ul className="settings-pick-list">
                        {(cv.structured.experience || []).map((e, i) => {
                          const name = [e.title, e.company].filter(Boolean).join(" @ ");
                          if (!name) return null;
                          const order = localPrefs.showcase_projects.indexOf(name);
                          const meta = [e.start, e.end].filter(Boolean).join(" - ");
                          return (
                            <li key={`${name}-${i}`}>
                              <ShowcaseRow
                                name={name}
                                meta={meta}
                                order={order}
                                onToggle={() => toggleShowcase(name)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {!cv.structured.projects?.length && !cv.structured.experience?.length && (
                    <p className="settings-pick-empty">
                      This CV did not parse any projects or jobs. Type a name below, or re-upload.
                    </p>
                  )}
                </>
              )}
              {localPrefs.showcase_projects.length > 0 && (
                <ol className="settings-pick-order">
                  {localPrefs.showcase_projects.map((p, i) => (
                    <li key={p}>
                      {i + 1}. {p}
                    </li>
                  ))}
                </ol>
              )}
              <TagInput
                value={newShowcase}
                onChange={setNewShowcase}
                onAdd={() => addShowcase(newShowcase)}
                placeholder="Not on the list? Type it and press Enter"
              />
            </Section>

            <Section
              title="Your notes"
              subtitle="What you want the rater to know that is not obvious from the CV. Re-uploading a CV never overwrites this."
            >
              <textarea
                className="input"
                placeholder="e.g. Looking to move from backend into AI engineering. Built production LangChain apps but PyTorch isn't on my CV, comfortable learning on the job. Not interested in pure enterprise Java roles."
                value={localPrefs.about_me}
                onChange={(e) => update({ about_me: e.target.value })}
                rows={6}
                style={{ resize: "vertical", lineHeight: 1.6 }}
              />
            </Section>
            <Section
              title="From your CV"
              subtitle="Parsed from the latest upload. Updates when you re-upload. Used for rating alongside your notes."
            >
              <textarea
                className="input"
                placeholder="Upload a CV and the professional summary lands here."
                value={localPrefs.about_me_from_cv}
                onChange={(e) => update({ about_me_from_cv: e.target.value })}
                rows={5}
                style={{ resize: "vertical", lineHeight: 1.6 }}
              />
            </Section>
          </SectionGroup>
        )}

        {activeGroup === "ai-models" && (
          <SectionGroup id="ai-models" icon={Brain} label="AI models">
            <p className="settings-pick-why">
              Split by job so you can cut cost. Rating hits hundreds of listings. Apply pack runs a
              few times a day. CV parse runs once per upload. Pick from the list. Switching one
              purpose does not change the others.
            </p>
            <AiModelPicker
              purpose="rating"
              title="Rating model"
              subtitle="Scores crawled jobs. Hundreds of calls. Prefer a cheap or local model."
              providerField="rating_provider"
              modelField="rating_model"
              requestField="rating_model_request"
              localPrefs={localPrefs}
              setLocalPrefs={setLocalPrefs}
            />
            <AiModelPicker
              purpose="apply_pack"
              title="Apply pack / tailored CV"
              subtitle="Writes the tailored CV and cover letter. A few calls. A stronger model is fine here."
              providerField="apply_pack_provider"
              modelField="apply_pack_model"
              requestField="apply_pack_model_request"
              localPrefs={localPrefs}
              setLocalPrefs={setLocalPrefs}
            />
            <CalibrationNotesSection localPrefs={localPrefs} setLocalPrefs={setLocalPrefs} />
          </SectionGroup>
        )}

        {activeGroup === "preferences" && (
          <SectionGroup id="preferences" icon={SlidersHorizontal} label="Job search preferences">
            {/* Role */}
            <Section title="Role" subtitle="What roles should we search for?">
              <div style={{ marginBottom: "var(--space-3)" }}>
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
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-2)",
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
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                        border: active ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                        background: active ? "var(--accent-light)" : "var(--bg-secondary)",
                        textAlign: "left",
                        transition: "all 0.15s",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "var(--text-sm)",
                          fontWeight: 600,
                          color: active ? "var(--accent)" : "var(--text)",
                        }}
                      >
                        {lvl.label}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--text-xs)",
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

            {/* Nationality + visa status */}
            <Section
              title="Nationality & visa status"
              subtitle="Lets the rating engine reason about whether you can legally work in a job's country, and auto-reject listings that need sponsorship you don't have."
            >
              <div style={{ marginBottom: "var(--space-3)" }}>
                <label className="label">Nationality</label>
                <input
                  className="input"
                  placeholder="e.g. Indian"
                  value={localPrefs.nationality}
                  onChange={(e) => update({ nationality: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Visa / permit status</label>
                <input
                  className="input"
                  placeholder="e.g. H-1B, Skilled Worker visa, Stamp 1G, PR, name yours + what it allows"
                  value={localPrefs.visa_status}
                  onChange={(e) => update({ visa_status: e.target.value })}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  marginTop: "var(--space-2)",
                }}
              >
                <Info
                  size={13}
                  style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
                />
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  Name the actual permit and what it currently allows, "EU citizen, no restrictions"
                  or "H-1B, transfer required" are both more useful than just naming a country.
                </p>
              </div>
            </Section>

            {/* Work authorization */}
            <Section
              title="Visa exceptions & timing"
              subtitle="Only for legal nuances your visa status above can't capture by itself, not a place to repeat it."
            >
              <input
                className="input"
                placeholder="e.g. Stamp 1G expires March 2027, need renewal before start date"
                value={localPrefs.work_authorization}
                onChange={(e) => update({ work_authorization: e.target.value })}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  marginTop: "var(--space-2)",
                }}
              >
                <Info
                  size={13}
                  style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
                />
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  Most people leave this blank. Use it only for something with an expiry date or a
                  contract-type restriction (e.g. "full-time only, can't contract") that your visa
                  status above doesn't already say.
                </p>
              </div>
            </Section>

            {/* Locations */}
            <Section
              title="Locations"
              subtitle="Every location gets its own separate search. Add as many as you want."
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                  marginBottom: "var(--space-2)",
                }}
              >
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
              <div style={{ marginTop: "var(--space-3)" }}>
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    margin: "0 0 6px",
                  }}
                >
                  Quick add:
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)" }}>
                  {LOCATION_EXAMPLES.filter(
                    (ex) => !localPrefs.preferred_locations.includes(ex),
                  ).map((ex) => (
                    <button
                      key={ex}
                      onClick={() =>
                        update({
                          preferred_locations: [...localPrefs.preferred_locations, ex],
                        })
                      }
                      style={{
                        fontSize: "var(--text-xs)",
                        padding: "3px 9px",
                        borderRadius: "var(--radius-pill)",
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
              <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
                {(["remote", "hybrid", "onsite"] as const).map((mode) => (
                  <label
                    key={mode}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      cursor: "pointer",
                      fontSize: "var(--text-sm)",
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
                    <span style={{ color: "var(--text)", textTransform: "capitalize" }}>
                      {mode}
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            {/* Job types */}
            <Section title="Job types" subtitle="What types of roles to include?">
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                {(Object.keys(localPrefs.job_types) as (keyof typeof localPrefs.job_types)[])
                  .filter((key) => key !== "remote")
                  .map((key) => (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                        cursor: "pointer",
                        fontSize: "var(--text-sm)",
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
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                  marginBottom: "var(--space-2)",
                }}
              >
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
            <Section
              title="Key skills"
              subtitle="Search queries only, keep this to about 8 short names (Python, FastAPI, React). The full skill list on your CV is already used for rating. Re-upload replaces a huge dump with a short list."
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                  marginBottom: "var(--space-2)",
                }}
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
                  gap: "var(--space-3)",
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
                  value={minSalaryInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setMinSalaryInput(raw);
                    if (raw !== "") update({ min_salary: parseInt(raw, 10) || 0 });
                  }}
                  onBlur={() => {
                    if (minSalaryInput === "") {
                      setMinSalaryInput("0");
                      update({ min_salary: 0 });
                    }
                  }}
                  style={{ maxWidth: 140 }}
                />
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                  per year
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-2)",
                  marginTop: "var(--space-2)",
                }}
              >
                <Info
                  size={13}
                  style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }}
                />
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--text-muted)",
                    margin: 0,
                    lineHeight: 1.5,
                  }}
                >
                  €40-70k is mid-level in Ireland · ₹20-40 LPA is strong in India · AED 15-25k/mo is
                  good in UAE (tax-free, higher real value than EUR equivalent).
                </p>
              </div>
            </Section>

            {/* Skill overrides */}
            <Section
              title="Skill overrides"
              subtitle="Skills you have that aren't on your CV. Injected into every rating call so the LLM stops flagging them as gaps."
            >
              {overrides.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  {overrides.map((o) => (
                    <div
                      key={o.skill}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "var(--space-3)",
                        background: "var(--purple-bg)",
                        borderRadius: "var(--radius-sm)",
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
                            fontSize: "var(--text-xs)",
                            fontWeight: 600,
                            color: "var(--purple)",
                            marginBottom: 2,
                          }}
                        >
                          {o.skill}
                        </div>
                        <div
                          style={{
                            fontSize: "var(--text-xs)",
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
                  style={{ fontSize: "var(--text-xs)" }}
                >
                  <Plus size={13} /> Add skill override
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
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
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: 0 }}>
                    e.g. "plotly" → "used in BEng for ML model visualisation across 3 projects"
                  </p>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button
                      onClick={() => addOverrideMutation.mutate()}
                      disabled={
                        !newOverrideSkill.trim() ||
                        !newOverrideContext.trim() ||
                        addOverrideMutation.isPending
                      }
                      className="btn btn-primary"
                      style={{ fontSize: "var(--text-xs)" }}
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
                      style={{ fontSize: "var(--text-xs)" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Section>
          </SectionGroup>
        )}

        {activeGroup === "notifications" && (
          <SectionGroup id="notifications" icon={Bell} label="Notifications">
            {/* Email reminders */}
            <Section
              title="Email reminders"
              subtitle="Get up to 3 emails per day when you have unapplied jobs scoring 8+/10, same nudge as the dashboard banner."
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  cursor: "pointer",
                  padding: "12px 14px",
                  borderRadius: "var(--radius-sm)",
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
                      gap: "var(--space-2)",
                      fontSize: "var(--text-base)",
                      fontWeight: 600,
                      color: "var(--text)",
                      marginBottom: "var(--space-1)",
                    }}
                  >
                    <Mail size={15} />
                    Remind me to apply to high-scoring jobs
                  </span>
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      color: "var(--text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    Requires SMTP on the server. Lists your top matches with scores and links.
                    Disable anytime here.
                  </span>
                </span>
              </label>

              {localPrefs.email_reminders_enabled && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <label className="label">When should we remind you?</label>
                  <p
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--text-muted)",
                      margin: "0 0 var(--space-2)",
                    }}
                  >
                    Pick any times that work for you, in your own timezone (below). Leave none
                    picked to use the app default ({DEFAULT_REMINDER_HOURS_LABEL}). Max 3 emails/day
                    either way.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
                    {REMINDER_HOUR_OPTIONS.map((opt) => {
                      const active = localPrefs.reminder_hours.includes(opt.hour);
                      return (
                        <button
                          key={opt.hour}
                          type="button"
                          onClick={() =>
                            update({
                              reminder_hours: active
                                ? localPrefs.reminder_hours.filter((h) => h !== opt.hour)
                                : [...localPrefs.reminder_hours, opt.hour].sort((a, b) => a - b),
                            })
                          }
                          style={{
                            padding: "6px 14px",
                            borderRadius: "var(--radius-pill)",
                            border: active
                              ? "1.5px solid var(--accent)"
                              : "1px solid var(--border)",
                            background: active ? "var(--accent-light)" : "var(--bg-secondary)",
                            color: active ? "var(--accent)" : "var(--text-secondary)",
                            fontSize: "var(--text-sm)",
                            fontWeight: active ? 600 : 400,
                            cursor: "pointer",
                            transition: "all 0.15s",
                          }}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Section>

            {/* Timezone */}
            <Section
              title="Timezone"
              subtitle="Auto job search (5am/5pm) runs at these times, and reminder emails run at whatever times you've picked above (or the app default), all in your local timezone."
            >
              <label className="label">Where are you currently based?</label>
              <select
                className="input settings-field-narrow"
                value={localPrefs.timezone}
                onChange={(e) => update({ timezone: e.target.value })}
              >
                {!TIMEZONE_OPTIONS.includes(localPrefs.timezone) && (
                  <option value={localPrefs.timezone}>{localPrefs.timezone}</option>
                )}
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Section>
          </SectionGroup>
        )}

        {activeGroup === "account" && (
          <SectionGroup id="account" icon={KeyRound} label="Account & security">
            <Section title="Password" subtitle="Change your sign-in password">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
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
                <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  Forgot your password?{" "}
                  <a href="/forgot-password" style={{ color: "var(--accent)" }}>
                    Reset via email
                  </a>
                </p>
              </div>
            </Section>
          </SectionGroup>
        )}

        {activeGroup === "data" && (
          <SectionGroup id="data" icon={DatabaseZap} label="Data & privacy">
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
          </SectionGroup>
        )}
      </div>

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
            padding: "var(--space-4)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{
              maxWidth: 420,
              width: "100%",
              padding: "var(--space-6)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-3)",
                marginBottom: "var(--space-4)",
              }}
            >
              <Skull size={22} style={{ color: "var(--danger)" }} />
              <h3 style={{ margin: 0, fontSize: "var(--text-xl)", fontWeight: 600 }}>
                Delete everything?
              </h3>
            </div>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: "var(--text-base)",
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
                fontSize: "var(--text-xs)",
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
              style={{ marginBottom: "var(--space-3)" }}
            />
            <input
              className="input"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              style={{ marginBottom: "var(--space-4)" }}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
            <button
              onClick={discardChanges}
              className="btn btn-ghost"
              style={{ fontSize: "var(--text-sm)" }}
            >
              Discard
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="btn btn-primary"
              style={{ fontSize: "var(--text-sm)" }}
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

// ── AI model picker (rating + CV parsing share this) ─────────────────────────

function AiModelPicker({
  purpose,
  title,
  subtitle,
  providerField,
  modelField,
  requestField,
  localPrefs,
  setLocalPrefs,
}: {
  purpose: ModelPurpose;
  title: string;
  subtitle: string;
  providerField: "rating_provider" | "apply_pack_provider" | "cv_parsing_provider";
  modelField: "rating_model" | "apply_pack_model" | "cv_parsing_model";
  requestField: "rating_model_request" | "apply_pack_model_request" | "cv_parsing_model_request";
  localPrefs: UserPreferences;
  setLocalPrefs: React.Dispatch<React.SetStateAction<UserPreferences>>;
}) {
  const queryClient = useQueryClient();
  const [pendingSelection, setPendingSelection] = useState<{
    provider: string;
    model: string;
    label: string;
  } | null>(null);
  const [showRequestModel, setShowRequestModel] = useState(false);

  const { data } = useQuery({
    queryKey: ["ai-models", purpose],
    queryFn: () => userApi.getAiModels(purpose),
  });
  const models: AiModelCatalogEntry[] = data?.models || [];
  const providers = Array.from(new Set(models.map((m) => m.provider)));
  const defaultModel = models.find((m) => m.is_default);
  const defaultLabel = defaultModel ? `App default (${defaultModel.label})` : "App default";

  const currentProvider = localPrefs[providerField];
  const currentModel = localPrefs[modelField];
  const requestInfo = localPrefs[requestField];
  const isCustomSelection =
    !!currentProvider &&
    !models.some((m) => m.provider === currentProvider && m.model === currentModel);

  const switchMutation = useMutation({
    mutationFn: (next: { provider: string; model: string; label: string }) =>
      userApi.updatePreferences({
        ...localPrefs,
        [providerField]: next.provider,
        [modelField]: next.model,
      }),
    onSuccess: (_data, next) => {
      setLocalPrefs((p) => ({ ...p, [providerField]: next.provider, [modelField]: next.model }));
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      toast.success(`${title} switched to ${next.label}`);
      setPendingSelection(null);
    },
    onError: () => toast.error(`Failed to switch ${title.toLowerCase()}`),
  });

  const requestMutation = useMutation({
    mutationFn: ({ model, note }: { model: string; note: string }) =>
      userApi.requestModel(model, note, purpose),
    onSuccess: (_data, { model, note }) => {
      setLocalPrefs((p) => ({
        ...p,
        [requestField]: { model, note, requested_at: new Date().toISOString() },
      }));
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      toast.success("Request sent, we'll email you when it's ready");
      setShowRequestModel(false);
    },
    onError: () => toast.error("Failed to send request"),
  });

  const handleSelect = (value: string) => {
    const next =
      value === DEFAULT_MODEL_VALUE
        ? { provider: "", model: "", label: defaultLabel }
        : (() => {
            const [provider, model] = value.split("::");
            const entry = models.find((m) => m.provider === provider && m.model === model);
            return { provider, model, label: entry?.label || model };
          })();

    if (next.provider === currentProvider) {
      switchMutation.mutate(next);
    } else {
      setPendingSelection(next);
    }
  };

  return (
    <Section title={title} subtitle={subtitle}>
      {isCustomSelection && (
        <div
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-secondary)",
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            marginBottom: "var(--space-3)",
          }}
        >
          Currently on{" "}
          <strong>
            {currentProvider}/{currentModel}
          </strong>
          , a custom model admin granted you. Pick anything below to switch off it.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <div>
          <div className="settings-eyebrow">Default</div>
          <div className="settings-exp-levels">
            <ModelPill
              active={!currentProvider}
              label={defaultLabel}
              hint="App's recommended choice"
              onClick={() => handleSelect(DEFAULT_MODEL_VALUE)}
            />
          </div>
        </div>

        {providers.map((provider) => {
          const providerModels = models.filter((m) => m.provider === provider);
          return (
            <div key={provider}>
              <div className="settings-eyebrow">
                {provider}: {providerModels.length} model{providerModels.length === 1 ? "" : "s"}{" "}
                available
              </div>
              <div className="settings-exp-levels">
                {providerModels.map((m) => (
                  <ModelPill
                    key={m.id}
                    active={currentProvider === m.provider && currentModel === m.model}
                    label={m.label}
                    hint={
                      m.cost_multiplier > 1
                        ? `uses ${m.cost_multiplier}x quota`
                        : "standard quota use"
                    }
                    onClick={() => handleSelect(`${m.provider}::${m.model}`)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "var(--space-3)" }}>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowRequestModel(true)}
          disabled={!!requestInfo}
        >
          {requestInfo ? "Request pending" : "Request a different model"}
        </button>
        {requestInfo && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 4 }}>
            "{requestInfo.model}": we'll email you when it's ready
          </div>
        )}
      </div>

      {pendingSelection !== null && (
        <RatingProviderConfirmModal
          label={pendingSelection.label}
          busy={switchMutation.isPending}
          onConfirm={() => switchMutation.mutate(pendingSelection)}
          onCancel={() => setPendingSelection(null)}
        />
      )}

      {showRequestModel && (
        <RequestModelModal
          busy={requestMutation.isPending}
          onSubmit={(model, note) => requestMutation.mutate({ model, note })}
          onCancel={() => setShowRequestModel(false)}
        />
      )}
    </Section>
  );
}

function CalibrationNotesSection({
  localPrefs,
  setLocalPrefs,
}: {
  localPrefs: UserPreferences;
  setLocalPrefs: React.Dispatch<React.SetStateAction<UserPreferences>>;
}) {
  const regenerateMutation = useMutation({
    mutationFn: userApi.regenerateCalibrationNotes,
    onSuccess: ({ calibration_notes }) => {
      setLocalPrefs((p) => ({
        ...p,
        calibration_notes,
        calibration_notes_updated_at: new Date().toISOString(),
      }));
      toast.success("Calibration notes refreshed");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Failed to refresh, try again");
    },
  });

  return (
    <Section
      title="Rating calibration"
      subtitle="Standing rules distilled from your rating feedback (comments/stars on individual ratings), applied to EVERY future rating, not just similar jobs."
    >
      {localPrefs.calibration_notes ? (
        <>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: "var(--text-sm)",
              lineHeight: 1.6,
              color: "var(--text)",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 14px",
              margin: "0 0 var(--space-2)",
            }}
          >
            {localPrefs.calibration_notes}
          </pre>
          {(localPrefs.calibration_notes_source_count > 0 ||
            localPrefs.calibration_notes_updated_at) && (
            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--text-muted)",
                margin: "0 0 var(--space-3)",
              }}
            >
              {localPrefs.calibration_notes_source_count > 0 && (
                <>
                  Based on {localPrefs.calibration_notes_source_count} feedback entr
                  {localPrefs.calibration_notes_source_count === 1 ? "y" : "ies"}
                </>
              )}
              {localPrefs.calibration_notes_updated_at &&
                `${localPrefs.calibration_notes_source_count > 0 ? " · " : ""}updated ${new Date(localPrefs.calibration_notes_updated_at).toLocaleDateString()}`}
            </p>
          )}
        </>
      ) : (
        <p
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            margin: "0 0 var(--space-3)",
          }}
        >
          No standing rules yet. Leave feedback (stars or a comment) on at least 3 job ratings and
          they'll be summarized here automatically, or click refresh below if you've already left
          feedback.
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => regenerateMutation.mutate()}
        disabled={regenerateMutation.isPending}
      >
        {regenerateMutation.isPending ? "Refreshing..." : "Refresh now"}
      </button>
    </Section>
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
  const [olderThanDays, setOlderThanDays] = useState<number | "">(30);
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
    older_than_days: filterType === "old" ? olderThanDays || 1 : undefined,
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
      toast.error("Preview failed, try again");
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
          gap: "var(--space-3)",
          padding: "10px 14px",
          borderRadius: "var(--radius-sm)",
          background: "var(--warning-bg)",
          border: "1px solid var(--warning-border)",
          marginBottom: "var(--space-4)",
        }}
      >
        <AlertTriangle size={14} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
        <p
          style={{
            margin: 0,
            fontSize: "var(--text-xs)",
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
          gap: "var(--space-2)",
          marginBottom: "var(--space-4)",
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
                borderRadius: "var(--radius)",
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
                  marginBottom: "var(--space-2)",
                }}
              >
                {opt.icon}
              </div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  fontWeight: 600,
                  color: active ? "var(--accent)" : "var(--text)",
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

      {/* Config for selected filter */}
      {filterType === "old" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-4)",
          }}
        >
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
            Older than
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
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>days</span>
        </div>
      )}

      {filterType === "by_status" && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
            }}
          >
            Include these stages:
          </p>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
                    borderRadius: "var(--radius-pill)",
                    border: checked ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                    background: checked ? "var(--accent-light)" : "var(--bg-secondary)",
                    color: checked ? "var(--accent)" : "var(--text-secondary)",
                    fontSize: "var(--text-xs)",
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
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={handlePreview}
          disabled={loading}
          className="btn btn-secondary"
          style={{ fontSize: "var(--text-sm)" }}
        >
          {loading && preview === null ? "Checking..." : "Preview count"}
        </button>

        {preview !== null && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              background: preview > 0 ? "var(--warning-bg)" : "var(--success-bg)",
              border: `1px solid ${preview > 0 ? "var(--warning-border)" : "var(--success-border)"}`,
              fontSize: "var(--text-sm)",
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
              marginBottom: "var(--space-3)",
              transition: "all 0.15s",
            }}
          >
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 3, accentColor: "var(--danger)" }}
            />
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text)", lineHeight: 1.5 }}>
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
              style={{ fontSize: "var(--text-sm)", gap: "var(--space-2)" }}
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
          borderRadius: "var(--radius)",
          padding: "14px 16px",
          marginBottom: "var(--space-4)",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "var(--space-3)",
            alignItems: "flex-start",
          }}
        >
          <Skull size={18} style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
          <div>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "var(--text-base)",
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
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
              }}
            >
              {summary?.legal_note ??
                "Job listings come from third-party APIs. Your CV may be sent to an AI for matching. Download or delete your data anytime below."}
            </p>
            <p style={{ margin: "8px 0 0", fontSize: "var(--text-xs)" }}>
              <Link to="/privacy" target="_blank" style={{ color: "var(--accent)" }}>
                Privacy Policy
              </Link>
              {" · "}
              <Link to="/terms" target="_blank" style={{ color: "var(--accent)" }}>
                Terms of Service
              </Link>
            </p>
          </div>
        </div>
      </div>

      {summary ? (
        <>
          <p
            className="label"
            style={{
              marginBottom: "var(--space-3)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <ShieldAlert size={14} /> What's on file right now
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "var(--space-2)",
              marginBottom: "var(--space-4)",
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
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                margin: "0 0 12px",
                lineHeight: 1.5,
              }}
            >
              CV: <strong>{summary.cv.filename}</strong> · {summary.cv.skills_count} skills,{" "}
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
              gap: "var(--space-2)",
            }}
          >
            {summary.stored_items.map((item) => (
              <li
                key={item.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  fontSize: "var(--text-sm)",
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

          <p className="label" style={{ marginBottom: "var(--space-2)" }}>
            Third-party services we use
          </p>
          <ul
            style={{
              margin: "0 0 16px",
              paddingLeft: 18,
              fontSize: "var(--text-xs)",
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
          style={{
            fontSize: "var(--text-sm)",
            color: "var(--text-muted)",
            marginBottom: "var(--space-4)",
          }}
        >
          Loading your data summary...
        </p>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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

function SectionGroup({
  id,
  icon: Icon,
  label,
  children,
}: {
  id: string;
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className="settings-group">
      <div className="settings-group-header">
        <span className="settings-group-icon">
          <Icon size={14} />
        </span>
        <span className="settings-group-label">{label}</span>
      </div>
      <div className="settings-group-body">{children}</div>
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
          fontSize: "var(--text-base)",
          fontWeight: 600,
          margin: "0 0 2px",
          color: "var(--text)",
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: "0 0 14px" }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}

function ModelPill({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="model-pill"
      onClick={onClick}
      disabled={active}
      style={{
        padding: "10px 14px",
        borderRadius: "var(--radius-sm)",
        cursor: active ? "default" : "pointer",
        border: active ? "1.5px solid var(--accent)" : "1px solid var(--border)",
        background: active ? "var(--accent-light)" : "var(--bg-secondary)",
        textAlign: "left",
        transition: "all 0.15s",
      }}
    >
      <div
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: 600,
          color: active ? "var(--accent)" : "var(--text)",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2 }}>
        {hint}
      </div>
    </button>
  );
}

function ShowcaseRow({
  name,
  meta,
  order,
  onToggle,
}: {
  name: string;
  meta: string;
  order: number;
  onToggle: () => void;
}) {
  const on = order >= 0;
  return (
    <button
      type="button"
      className={`settings-pick-row${on ? " is-on" : ""}`}
      onClick={onToggle}
      aria-pressed={on}
    >
      <span className="settings-pick-num" aria-hidden>
        {on ? order + 1 : ""}
      </span>
      <span>
        <span className="settings-pick-name">{name}</span>
        {meta ? <span className="settings-pick-meta">{meta}</span> : null}
      </span>
    </button>
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
        gap: "var(--space-1)",
        background: color,
        color: textColor,
        padding: "3px 8px 3px 10px",
        borderRadius: "var(--radius-pill)",
        fontSize: "var(--text-xs)",
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
