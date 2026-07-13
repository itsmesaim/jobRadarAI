import api from "./client";
import type {
  Job,
  JobsResponse,
  JobRatingFilter,
  JobStatus,
  UserPreferences,
  CVData,
} from "../types";

export const authApi = {
  register: async (name: string, email: string, password: string) => {
    const res = await api.post("/auth/register", { name, email, password });
    return res.data as { access_token: string };
  },
  login: async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    return res.data as { access_token: string };
  },
  me: async () => {
    const res = await api.get("/auth/me");
    return res.data;
  },
  forgotPassword: async (email: string) => {
    const res = await api.post("/auth/forgot-password", { email });
    return res.data as { message: string };
  },
  resetPassword: async (token: string, new_password: string) => {
    const res = await api.post("/auth/reset-password", { token, new_password });
    return res.data as { message: string };
  },
  changePassword: async (current_password: string, new_password: string) => {
    const res = await api.post("/auth/change-password", {
      current_password,
      new_password,
    });
    return res.data as { message: string };
  },
};

export const jobsApi = {
  list: async (params?: {
    score_min?: number;
    score_max?: number;
    rating?: JobRatingFilter;
    status?: string;
    source?: string;
    q?: string;
    page?: number;
    limit?: number;
    kanban?: boolean;
    exclude_terminal?: boolean;
  }) => {
    const res = await api.get("/jobs", { params });
    return res.data as JobsResponse;
  },

  get: async (id: string) => {
    const res = await api.get(`/jobs/${id}`);
    return res.data as Job;
  },

  rateAll: async () => {
    const res = await api.post("/jobs/rate-all");
    return res.data;
  },

  // Self-serve: re-rates jobs the user has tracked in their Kanban pipeline
  // (status != NEW), even if already scored. Costs normal rating quota.
  rateAllSaved: async () => {
    const res = await api.post("/jobs/rate-all?scope=saved");
    return res.data;
  },

  // Admin-only: re-rates EVERY job for the account regardless of status or
  // existing score — use after a rating-prompt fix. Backend rejects this
  // for non-admins.
  rateAllForce: async () => {
    const res = await api.post("/jobs/rate-all?scope=all");
    return res.data;
  },

  rateOne: async (id: string) => {
    const res = await api.post(`/jobs/${id}/rate`);
    return res.data as {
      score: number | null;
      verdict: string;
      matched_strengths: string[];
      gaps: string[];
      auto_reject: boolean;
      structural_mismatch?: boolean;
      tailoring_tips?: string[];
      rated_at: string;
      rated_by_model?: string | null;
    };
  },

  submitRatingFeedback: async (id: string, comment: string, stars?: number) => {
    const res = await api.post(`/jobs/${id}/rating-feedback`, { comment, stars });
    return res.data as { message: string };
  },

  addManual: async (payload: { title: string; company: string; url?: string; jd_text: string }) => {
    const res = await api.post("/jobs/manual", payload);
    return res.data;
  },

  fetchUrl: async (url: string) => {
    const res = await api.post("/jobs/fetch-url", { url });
    return res.data as { title: string; text: string };
  },

  updateStatus: async (id: string, status: JobStatus) => {
    const res = await api.patch(`/jobs/${id}/status`, { status });
    return res.data;
  },

  getBrief: async (id: string) => {
    const res = await api.get(`/jobs/${id}/brief`);
    return res.data as { brief: string };
  },

  getApplyPack: async (id: string) => {
    const res = await api.get(`/jobs/${id}/apply-pack`);
    return res.data as { pack: string; apply_packs_remaining: number };
  },

  hide: async (id: string) => {
    const res = await api.delete(`/jobs/${id}`);
    return res.data;
  },

  previewCleanup: async (req: {
    filter_type: "old" | "by_status" | "unrated";
    older_than_days?: number;
    statuses?: string[];
  }) => {
    const res = await api.post("/jobs/cleanup/preview", req);
    return res.data as { count: number; filter_type: string };
  },

  executeCleanup: async (req: {
    filter_type: "old" | "by_status" | "unrated";
    older_than_days?: number;
    statuses?: string[];
  }) => {
    const res = await api.delete("/jobs/cleanup", { data: req });
    return res.data as { deleted: number; filter_type: string };
  },
};

