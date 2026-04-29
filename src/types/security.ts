export type SecurityLogEvent = {
  type: "security_log";
  tenantId: string;
  apiKey: string;
  route: string;
  timestamp: string;
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  ipAddress: string | null;
  country: string | null;
  colo: string | null;
  userAgent: string | null;
  reason: string | null;
};

export type LegacyQueueEvent = {
  apiKey: string;
  blocked: number;
};

export type SecurityQueueEvent = SecurityLogEvent | LegacyQueueEvent;

export type SecurityLogRow = {
  id: number;
  tenant_id: string;
  api_key: string;
  route: string;
  ip_address: string | null;
  country: string | null;
  colo: string | null;
  user_agent: string | null;
  allowed: number;
  remaining: number;
  retry_after: number;
  reason: string | null;
  created_at: string;
};

export type TopAbusiveIpRow = {
  ip_address: string;
  country: string | null;
  colo: string | null;
  total_requests: number;
  blocked_requests: number;
  tenant_requests: number;
  tenant_blocked_requests: number;
  tenant_count: number;
  last_seen: string;
};
