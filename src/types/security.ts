export type SecurityLogEvent = {
  type: "security_log";
  tenantId: string;
  /** api_keys.id when the key was valid, else null. */
  apiKeyId: number | null;
  /** Masked key for display; never the raw key. */
  apiKeyHint: string | null;
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

/*
 Shapes produced by earlier deploys that may still be in the queue.
 They carry the raw key; the consumer hashes/masks it on arrival.
*/
export type LegacySecurityLogEvent = Omit<
  SecurityLogEvent,
  "apiKeyId" | "apiKeyHint"
> & {
  apiKey: string;
};

export type LegacyQueueEvent = {
  apiKey: string;
  blocked: number;
};

export type SecurityQueueEvent =
  | SecurityLogEvent
  | LegacySecurityLogEvent
  | LegacyQueueEvent;

export type SecurityLogRow = {
  id: number;
  tenant_id: string;
  api_key_hint: string;
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
