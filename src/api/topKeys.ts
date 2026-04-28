import { Hono } from "hono";
import type { Bindings } from "../types/env";

const topKeys = new Hono<{ Bindings: Bindings }>();

topKeys.get("/", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      api_key,
      total_requests,
      blocked_requests
    FROM logs_summary
    ORDER BY blocked_requests DESC
    LIMIT 5
  `).all();

  const data = result.results.map((row: any) => ({
    apiKey: row.api_key,
    totalRequests: row.total_requests,
    blockedRequests: row.blocked_requests,
    abuseScore:
      row.total_requests > 0
        ? (
            (row.blocked_requests / row.total_requests) * 100
          ).toFixed(2) + "%"
        : "0%",
  }));

  return c.json(data);
});

export default topKeys;
