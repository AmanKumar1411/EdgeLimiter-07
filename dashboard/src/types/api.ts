export type RegisterRequest = {
  email: string;
  password: string;
  tenantId: string;
  role?: "client";
};

export type RegisterResponse = {
  success: boolean;
  email: string;
  tenantId: string;
  role: "client";
  apiKey: string;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type LoginResponse = {
  success: boolean;
  role: "client" | "super_admin";
  tenantId: string;
  apiKey: string;
  email: string;
};

export type ConfigRequest = {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: "sliding_window" | "fixed_window" | "token_bucket";
};

export type ConfigResponse = {
  success: boolean;
  message: string;
  config: ConfigRequest;
};

export type CheckRequest = {
  tenantId: string;
  route: string;
};

export type CheckResponse = {
  tenant: string;
  route: string;
  configKey: string;
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  algorithm: string;
};

export type MetricsResponse = {
  totalRequests: number;
  blockedRequests: number;
  blockRate: string;
};

export type TopKey = {
  apiKey: string;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: string;
};

export type RunReportResponse = {
  report: string;
  topApiKey: string;
  totalRequests: number;
  blockedRequests: number;
  abuseScore: string;
  recommendation: string;
};