export const crawlerApi = {
  search: async () => {
    const res = await api.post("/crawler/search");
    return res.data;
  },
  status: async () => {
    const res = await api.get("/crawler/status");
    return res.data;
  },
};

export const cvApi = {
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post("/cv/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },
  get: async () => {
    const res = await api.get("/cv/me");
    return res.data as CVData;
  },

  delete: async () => {
    await api.delete("/cv/me");
  },
};

export const userApi = {
  getPreferences: async () => {
    const res = await api.get("/users/preferences");
    return res.data as UserPreferences;
  },
  updatePreferences: async (prefs: Partial<UserPreferences>) => {
    const res = await api.patch("/users/preferences", prefs);
    return res.data;
  },
  getSkillOverrides: async () => {
    const res = await api.get("/users/skill-overrides");
    return res.data as { overrides: { skill: string; context: string }[] };
  },
  addSkillOverride: async (skill: string, context: string) => {
    const res = await api.post("/users/skill-overrides", { skill, context });
    return res.data;
  },
  deleteSkillOverride: async (skill: string) => {
    const res = await api.delete(`/users/skill-overrides/${encodeURIComponent(skill)}`);
    return res.data;
  },

  getDataSummary: async () => {
    const res = await api.get("/users/data-summary");
    return res.data;
  },

  exportData: async () => {
    const res = await api.get("/users/data-export");
    return res.data;
  },

  deleteAccount: async (password: string) => {
    await api.delete("/users/account", { data: { password } });
  },
};

// Admin APIs — these must be called with the full prefixed path when adminBasePath is present
// e.g. api.get(`${adminBasePath}/users`)
export const adminApi = {
  listUsers: async (basePath: string, page = 1, limit = 50) => {
    const res = await api.get(`${basePath}/users`, { params: { page, limit } });
    return res.data as { users: any[]; total: number; page: number };
  },
  getUser: async (basePath: string, userId: string) => {
    const res = await api.get(`${basePath}/users/${userId}`);
    return res.data;
  },
  getAiSummary: async (basePath: string) => {
    const res = await api.get(`${basePath}/ai-summary`);
    return res.data;
  },
  updateAccess: async (
    basePath: string,
    userId: string,
    data: {
      search_limit?: number;
      rating_limit?: number;
      daily_token_limit?: number;
      monthly_token_limit?: number;
      notes?: string;
      full_access?: boolean;
      full_access_duration_hours?: number;
    },
  ) => {
    const res = await api.patch(`${basePath}/users/${userId}/access`, data);
    return res.data;
  },
  suspendUser: async (
    basePath: string,
    userId: string,
    data: { suspended: boolean; reason?: string },
  ) => {
    const res = await api.patch(`${basePath}/users/${userId}/suspend`, data);
    return res.data as {
      user_id: string;
      email: string;
      suspended: boolean;
      suspended_reason?: string;
    };
  },
  deleteUser: async (basePath: string, userId: string) => {
    const res = await api.delete(`${basePath}/users/${userId}`);
    return res.data as { deleted_user: string; deleted_jobs: number };
  },
  cleanupJobs: async (
    basePath: string,
    payload: {
      user_id: string;
      filter_type:
        "all" | "old" | "unrated" | "low_score" | "below_score" | "by_status" | "auto_rejected";
      older_than_days?: number;
      max_score?: number;
      min_score?: number;
      statuses?: string[];
      dry_run: boolean;
    },
  ) => {
    const res = await api.post(`${basePath}/jobs/cleanup`, payload);
    return res.data as {
      dry_run: boolean;
      would_delete?: number;
      deleted?: number;
      filter_type: string;
      target_email?: string;
    };
  },
};

/** @deprecated use jobsApi.fetchUrl — kept as alias for ManualJDModal */
export const scrapeApi = {
  fetchJobFromUrl: (url: string) => jobsApi.fetchUrl(url),
};
