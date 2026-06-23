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
  posted_at?: string; // actual job posting date from source when available
  source: "tavily" | "manual" | "jooble" | "adzuna" | "jobsapi-indeed";
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
  | "NEW"
  | "SAVED"
  | "APPLIED"
  | "INTERVIEWING"
  | "OFFER"
  | "REJECTED"
  | "FOLLOWUP"
  | "HALF_APPLIED";

export interface JobsResponse {
  jobs: Job[];
  page: number;
  limit: number;
  total: number;
  pages: number;
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
  };
  min_salary: number;
  key_skills: string[];
  experience_level: "junior" | "mid" | "senior";
  work_authorization: string;
  avoid_industries: string[];
  work_mode: WorkMode;
  about_me: string;
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
  };
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
