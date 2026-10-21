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
    degraded?: string | null;
  };
}

/*
 A 401 for the session's own key means it was revoked (or deleted):
 drop the session and send the user back to the right login page.
*/
function handleSessionRejected(apiKey: string | undefined) {
  const session = sessionStore.get();
  if (!session || !apiKey || session.apiKey !== apiKey) return;
  sessionStore.clear();
  window.location.assign(session.role === "super_admin" ? "/admin-login" : "/login");
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
  } catch (cause) {
    throw new Error("Failed to connect. Please check your connection.", { cause });
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

  if (res.status === 401) handleSessionRejected(apiKey);

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
      degraded: res.headers.get("X-EdgeLimiter-Degraded"),
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
/** Pass a super_admin `apiKey` to add a user to an existing tenant. */
export const registerUser = (body: RegisterReq, apiKey?: string) =>
  apiRequest<RegisterRes>("/register", { method: "POST", body, apiKey });

export interface CheckRes {
  tenant?: string;
  route?: string;
  allowed?: boolean;
  remaining?: number;
  retryAfter?: number;
  algorithm?: string;
  degraded?: string;
}
/** `identifier` (optional) rate-limits each end user separately under the route's policy. */
export const checkRate = (tenantId: string, route: string, apiKey: string, identifier?: string) =>
  apiRequest<CheckRes>("/check", {
    method: "POST",
    body: identifier ? { tenantId, route, identifier } : { tenantId, route },
    apiKey,
  });

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
export const getMetrics = (apiKey: string) =>
  apiRequest<MetricsRes>("/metrics", { apiKey });
/** `tenantId` is honoured for super_admin only; clients always get their own tenant. */
export const getClientMetrics = (apiKey: string, tenantId?: string) =>
  apiRequest<MetricsRes>("/client/metrics", {
    apiKey,
    query: tenantId ? { tenantId } : undefined,
  });

export interface TopKey {
  apiKey: string;
  tenantId: string | null;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: number;
}
/** `tenantId` is honoured for super_admin only; clients always get their own tenant. */
export const getTopKeys = (apiKey: string, tenantId?: string) =>
  apiRequest<TopKey[]>("/top-keys", {
    apiKey,
    query: tenantId ? { tenantId } : undefined,
  });

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
  intelligenceSource?: "ai" | "rules";
  generatedAt?: string;
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

export interface Policy {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: string;
}
export const listPolicies = (tenantId: string, apiKey: string) =>
  apiRequest<{ tenantId: string; policies: Policy[]; cursor: string | null }>("/config", {
    apiKey,
    query: { tenantId },
  });
export const deletePolicy = (tenantId: string, route: string, apiKey: string) =>
  apiRequest<{ success: boolean; message: string }>("/config", {
    method: "DELETE",
    apiKey,
    query: { tenantId, route },
  });

export interface ApiKeyInfo {
  id: number;
  hint: string;
  status: "active" | "revoked";
  email: string;
  createdAt: string;
  revokedAt: string | null;
  current: boolean;
}
/** `tenantId` is honoured for super_admin only. */
export const listKeys = (apiKey: string, tenantId?: string) =>
  apiRequest<{ keys: ApiKeyInfo[] }>("/keys", {
    apiKey,
    query: tenantId ? { tenantId } : undefined,
  });
export const createKey = (apiKey: string) =>
  apiRequest<{ success: boolean; id: number; apiKey: string; hint: string }>("/keys", {
    method: "POST",
    apiKey,
  });
export const revokeKey = (id: number, apiKey: string) =>
  apiRequest<{ success: boolean; id: number; status: string; current: boolean }>(
    `/keys/${id}/revoke`,
    { method: "POST", apiKey },
  );

export interface AuditLog {
  id: number;
  tenant_id: string;
  api_key_hint: string | null;
  route: string | null;
  actor: string;
  action_type: string;
  message: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  created_at: string;
}
export const getAuditReport = (tenantId: string, apiKey: string) =>
  apiRequest<{ tenantId: string; auditLogs: AuditLog[] }>("/audit-report", {
    apiKey,
    query: { tenantId },
  });

export const getHealth = () => apiRequest<{ status: string }>("/health");
