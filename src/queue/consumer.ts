import type { Env } from "../types/env";
import type {
  LegacyQueueEvent,
  LegacySecurityLogEvent,
  SecurityLogEvent,
} from "../types/security";
import { hashApiKey, maskApiKey } from "../utils/apiKeys";

const MAX_USER_AGENT_LENGTH = 512;
const MAX_RETRY_DELAY_SECONDS = 300;

type SummaryUpdate = {
  apiKeyId: number;
  tenantId: string;
  blocked: number;
};

type QueueWork = {
  log: SecurityLogEvent | null;
  summary: SummaryUpdate | null;
};

export async function queue(
  batch: MessageBatch<unknown>,
  env: Env
) {
  for (const message of batch.messages) {
    try {
      const work = await toWork(env, message.body);

      if (!work) {
        // Malformed messages can never succeed; retrying would only burn
        // the retry budget and then drop them silently.
        console.error("Dropping malformed queue message", {
          id: message.id,
        });
        message.ack();
        continue;
      }

      await applyWork(env, work);
      message.ack();
    } catch (err) {
      // Retry this message independently; don't let one failure
      // block acking already-processed messages in the same batch.
      console.error("Queue message processing failed:", err);
      message.retry({
        delaySeconds: Math.min(
          MAX_RETRY_DELAY_SECONDS,
          2 ** message.attempts
        ),
      });
    }
  }
}

async function toWork(
  env: Env,
  body: unknown
): Promise<QueueWork | null> {
  if (!body || typeof body !== "object") return null;

  const event = body as Record<string, unknown>;

  if (event.type === "security_log") {
    const log =
      "apiKey" in event
        ? await fromLegacySecurityLog(
            env,
            event as unknown as LegacySecurityLogEvent
          )
        : (event as unknown as SecurityLogEvent);

    if (!isValidSecurityLog(log)) return null;

    return {
      log,
      summary:
        log.apiKeyId !== null && countsTowardUsage(log)
          ? {
              apiKeyId: log.apiKeyId,
              tenantId: log.tenantId,
              blocked: log.allowed ? 0 : 1,
            }
          : null,
    };
  }

  // Oldest shape: { apiKey, blocked } — usage counter only.
  const legacy = event as Partial<LegacyQueueEvent>;
  if (typeof legacy.apiKey !== "string" || typeof legacy.blocked !== "number") {
    return null;
  }

  const key = await resolveLegacyKey(env, legacy.apiKey);
  return {
    log: null,
    // logs_summary.tenant_id is NOT NULL; tenant-less legacy accounts
    // can't be attributed, so their usage isn't counted.
    summary:
      key && key.tenantId
        ? {
            apiKeyId: key.apiKeyId,
            tenantId: key.tenantId,
            blocked: legacy.blocked ? 1 : 0,
          }
        : null,
  };
}

async function fromLegacySecurityLog(
  env: Env,
  event: LegacySecurityLogEvent
): Promise<SecurityLogEvent> {
  const { apiKey, ...rest } = event;
  const key = apiKey ? await resolveLegacyKey(env, apiKey) : null;

  return {
    ...rest,
    apiKeyId: key?.apiKeyId ?? null,
    apiKeyHint: apiKey ? maskApiKey(apiKey) : null,
  };
}

async function resolveLegacyKey(env: Env, apiKey: string) {
  const row = await env.DB.prepare(`
    SELECT a.id AS apiKeyId, u.tenant_id AS tenantId
    FROM api_keys a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.key_hash = ?1 OR a.legacy_key = ?2
    LIMIT 1
  `)
    .bind(await hashApiKey(apiKey), apiKey)
    .first<{ apiKeyId: number; tenantId: string | null }>();

  return row ?? null;
}

function isValidSecurityLog(event: SecurityLogEvent) {
  const nullableString = (v: unknown) => v === null || typeof v === "string";

  return (
    typeof event.tenantId === "string" &&
    typeof event.route === "string" &&
    typeof event.timestamp === "string" &&
    typeof event.allowed === "boolean" &&
    Number.isFinite(event.remaining) &&
    Number.isFinite(event.retryAfter) &&
    (event.apiKeyId === null || Number.isInteger(event.apiKeyId)) &&
    nullableString(event.apiKeyHint) &&
    nullableString(event.ipAddress) &&
    nullableString(event.country) &&
    nullableString(event.colo) &&
    nullableString(event.userAgent) &&
    nullableString(event.reason)
  );
}

function countsTowardUsage(event: SecurityLogEvent) {
  return (
    event.reason === null ||
    event.reason === "rate_limit_exceeded"
  );
}

async function applyWork(env: Env, work: QueueWork) {
  const statements: D1PreparedStatement[] = [];

  if (work.log) {
    const event = work.log;

    statements.push(
      env.DB.prepare(`
      INSERT INTO security_logs (
        tenant_id,
        api_key_hint,
        route,
        ip_address,
        country,
        colo,
        user_agent,
        allowed,
        remaining,
        retry_after,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        event.tenantId,
        // Column is NOT NULL; "" means no key was presented.
        event.apiKeyHint ?? "",
        event.route,
        event.ipAddress,
        event.country,
        event.colo,
        event.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
        event.allowed ? 1 : 0,
        event.remaining,
        event.retryAfter,
        event.reason,
        event.timestamp
      )
    );
  }

  if (work.summary) {
    statements.push(logSummaryStatement(env, work.summary));
  }

  if (!statements.length) return;

  // One transaction: if the summary upsert fails, the log insert rolls back
  // too, so a retried message doesn't leave a duplicate security_logs row.
  await env.DB.batch(statements);
}

function logSummaryStatement(env: Env, update: SummaryUpdate) {
  // Atomic upsert — eliminates the SELECT→INSERT race condition that
  // caused duplicate rows and double-counting under concurrent processing.
  return env.DB.prepare(`
    INSERT INTO logs_summary (api_key_id, tenant_id, total_requests, blocked_requests)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(api_key_id) DO UPDATE SET
      total_requests    = total_requests + 1,
      blocked_requests  = blocked_requests + excluded.blocked_requests,
      updated_at        = CURRENT_TIMESTAMP
  `).bind(update.apiKeyId, update.tenantId, update.blocked);
}
