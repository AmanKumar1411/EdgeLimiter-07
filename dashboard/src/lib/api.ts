export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) || "https://edge-limiter.edgeaman.workers.dev";

export type Role = "client" | "super_admin";

export interface Session {
  tenantId: string;
  apiKey: string;
  email: string;
  role: Role;
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
  set(session: Session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
};

export function loginPath(role: Role | undefined) {
  return role === "super_admin" ? "/admin-login" : "/login";
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  apiKey?: string;
  query?: Record<string, string | undefined>;
}

async function send(path: string, { method = "GET", body, apiKey, query }: RequestOptions) {
  const url = new URL(API_BASE + path);
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_BASE}. Check your connection and that the Worker is running.`, 0);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    // Empty or non-JSON body (e.g. an HTML error page from a proxy).
  }

  // A 401 for the signed-in key means it was revoked: end the session.
  if (response.status === 401) {
    const session = sessionStore.get();
    if (session && apiKey === session.apiKey) {
      sessionStore.clear();
      window.location.assign(loginPath(session.role));
    }
  }

  return { response, payload };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { response, payload } = await send(path, options);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export interface Policy {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: Algorithm;
}

export type Algorithm = "sliding_window" | "fixed_window" | "token_bucket";

export interface Metrics {
  totalRequests: number;
  blockedRequests: number;
  blockRate: string;
}

export interface TopKey {
  apiKey: string;
  tenantId: string | null;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: number;
}

export interface RequestLog {
  id: number;
  tenantId: string;
  apiKey: string | null;
  route: string;
  ipAddress: string | null;
  country: string | null;
  allowed: boolean;
  reason: string | null;
  createdAt: string;
}

interface AbusiveIp {
  ipAddress: string;
  country: string | null;
  totalRequests: number;
  blockedRequests: number;
  tenantCount: number;
  lastSeen: string;
}

export interface SecurityReport {
  tenantId: string;
  recentLogs: RequestLog[];
  topAbusiveIps: AbusiveIp[];
  aiSummary: string;
  abuseScore: number;
  recommendation: string;
  intelligenceSource: "ai" | "rules";
  generatedAt: string;
}

export interface ApiKeyInfo {
  id: number;
  hint: string;
  status: "active" | "revoked";
  email: string;
  createdAt: string;
  revokedAt: string | null;
  current: boolean;
}

export interface AuditEntry {
  id: number;
  action_type: string;
  actor: string;
  message: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  api_key_hint: string | null;
  route: string | null;
  created_at: string;
}

export interface CheckResult {
  status: number;
  allowed: boolean;
  remaining: number | null;
  retryAfter: number;
  algorithm?: string;
  degraded?: string;
  limit: string | null;
  reset: string | null;
}

export const api = {
  health: () => request<{ status: string }>("/health"),

  whoami: (apiKey: string) => request<{ email: string; role: Role; tenantId: string }>("/whoami", { apiKey }),

  /** Pass a super_admin key to add a user to an existing tenant. */
  register: (email: string, tenantId: string, adminKey?: string) =>
    request<{ apiKey: string; tenantId: string; email: string }>("/register", {
      method: "POST",
      body: { email, tenantId },
      apiKey: adminKey,
    }),

  policies: (tenantId: string, apiKey: string) =>
    request<{ policies: Policy[] }>("/config", { apiKey, query: { tenantId } }).then((r) => r.policies),

  savePolicy: (policy: Policy, apiKey: string) => request("/config", { method: "POST", body: policy, apiKey }),

  deletePolicy: (tenantId: string, route: string, apiKey: string) =>
    request("/config", { method: "DELETE", apiKey, query: { tenantId, route } }),

  resetCounter: (tenantId: string, route: string, apiKey: string) =>
    request("/reset", { method: "POST", body: { tenantId, route }, apiKey }),

  /** Never throws for 429: a blocked request is a normal answer. */
  async check(tenantId: string, route: string, apiKey: string, identifier?: string): Promise<CheckResult> {
    const { response, payload } = await send("/check", {
      method: "POST",
      body: identifier ? { tenantId, route, identifier } : { tenantId, route },
      apiKey,
    });
    const decision = (payload ?? {}) as Partial<CheckResult> & { error?: string };
    if (!response.ok && response.status !== 429) {
      throw new ApiError(decision.error ?? `Request failed (${response.status})`, response.status);
    }
    return {
      status: response.status,
      allowed: Boolean(decision.allowed),
      remaining: decision.remaining ?? null,
      retryAfter: decision.retryAfter ?? 0,
      algorithm: decision.algorithm,
      degraded: decision.degraded,
      limit: response.headers.get("X-RateLimit-Limit"),
      reset: response.headers.get("X-RateLimit-Reset"),
    };
  },

  /** Tenant totals; `tenantId` only matters for super_admin. */
  tenantMetrics: (apiKey: string, tenantId: string) =>
    request<Metrics>("/client/metrics", { apiKey, query: { tenantId } }),

  systemMetrics: (apiKey: string) => request<Metrics>("/metrics", { apiKey }),

  topKeys: (apiKey: string, tenantId?: string) => request<TopKey[]>("/top-keys", { apiKey, query: { tenantId } }),

  securityReport: (tenantId: string, apiKey: string) =>
    request<SecurityReport>("/security-report", { apiKey, query: { tenantId } }),

  auditLog: (tenantId: string, apiKey: string) =>
    request<{ auditLogs: AuditEntry[] }>("/audit-report", { apiKey, query: { tenantId } }).then((r) => r.auditLogs),

  keys: (apiKey: string, tenantId: string) =>
    request<{ keys: ApiKeyInfo[] }>("/keys", { apiKey, query: { tenantId } }).then((r) => r.keys),

  createKey: (apiKey: string) =>
    request<{ id: number; apiKey: string; hint: string }>("/keys", { method: "POST", apiKey }),

  revokeKey: (id: number, apiKey: string) =>
    request<{ current: boolean }>(`/keys/${id}/revoke`, { method: "POST", apiKey }),
};
