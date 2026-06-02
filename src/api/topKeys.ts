import { Hono } from "hono";
import type { Bindings } from "../types/env";

const topKeys = new Hono<{ Bindings: Bindings }>();

function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 12) + "••••" + key.slice(-4);
}

topKeys.get("/", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      ls.api_key,
      u.tenant_id,
      ls.total_requests,
      ls.blocked_requests
    FROM logs_summary ls
    LEFT JOIN api_keys ak ON ak.api_key = ls.api_key
    LEFT JOIN users u ON u.id = ak.user_id
    ORDER BY ls.blocked_requests DESC
    LIMIT 10
  `).all();

  const data = result.results.map((row: any) => ({
    apiKey: maskKey(String(row.api_key)),
    tenantId: row.tenant_id ?? null,
    totalRequests: Number(row.total_requests),
    blockedRequests: Number(row.blocked_requests),
    abuseScore:
      row.total_requests > 0
        ? parseFloat(
            ((row.blocked_requests / row.total_requests) * 100).toFixed(2)
          )
        : 0,
  }));

  return c.json(data);
});

export default topKeys;
