import { readConfig } from "../shared/config";
import type { Env } from "../shared/env";
import { log } from "../shared/log";

interface Totals {
  total_requests: number | null;
  blocked_requests: number | null;
}

function percentage(total: number, blocked: number) {
  return total > 0 ? ((blocked / total) * 100).toFixed(2) : "0";
}

/** Response shape of /metrics and /client/metrics. */
export function toMetrics(row: Totals | null) {
  const totalRequests = Number(row?.total_requests || 0);
  const blockedRequests = Number(row?.blocked_requests || 0);
  return { totalRequests, blockedRequests, blockRate: `${percentage(totalRequests, blockedRequests)}%` };
}

/** Shared by /client/report, /run-report and the daily cron log. */
export function toAbuseReport(report: string, topApiKey: string, row: Totals | null) {
  const { totalRequests, blockedRequests } = toMetrics(row);
  const abuseScore = percentage(totalRequests, blockedRequests);
  return {
    report,
    topApiKey,
    totalRequests,
    blockedRequests,
    abuseScore: `${abuseScore}%`,
    recommendation: Number(abuseScore) > 70 ? "Temporary block recommended" : "Monitor traffic",
  };
}

export function systemTotals(env: Env) {
  return env.DB.prepare(
    "SELECT SUM(total_requests) AS total_requests, SUM(blocked_requests) AS blocked_requests FROM logs_summary",
  ).first<Totals>();
}

export function tenantTotals(env: Env, tenantId: string) {
  return env.DB.prepare(
    `
    SELECT SUM(total_requests) AS total_requests, SUM(blocked_requests) AS blocked_requests
    FROM logs_summary WHERE tenant_id = ?
  `,
  )
    .bind(tenantId)
    .first<Totals>();
}

export function keyTotals(env: Env, apiKeyId: number) {
  return env.DB.prepare("SELECT total_requests, blocked_requests FROM logs_summary WHERE api_key_id = ? LIMIT 1")
    .bind(apiKeyId)
    .first<Totals>();
}

export function topAbuser(env: Env) {
  return env.DB.prepare(
    `
    SELECT ak.key_hint, ls.total_requests, ls.blocked_requests
    FROM logs_summary ls
    LEFT JOIN api_keys ak ON ak.id = ls.api_key_id
    ORDER BY ls.blocked_requests DESC
    LIMIT 1
  `,
  ).first<Totals & { key_hint: string | null }>();
}

/** Top 10 keys by blocked requests; `tenantId` null means all tenants. */
export async function topKeys(env: Env, tenantId: string | null) {
  const { results } = await env.DB.prepare(
    `
    SELECT ak.key_hint, ls.tenant_id, ls.total_requests, ls.blocked_requests
    FROM logs_summary ls
    LEFT JOIN api_keys ak ON ak.id = ls.api_key_id
    WHERE ?1 IS NULL OR ls.tenant_id = ?1
    ORDER BY ls.blocked_requests DESC
    LIMIT 10
  `,
  )
    .bind(tenantId)
    .all<{ key_hint: string | null; tenant_id: string | null; total_requests: number; blocked_requests: number }>();

  return results.map((row) => ({
    apiKey: row.key_hint ?? "••••••••",
    tenantId: row.tenant_id ?? null,
    totalRequests: Number(row.total_requests),
    blockedRequests: Number(row.blocked_requests),
    abuseScore: Number(percentage(row.total_requests, row.blocked_requests)),
  }));
}

/*
 Daily cron: delete security_logs past SECURITY_LOG_RETENTION_DAYS (unset =
 keep everything), in bounded chunks so a large backlog can't exceed D1
 statement limits, then log the day's top abuser.
*/
export async function runDailyMaintenance(env: Env) {
  const { retentionDays } = readConfig(env);
  if (retentionDays) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    let deleted = 0;
    for (let i = 0; i < 50; i++) {
      const { meta } = await env.DB.prepare(
        `
        DELETE FROM security_logs
        WHERE id IN (SELECT id FROM security_logs WHERE created_at < ? LIMIT 5000)
      `,
      )
        .bind(cutoff)
        .run();
      deleted += meta.changes;
      if (meta.changes < 5000) break;
    }
    if (deleted) log.info("security_logs_pruned", { deleted, retentionDays });
  }

  const top = await topAbuser(env);
  if (top) log.info("daily_abuse_report", toAbuseReport("Daily Abuse Report", top.key_hint ?? "••••••••", top));
}
