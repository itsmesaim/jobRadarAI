export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
  isAdmin?: boolean;
  adminBasePath?: string | null;
  usage?: {
    searches_used: number;
    ratings_used: number;
    search_limit: number;
    rating_limit: number;
    is_admin: boolean;
    [key: string]: any;
  };
}

export interface Job {
  id: string;
  title: string;
  url: string;
  snippet: string;
  crawled_at: string;
  posted_at?: string; // posted_at_actual, falling back to crawled_at
  posted_at_actual?: string; // true posting date from source, if it gave one
  rated_at?: string; // when this job was last rated for the current user
  rating_in_progress?: boolean; // a background worker is rating this job right now
  rated_by_model?: string | null; // "<provider>:<model>", or an "auto" label for the no-LLM cheap path
  source: "tavily" | "manual" | "jooble" | "adzuna" | "jobsapi-indeed" | "jobsapi-linkedin";
  score: number | null;
  matched_strengths: string[];
  gaps: string[];
  verdict: string;
  auto_reject: boolean;
  status: JobStatus;
  full_text?: string;
  company?: string;
  location?: string;
  salary_text?: string;
  salary_min?: number;
  salary_max?: number;
}

export type JobStatus =
  "NEW" | "SAVED" | "APPLIED" | "INTERVIEWING" | "OFFER" | "REJECTED" | "FOLLOWUP" | "HALF_APPLIED";

export type JobRatingFilter = "all" | "rated" | "unrated";

export interface JobsResponse {
  jobs: Job[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  account_total?: number;
}
export interface WorkMode {
  remote: boolean;
  hybrid: boolean;
  onsite: boolean;
}

export interface UserPreferences {
  preferred_locations: string[];
  primary_role: string;
  secondary_roles: string[];
  job_types: {
    full_time: boolean;
    internship: boolean;
    contract: boolean;
    remote: boolean;
    graduate: boolean;
  };
  min_salary: number;
  key_skills: string[];
  experience_level: "junior" | "mid" | "senior";
  work_authorization: string;
  avoid_industries: string[];
  work_mode: WorkMode;
  about_me: string;
  email_reminders_enabled: boolean;
  timezone: string;
}

export interface CVData {
  filename: string;
  uploaded_at: string;
  structured: {
    name: string;
    email: string;
    summary: string;
    skills: string[];
    experience: Array<{
      title: string;
      company: string;
      start: string;
      end: string;
      bullets: string[];
    }>;
    projects: Array<{
      name: string;
      description: string;
      tech: string[];
      url: string | null;
    }>;
    education: Array<{
      degree: string;
      institution: string;
      start: string;
      end: string;
      grade: string | null;
    }>;
    parsed_by_model?: string | null;
  };
}

export interface DataStoredItem {
  key: string;
  label: string;
  stored: boolean;
}

export interface DataSummary {
  roast: string;
  legal_note: string;
  account: {
    name: string;
    email: string;
    created_at: string;
  };
  cv: {
    filename: string;
    uploaded_at: string;
    skills_count: number;
    experience_count: number;
    projects_count: number;
    education_count: number;
    has_raw_text: boolean;
  } | null;
  preferences: {
    has_preferences: boolean;
    locations_count: number;
    skills_count: number;
    about_me_chars: number;
    has_work_authorization: boolean;
  };
  skill_overrides_count: number;
  jobs: {
    total: number;
    rated: number;
    manual: number;
    hidden: number;
  };
  usage: {
    searches_used: number;
    ratings_used: number;
  };
  third_party_services: string[];
  stored_items: DataStoredItem[];
}

export interface Props {
  job: Job;
  onStatusChange?: () => void;
  onHidden?: () => void;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  created_at: string;
  searches_used: number;
  ratings_used: number;
  search_limit: number;
  rating_limit: number;
  full_access?: boolean;
  full_access_until?: string;
  is_admin: boolean;
  last_reset?: string;
  admin_notes?: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
}
