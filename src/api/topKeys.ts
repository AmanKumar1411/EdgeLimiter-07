import { Hono } from "hono";
import type { Bindings } from "../types/env";
import { getActiveOwner } from "../utils/apiKeys";

const topKeys = new Hono<{ Bindings: Bindings }>();

topKeys.get("/", async (c) => {
  const caller = await getActiveOwner(c.env, c.req.header("x-api-key"));
  if (!caller) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  /*
   Client → own tenant only
   Super Admin → all tenants, or one via ?tenantId=
  */
  // In the query below NULL means "all tenants", so a client must never
  // reach it without a tenant (legacy accounts have tenant_id NULL).
  if (caller.role !== "super_admin" && !caller.tenant_id) {
    return c.json([]);
  }

  const tenantId =
    caller.role === "super_admin"
      ? c.req.query("tenantId")?.trim() || null
      : caller.tenant_id;

  const result = await c.env.DB.prepare(`
    SELECT
      ak.key_hint,
      ls.tenant_id,
      ls.total_requests,
      ls.blocked_requests
    FROM logs_summary ls
    LEFT JOIN api_keys ak ON ak.id = ls.api_key_id
    WHERE ?1 IS NULL OR ls.tenant_id = ?1
    ORDER BY ls.blocked_requests DESC
    LIMIT 10
  `)
    .bind(tenantId)
    .all();

  const data = result.results.map((row: any) => ({
    apiKey: row.key_hint ?? "••••••••",
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
