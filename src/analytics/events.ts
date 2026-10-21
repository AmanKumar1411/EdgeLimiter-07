import { hashApiKey, maskApiKey } from "../keys/keys";
import type { Background, Env } from "../shared/env";
import type { ClientInfo } from "../shared/http";
import { log } from "../shared/log";

/** One /check decision, sent to the queue and stored in security_logs. */
export interface SecurityEvent extends ClientInfo {
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
  reason: string | null;
}

const MAX_USER_AGENT_LENGTH = 512;
const MAX_RETRY_DELAY_SECONDS = 300;

/** Queue a /check decision. Best-effort: never blocks or fails the request. */
export function recordCheck(
  env: Env,
  ctx: Background,
  event: Omit<SecurityEvent, "type" | "timestamp">,
) {
  const message: SecurityEvent = { type: "security_log", ...event, timestamp: new Date().toISOString() };
  const send = async () => env.LOG_QUEUE.send(message);
  ctx.waitUntil(
    send().catch((err) =>
      log.error("security_event_enqueue_failed", err, { tenantId: event.tenantId, reason: event.reason }),
    ),
  );
}

interface UsageUpdate {
  apiKeyId: number;
  tenantId: string;
  blocked: number;
}

/** Writes queued events to D1, one transaction per message. */
export async function consumeSecurityEvents(batch: MessageBatch<unknown>, env: Env) {
  for (const message of batch.messages) {
    try {
      const work = await parseMessage(env, message.body);
      if (!work) {
        // A malformed message can never succeed; retrying would only burn the
        // retry budget and then drop it silently.
        log.error("queue_message_malformed", "dropped", { id: message.id });
        message.ack();
        continue;
      }
      await store(env, work.event, work.usage);
      message.ack();
    } catch (err) {
      log.error("queue_message_failed", err, { id: message.id, attempts: message.attempts });
      message.retry({ delaySeconds: Math.min(MAX_RETRY_DELAY_SECONDS, 2 ** message.attempts) });
    }
  }
}

async function parseMessage(env: Env, body: unknown) {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;

  if (raw.type === "security_log") {
    // Events queued by earlier deploys carry the raw key instead of an ID.
    const event = "apiKey" in raw ? await fromLegacyEvent(env, raw) : raw;
    if (!isSecurityEvent(event)) return null;
    const countsTowardUsage = event.reason === null || event.reason === "rate_limit_exceeded";
    return {
      event,
      usage:
        event.apiKeyId !== null && countsTowardUsage
          ? { apiKeyId: event.apiKeyId, tenantId: event.tenantId, blocked: event.allowed ? 0 : 1 }
          : null,
    };
  }

  // The oldest shape: { apiKey, blocked }, a usage counter only.
  if (typeof raw.apiKey !== "string" || typeof raw.blocked !== "number") return null;
  const key = await findLegacyKey(env, raw.apiKey);
  return {
    event: null,
    // logs_summary.tenant_id is NOT NULL; tenant-less accounts aren't counted.
    usage: key?.tenantId ? { apiKeyId: key.apiKeyId, tenantId: key.tenantId, blocked: raw.blocked ? 1 : 0 } : null,
  };
}

async function fromLegacyEvent(env: Env, { apiKey, ...rest }: Record<string, unknown>) {
  const key = typeof apiKey === "string" && apiKey ? apiKey : null;
  const owner = key ? await findLegacyKey(env, key) : null;
  return { ...rest, apiKeyId: owner?.apiKeyId ?? null, apiKeyHint: key ? maskApiKey(key) : null };
}

async function findLegacyKey(env: Env, apiKey: string) {
  return env.DB.prepare(`
    SELECT a.id AS apiKeyId, u.tenant_id AS tenantId
    FROM api_keys a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.key_hash = ?1 OR a.legacy_key = ?2
    LIMIT 1
  `)
    .bind(await hashApiKey(apiKey), apiKey)
    .first<{ apiKeyId: number; tenantId: string | null }>();
}

function isSecurityEvent(event: Record<string, unknown>): event is Record<string, unknown> & SecurityEvent {
  const nullableString = (v: unknown) => v === null || typeof v === "string";
  return (
    typeof event.tenantId === "string" &&
    typeof event.route === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.allowed === "boolean" &&
    Number.isFinite(event.remaining) &&
    Number.isFinite(event.retryAfter) &&
    (event.apiKeyId === null || Number.isInteger(event.apiKeyId)) &&
    [event.apiKeyHint, event.ipAddress, event.country, event.colo, event.userAgent, event.reason].every(
      nullableString,
    )
  );
}

async function store(env: Env, event: SecurityEvent | null, usage: UsageUpdate | null) {
  const statements: D1PreparedStatement[] = [];

  if (event) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO security_logs (
          tenant_id, api_key_hint, route, ip_address, country, colo, user_agent,
          allowed, remaining, retry_after, reason, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        event.tenantId,
        event.apiKeyHint ?? "", // column is NOT NULL; "" means no key was sent
        event.route,
        event.ipAddress,
        event.country,
        event.colo,
        event.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        event.allowed ? 1 : 0,
        event.remaining,
        event.retryAfter,
        event.reason,
        event.timestamp,
      ),
    );
  }

  if (usage) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO logs_summary (api_key_id, tenant_id, total_requests, blocked_requests)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(api_key_id) DO UPDATE SET
          total_requests   = total_requests + 1,
          blocked_requests = blocked_requests + excluded.blocked_requests,
          updated_at       = CURRENT_TIMESTAMP
      `).bind(usage.apiKeyId, usage.tenantId, usage.blocked),
    );
  }

  // One transaction: if the usage upsert fails the log insert rolls back too,
  // so a retried message doesn't leave a duplicate security_logs row.
  if (statements.length) await env.DB.batch(statements);
}
