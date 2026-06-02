// EdgeLimiter API client
const API_BASE = (import.meta.env.VITE_API_BASE as string) || "https://edge-limiter.edgeaman.workers.dev";

export interface Session {
  tenantId: string;
  apiKey: string;
  email?: string;
  role?: "client" | "super_admin";
}

const SESSION_KEY = "edge-limiter-session";

export const sessionStore = {
  get(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(s: Session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
};

interface RequestOpts {
  method?: string;
  body?: unknown;
  apiKey?: string;
  query?: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: {
    limit?: string | null;
    remaining?: string | null;
    reset?: string | null;
    retryAfter?: string | null;
  };
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOpts = {}): Promise<ApiResponse<T>> {
  const { method = "GET", body, apiKey, query } = opts;
  const url = new URL(API_BASE + path);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error("Failed to connect. Please check your connection.");
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  // For 429, we still return the body (it's a valid "blocked" response for /check)
  if (!res.ok && res.status !== 429) {
    const msg =
      (data && typeof data === "object" && ("error" in data || "message" in data)
        ? (data as Record<string, string>).error || (data as Record<string, string>).message
        : null) || `Request failed with status ${res.status}`;
    throw new Error(msg);
  }

  return {
    data: data as T,
    status: res.status,
    headers: {
      limit: res.headers.get("X-RateLimit-Limit"),
      remaining: res.headers.get("X-RateLimit-Remaining"),
      reset: res.headers.get("X-RateLimit-Reset"),
      retryAfter: res.headers.get("Retry-After"),
    },
  };
}

// Typed endpoints
export interface RegisterReq {
  email: string;
  tenantId: string;
  role: "client" | "super_admin";
}
export interface RegisterRes {
  success: boolean;
  email: string;
  tenantId: string;
  role: string;
  apiKey: string;
}
export const registerUser = (body: RegisterReq) =>
  apiRequest<RegisterRes>("/register", { method: "POST", body });

export interface CheckRes {
  tenant?: string;
  route?: string;
  allowed?: boolean;
  remaining?: number;
  retryAfter?: number;
  algorithm?: string;
}
export const checkRate = (tenantId: string, route: string, apiKey: string) =>
  apiRequest<CheckRes>("/check", { method: "POST", body: { tenantId, route }, apiKey });

export interface ConfigReq {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: string;
}
export const savePolicy = (body: ConfigReq, apiKey: string) =>
  apiRequest<{ success: boolean; message: string; config: unknown }>("/config", {
    method: "POST",
    body,
    apiKey,
  });

export interface MetricsRes {
  totalRequests: number;
  blockedRequests: number;
  blockRate: string;
}
export const getMetrics = () => apiRequest<MetricsRes>("/metrics");
export const getClientMetrics = (apiKey: string) =>
  apiRequest<MetricsRes>("/client/metrics", { apiKey });

export interface TopKey {
  apiKey: string;
  tenantId: string | null;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: number;
}
export const getTopKeys = () => apiRequest<TopKey[]>("/top-keys");

export interface SecurityLog {
  id: string;
  route: string;
  ipAddress: string;
  country: string;
  allowed: boolean;
  reason: string;
  createdAt: string;
}
export interface AbusiveIp {
  ipAddress: string;
  country: string;
  totalRequests: number;
  blockedRequests: number;
  tenantCount: number;
  lastSeen: string;
}
export interface SecurityReport {
  tenantId: string;
  recentLogs: SecurityLog[];
  topAbusiveIps: AbusiveIp[];
  aiSummary: string;
  abuseScore: number;
  recommendation: string;
}
export const getSecurityReport = (tenantId: string, apiKey: string) =>
  apiRequest<SecurityReport>("/security-report", { apiKey, query: { tenantId } });

export const resetCounter = (tenantId: string, route: string, apiKey: string) =>
  apiRequest<{ success: boolean; message: string }>("/reset", {
    method: "POST",
    body: { tenantId, route },
    apiKey,
  });

export interface WhoAmIRes {
  email: string;
  role: "client" | "super_admin";
  tenantId: string;
}
export const whoAmI = (apiKey: string) =>
  apiRequest<WhoAmIRes>("/whoami", { apiKey });
