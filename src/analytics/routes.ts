import { Hono } from "hono";
import { getIntelligence, type IpActivity, type RecentLog } from "../ai/intelligence";
import { authenticate, canAccessTenant } from "../keys/keys";
import type { AppEnv } from "../shared/env";
import { cleanString, MAX_TENANT_ID_LENGTH } from "../shared/validation";
import { keyTotals, systemTotals, tenantTotals, toAbuseReport, toMetrics, topAbuser, topKeys } from "./usage";

interface SecurityLogRow extends RecentLog {
  tenant_id: string;
  api_key_hint: string;
  colo: string | null;
  user_agent: string | null;
  remaining: number;
  retry_after: number;
}

interface IpRow extends IpActivity {
  colo: string | null;
  total_requests: number;
  tenant_requests: number;
  last_seen: string;
}

// The numbers the dashboard shows for each severity.
const SEVERITY_SCORE = { Critical: 95, High: 85, Medium: 55, Low: 20 };

export const analyticsRoutes = new Hono<AppEnv>();

analyticsRoutes.get("/metrics", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  if (owner.role !== "super_admin") return c.json({ error: "Forbidden" }, 403);
  return c.json(toMetrics(await systemTotals(c.env)));
});

/* Tenant totals: clients get their own tenant, super admins any via ?tenantId=. */
analyticsRoutes.get("/client/metrics", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = owner.role === "super_admin" ? c.req.query("tenantId")?.trim() || owner.tenant_id : owner.tenant_id;
  return c.json(toMetrics(tenantId ? await tenantTotals(c.env, tenantId) : null));
});

analyticsRoutes.get("/client/report", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  return c.json(toAbuseReport("Tenant Abuse Report", owner.key_hint, await keyTotals(c.env, owner.key_id)));
});

analyticsRoutes.get("/run-report", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  if (owner.role !== "super_admin") return c.json({ error: "Forbidden" }, 403);
  const top = await topAbuser(c.env);
  if (!top) return c.json({ message: "No usage data found." });
  return c.json(toAbuseReport("Daily Abuse Report", top.key_hint ?? "••••••••", top));
});

analyticsRoutes.get("/top-keys", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  if (owner.role === "super_admin") return c.json(await topKeys(c.env, c.req.query("tenantId")?.trim() || null));
  // In topKeys() null means "all tenants": a client without a tenant gets nothing.
  return c.json(owner.tenant_id ? await topKeys(c.env, owner.tenant_id) : []);
});

analyticsRoutes.get("/security-report", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);
  if (!tenantId) return c.json({ error: "tenantId is required" }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden for this tenant" }, 403);

  // An ISO string, to compare correctly with created_at (stored as ISO-8601).
  // SQLite's datetime() uses a space, which sorts below "T" and silently
  // widened the window to ~48h.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [logs, ips] = await Promise.all([
    c.env.DB.prepare(
      `
      SELECT id, tenant_id, api_key_hint, route, ip_address, country, colo, user_agent,
             allowed, remaining, retry_after, reason, created_at
      FROM security_logs
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `,
    )
      .bind(tenantId)
      .all<SecurityLogRow>(),
    // IPs that hit this tenant in the window, with their traffic to all tenants.
    c.env.DB.prepare(
      `
      WITH tenant_ips AS (
        SELECT DISTINCT ip_address FROM security_logs
        WHERE tenant_id = ?1 AND created_at >= ?2 AND ip_address IS NOT NULL AND ip_address <> ''
      )
      SELECT
        l.ip_address,
        MAX(l.country) AS country,
        MAX(l.colo) AS colo,
        COUNT(*) AS total_requests,
        SUM(CASE WHEN l.allowed = 0 THEN 1 ELSE 0 END) AS blocked_requests,
        SUM(CASE WHEN l.tenant_id = ?1 THEN 1 ELSE 0 END) AS tenant_requests,
        SUM(CASE WHEN l.tenant_id = ?1 AND l.allowed = 0 THEN 1 ELSE 0 END) AS tenant_blocked_requests,
        COUNT(DISTINCT l.tenant_id) AS tenant_count,
        MAX(l.created_at) AS last_seen
      FROM security_logs l
      INNER JOIN tenant_ips ti ON ti.ip_address = l.ip_address
      WHERE l.created_at >= ?2
      GROUP BY l.ip_address
      ORDER BY tenant_blocked_requests DESC, blocked_requests DESC, total_requests DESC
      LIMIT 10
    `,
    )
      .bind(tenantId, since)
      .all<IpRow>(),
  ]);

  const intelligence = await getIntelligence(c.env, c.executionCtx, tenantId, logs.results, ips.results);

  return c.json({
    tenantId,
    recentLogs: logs.results.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      apiKey: row.api_key_hint || null,
      route: row.route,
      ipAddress: row.ip_address,
      country: row.country,
      colo: row.colo,
      userAgent: row.user_agent,
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining || 0),
      retryAfter: Number(row.retry_after || 0),
      reason: row.reason,
      createdAt: row.created_at,
    })),
    topAbusiveIps: ips.results.map((row) => ({
      ipAddress: row.ip_address,
      country: row.country,
      colo: row.colo,
      totalRequests: Number(row.total_requests || 0),
      blockedRequests: Number(row.blocked_requests || 0),
      tenantRequests: Number(row.tenant_requests || 0),
      tenantBlockedRequests: Number(row.tenant_blocked_requests || 0),
      tenantCount: Number(row.tenant_count || 0),
      lastSeen: row.last_seen,
    })),
    aiSummary: intelligence.aiSummary,
    abuseScore: SEVERITY_SCORE[intelligence.abuseScore] ?? 0,
    recommendation: intelligence.recommendation,
    intelligenceSource: intelligence.source,
    generatedAt: intelligence.generatedAt,
  });
});

analyticsRoutes.get("/audit-report", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);
  if (!tenantId) return c.json({ error: "tenantId is required" }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden" }, 403);

  const { results } = await c.env.DB.prepare(
    `
    SELECT id, tenant_id, api_key_hint, route, actor, action_type, message, severity, created_at
    FROM audit_logs
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `,
  )
    .bind(tenantId)
    .all();

  return c.json({ tenantId, auditLogs: results });
});
