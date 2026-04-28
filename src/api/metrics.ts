import { Hono } from "hono";
import type { Bindings } from "../types/env";

const metrics = new Hono<{ Bindings: Bindings }>();

metrics.get("/", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      SUM(total_requests) as totalRequests,
      SUM(blocked_requests) as blockedRequests
    FROM logs_summary
  `).first();

  const totalRequests = Number(result?.totalRequests || 0);
  const blockedRequests = Number(result?.blockedRequests || 0);

  const blockRate =
    totalRequests > 0
      ? ((blockedRequests / totalRequests) * 100).toFixed(2)
      : "0";

  return c.json({
    totalRequests,
    blockedRequests,
    blockRate: `${blockRate}%`
  });
});

export default metrics;
