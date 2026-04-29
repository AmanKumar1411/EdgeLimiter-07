import type { Env } from "../types/env";
import type {
  SecurityLogEvent,
  SecurityQueueEvent,
} from "../types/security";

export async function queue(
  batch: MessageBatch<SecurityQueueEvent>,
  env: Env
) {
  await ensureSecurityLogsTable(env);

  for (const message of batch.messages) {
    const body = message.body;

    if (isSecurityLogEvent(body)) {
      await storeSecurityLog(env, body);
    } else {
      await updateLogSummary(
        env,
        body.apiKey,
        body.blocked
      );
    }

    message.ack();
  }
}

function isSecurityLogEvent(
  event: SecurityQueueEvent
): event is SecurityLogEvent {
  return "type" in event && event.type === "security_log";
}

export async function ensureSecurityLogsTable(env: Env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      route TEXT NOT NULL,
      ip_address TEXT,
      country TEXT,
      colo TEXT,
      user_agent TEXT,
      allowed INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      retry_after INTEGER NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_security_logs_tenant_created
    ON security_logs (tenant_id, created_at DESC)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_security_logs_ip_created
    ON security_logs (ip_address, created_at DESC)
  `).run();
}

async function storeSecurityLog(
  env: Env,
  event: SecurityLogEvent
) {
  await env.DB.prepare(`
    INSERT INTO security_logs (
      tenant_id,
      api_key,
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
  `)
    .bind(
      event.tenantId,
      event.apiKey,
      event.route,
      event.ipAddress,
      event.country,
      event.colo,
      event.userAgent,
      event.allowed ? 1 : 0,
      event.remaining,
      event.retryAfter,
      event.reason,
      event.timestamp
    )
    .run();

  if (shouldUpdateUsageSummary(event)) {
    await updateLogSummary(
      env,
      event.apiKey,
      event.allowed ? 0 : 1
    );
  }
}

function shouldUpdateUsageSummary(event: SecurityLogEvent) {
  return (
    Boolean(event.apiKey) &&
    (event.reason === null ||
      event.reason === "rate_limit_exceeded")
  );
}

async function updateLogSummary(
  env: Env,
  apiKey: string,
  blocked: number
) {
  if (!apiKey) {
    return;
  }

  const existingLog =
    await env.DB.prepare(
      `SELECT * FROM logs_summary
       WHERE api_key = ?`
    )
      .bind(apiKey)
      .first();

  if (existingLog) {
    await env.DB.prepare(`
      UPDATE logs_summary
      SET
        total_requests = total_requests + 1,
        blocked_requests = blocked_requests + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE api_key = ?
    `)
      .bind(blocked, apiKey)
      .run();
  } else {
    await env.DB.prepare(`
      INSERT INTO logs_summary
      (
        api_key,
        total_requests,
        blocked_requests
      )
      VALUES (?, ?, ?)
    `)
      .bind(apiKey, 1, blocked)
      .run();
  }
}
