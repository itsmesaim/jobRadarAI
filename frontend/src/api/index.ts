import api from "./client";
import type {
  Job,
  JobsResponse,
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
};

export const jobsApi = {
  list: async (params?: {
    score_min?: number;
    score_max?: number;
    status?: string;
    source?: string;
    q?: string;
    page?: number;
    limit?: number;
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

  addManual: async (payload: {
    title: string;
    company: string;
    url?: string;
    jd_text: string;
  }) => {
    const res = await api.post("/jobs/manual", payload);
    return res.data;
  },

  updateStatus: async (id: string, status: JobStatus) => {
    const res = await api.patch(`/jobs/${id}/status`, { status });
    return res.data;
  },

  getBrief: async (id: string) => {
    const res = await api.get(`/jobs/${id}/brief`);
    return res.data as { brief: string };
  },

  hide: async (id: string) => {
    const res = await api.delete(`/jobs/${id}`);
    return res.data;
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
};

export const scrapeApi = {
  fetchJobFromUrl: async (
    url: string,
  ): Promise<{ title: string; text: string }> => {
    const res = await fetch(
      `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    );
    const data = await res.json();
    const parser = new DOMParser();
    const doc = parser.parseFromString(data.contents, "text/html");
    const scripts = doc.querySelectorAll("script, style, nav, footer, header");
    scripts.forEach((el) => el.remove());
    const text = doc.body?.innerText || doc.body?.textContent || "";
    const title = doc.title || "";
    return {
      title: title.trim(),
      text: text.replace(/\s+/g, " ").trim().slice(0, 6000),
    };
  },
};
