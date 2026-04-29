import type {
  CheckRequest,
  CheckResponse,
  ConfigRequest,
  ConfigResponse,
  LoginRequest,
  LoginResponse,
  MetricsResponse,
  ResetCounterRequest,
  ResetCounterResponse,
  RegisterRequest,
  RegisterResponse,
  RunReportResponse,
  SecurityReport,
  TopKey,
} from "../types/api";
import { clearSession, getSession, saveSession, type AuthSession } from "../auth/session";

const DEFAULT_BASE_URL = "https://edge-limiter.edgeaman.workers.dev";

const BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE as string | undefined;
  const trimmed = envBase?.trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
})();

export class ApiError extends Error {
  status: number;
  payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function buildUrl(path: string) {
  if (!path.startsWith("/")) {
    return `${BASE_URL}/${path}`;
  }
  return `${BASE_URL}${path}`;
}

function readNumber(value: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function requestJson<T>(path: string, options: RequestInit) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const contentType = response.headers.get("Content-Type") ?? "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && "error" in data && String(data.error)) ||
      (data && typeof data === "object" && "message" in data && String(data.message)) ||
      `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export function getApiBaseUrl() {
  return BASE_URL;
}

export async function registerUser(payload: RegisterRequest) {
  return requestJson<RegisterResponse>("/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function loginUser(payload: LoginRequest) {
  return requestJson<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createPolicy(
  payload: ConfigRequest,
  apiKey: string
) {
  const safeApiKey = String(apiKey)
    .trim()
    .replace(/[^\x00-\x7F]/g, "");

  return requestJson<ConfigResponse>("/config", {
    method: "POST",
    headers: {
      "x-api-key": safeApiKey,
    },
    body: JSON.stringify(payload),
  });
}

export type CheckResult = {
  status: number;
  data: CheckResponse;
  rateLimit: {
    limit?: number;
    remaining?: number;
    reset?: number;
    retryAfter?: number;
  };
};

export type Session = AuthSession;

export const sessionStore = {
  get: getSession,
  set: saveSession,
  clear: clearSession,
};

export async function runCheck(
  payload: CheckRequest,
  apiKey: string
) {
  const safeApiKey = String(apiKey)
    .trim()
    .replace(/[^\x00-\x7F]/g, "");

  const response = await fetch(buildUrl("/check"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": safeApiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as CheckResponse;

  if (!response.ok && response.status !== 429) {
    const message =
      (data as unknown as { error?: string })?.error ??
      "Check request failed";

    throw new ApiError(
      message,
      response.status,
      data
    );
  }

  const rateLimit = {
    limit: readNumber(
      response.headers.get("X-RateLimit-Limit")
    ),
    remaining: readNumber(
      response.headers.get("X-RateLimit-Remaining")
    ),
    reset: readNumber(
      response.headers.get("X-RateLimit-Reset")
    ),
    retryAfter: readNumber(
      response.headers.get("Retry-After")
    ),
  };

  return {
    status: response.status,
    data,
    rateLimit,
  } satisfies CheckResult;
}

export async function checkRate(tenantId: string, route: string, apiKey: string) {
  return runCheck({ tenantId, route }, apiKey);
}

export async function fetchMetrics() {
  return requestJson<MetricsResponse>("/metrics", {
    method: "GET",
  });
}

export async function fetchClientMetrics(apiKey: string) {
  return requestJson<MetricsResponse>("/client/metrics", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
}

export async function fetchTopKeys() {
  return requestJson<TopKey[]>("/top-keys", {
    method: "GET",
  });
}

export async function runReport() {
  return requestJson<RunReportResponse>("/run-report", {
    method: "GET",
  });
}

export async function runClientReport(apiKey: string) {
  return requestJson<RunReportResponse>("/client/report", {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
}

export async function getSecurityReport(tenantId: string, apiKey: string) {
  const query = new URLSearchParams({ tenantId });
  return requestJson<SecurityReport>(`/security-report?${query.toString()}`, {
    method: "GET",
    headers: {
      "x-api-key": apiKey,
    },
  });
}

export async function resetCounter(payload: ResetCounterRequest, apiKey: string) {
  return requestJson<ResetCounterResponse>("/reset", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
}
