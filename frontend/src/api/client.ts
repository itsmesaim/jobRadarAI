type RequestConfig = {
  params?: Record<string, string | number | boolean | undefined | null>;
  data?: unknown;
  headers?: Record<string, string>;
};

type ApiResponse<T = any> = { data: T };

export type ApiError = Error & {
  response?: { status: number; data?: { detail?: string } };
};

const baseURL = import.meta.env.VITE_API_URL;

function buildUrl(path: string, params?: RequestConfig["params"]) {
  const url = new URL(path, baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T = any>(
  method: string,
  path: string,
  config: RequestConfig = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...config.headers };
  const token = localStorage.getItem("token");
  if (token) headers.Authorization = `Bearer ${token}`;

  const isFormData = config.data instanceof FormData;
  const hasJsonBody = config.data != null && !isFormData && method !== "GET";
  if (isFormData) {
    delete headers["Content-Type"];
  } else if (hasJsonBody && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(buildUrl(path, config.params), {
    method,
    headers,
    body:
      config.data == null || method === "GET"
        ? undefined
        : config.data instanceof FormData
          ? config.data
          : JSON.stringify(config.data),
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
  }

  let data: T | undefined;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = text as T;
    }
  }

  if (!res.ok) {
    const err = new Error(res.statusText) as ApiError;
    err.response = { status: res.status, data: data as { detail?: string } };
    throw err;
  }

  return { data: data as T };
}

const api = {
  get: <T = any>(path: string, config?: RequestConfig) => request<T>("GET", path, config),
  post: <T = any>(path: string, data?: unknown, config?: RequestConfig) =>
    request<T>("POST", path, { ...config, data }),
  patch: <T = any>(path: string, data?: unknown, config?: RequestConfig) =>
    request<T>("PATCH", path, { ...config, data }),
  delete: <T = any>(path: string, config?: RequestConfig) => request<T>("DELETE", path, config),
};

export default api;
