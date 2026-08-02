import type { CVData, UserPreferences } from "../types";

export interface MissingField {
  key: string;
  label: string;
  /** Settings tab id (SETTINGS_GROUPS) this field lives under. */
  group: "profile" | "preferences";
}

/** Fields required for the AI to actually do its job (search gating, apply
 * pack tailoring, visa/sponsorship reasoning), used both to gate Search and
 * to show what's still missing across Settings' tabs in one place. */
export function getMissingProfileFields(
  cv: CVData | undefined,
  prefs: UserPreferences | undefined,
): MissingField[] {
  const missing: MissingField[] = [];
  if (!cv) missing.push({ key: "cv", label: "CV upload", group: "profile" });
  if (!prefs?.primary_role?.trim()) {
    missing.push({ key: "primary_role", label: "Primary role", group: "preferences" });
  }
  if (!prefs?.preferred_locations?.length) {
    missing.push({ key: "preferred_locations", label: "Job location", group: "preferences" });
  }
  if (!prefs?.experience_level) {
    missing.push({ key: "experience_level", label: "Experience level", group: "preferences" });
  }
  if (!prefs?.nationality?.trim()) {
    missing.push({ key: "nationality", label: "Nationality", group: "preferences" });
  }
  if (!prefs?.visa_status?.trim()) {
    missing.push({ key: "visa_status", label: "Visa status", group: "preferences" });
  }
  return missing;
}
