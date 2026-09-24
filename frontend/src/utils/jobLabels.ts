import type { Job } from "../types";

export function sourceLabel(source?: Job["source"]): string {
  switch (source) {
    case "manual":
      return "Manual";
    case "jooble":
      return "Jooble";
    case "adzuna":
      return "Adzuna";
    case "jobsapi-indeed":
      return "Indeed";
    case "jobsapi-linkedin":
      return "LinkedIn";
    case "greenhouse":
      return "Greenhouse";
    case "lever":
      return "Lever";
    case "ashby":
      return "Ashby";
    case "tavily":
      return "Web search";
    default:
      return "Auto";
  }
}

export function prettyRatedBy(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim();
  const i = s.indexOf(":");
  if (i < 0) return s;
  const provider = s.slice(0, i);
  const model = s.slice(i + 1);
  const stripped = model.toLowerCase().startsWith(provider.toLowerCase())
    ? model.slice(provider.length).replace(/^[-:]/, "")
    : model;
  const prov = provider.charAt(0).toUpperCase() + provider.slice(1);
  return stripped ? `${prov} ${stripped}` : prov;
}
