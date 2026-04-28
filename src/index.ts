import { Hono } from "hono";
import { cors } from "hono/cors";
import { RateLimiter } from "./durable-objects/RateLimiter";
import metrics from "./api/metrics";
import topKeys from "./api/topKeys";
import { pushToQueue } from "./queue/producer";
import { queue } from "./queue/consumer";
import type { Bindings, Env } from "./types/env";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  algorithm: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-api-key"],
  })
);

app.get("/", (c) => {
  return c.json({
    project: "EdgeLimiter API",
    status: "Live",
    docs: "/health"
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    message: "EdgeLimiter Worker is running",
  });
});

app.post("/register", async (c) => {
  const body = await c.req.json();
  const email = body.email;

  if (!email) {
    return c.json(
      { error: "Email is required" },
      400
    );
  }

  const apiKey =
    "sk_live_" + crypto.randomUUID().replace(/-/g, "");

  await c.env.DB.prepare(`
    INSERT INTO api_keys
    (email, api_key, status)
    VALUES (?, ?, 'active')
  `)
    .bind(email, apiKey)
    .run();

  return c.json({
    success: true,
    email,
    apiKey,
  });
});

/*
CONFIG ROUTE
*/
app.post("/config", async (c) => {
  const body = await c.req.json();

  const tenantId = body.tenantId;
  const route = body.route;
  const limit = body.limit;
  const window = body.window;
  const algorithm =
    body.algorithm || "sliding_window";

  if (
    !tenantId ||
    !route ||
    !limit ||
    !window
  ) {
    return c.json(
      {
        error:
          "tenantId, route, limit, and window are required",
      },
      400
    );
  }

  const configKey = `${tenantId}:${route}`;

  await c.env.CONFIG_KV.put(
    configKey,
    JSON.stringify({
      tenantId,
      route,
      limit,
      window,
      algorithm,
    })
  );

  return c.json({
    success: true,
    message: `Rule saved for ${configKey}`,
    config: {
      tenantId,
      route,
      limit,
      window,
      algorithm,
    },
  });
});

/*
CHECK ROUTE
*/
app.post("/check", async (c) => {
  const apiKey = c.req.header("x-api-key");

  if (!apiKey) {
    return c.json(
      { error: "API key missing" },
      401
    );
  }

  const existingKey = await c.env.DB.prepare(`
    SELECT * FROM api_keys
    WHERE api_key = ?
    AND status = 'active'
  `)
    .bind(apiKey)
    .first();

  if (!existingKey) {
    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  const body = await c.req.json();

  const tenantId = body.tenantId;
  const route = body.route;

  if (!tenantId || !route) {
    return c.json(
      {
        error: "tenantId and route are required",
      },
      400
    );
  }

  const configKey = `${tenantId}:${route}`;

  const config = await c.env.CONFIG_KV.get(configKey);

  if (!config) {
    return c.json(
      {
        error: `No config found for ${configKey}`,
      },
      404
    );
  }

  const parsedConfig = JSON.parse(config);

  const id = c.env.RATE_LIMITER.idFromName(configKey);
  const stub = c.env.RATE_LIMITER.get(id);

  const response = await stub.fetch(
    "http://do/check",
    {
      method: "POST",
      body: JSON.stringify({
        limit: parsedConfig.limit,
        window: parsedConfig.window,
        algorithm: parsedConfig.algorithm,
      }),
    }
  );

  const result =
    (await response.json()) as RateLimitResult;

  await pushToQueue(
    c.env,
    apiKey,
    result.allowed ? 0 : 1
  );
  c.executionCtx.waitUntil(
    Promise.resolve(
      c.env.ANALYTICS.writeDataPoint({
        blobs: [
          apiKey,
          tenantId,
          route,
          result.algorithm,
        ],
        doubles: [
          result.allowed ? 1 : 0,
        ],
        indexes: [
          apiKey,
        ],
      })
    )
  );

  return c.json(
    {
      tenant: tenantId,
      route,
      configKey,
      ...result,
    },
    result.allowed ? 200 : 429,
    {
      "X-RateLimit-Limit": String(parsedConfig.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(
        Math.floor(Date.now() / 1000) +
          parsedConfig.window
      ),
      ...(result.retryAfter > 0 && {
        "Retry-After": String(
          Math.ceil(result.retryAfter)
        ),
      }),
    }
  );
});

app.route("/metrics", metrics);
app.route("/top-keys", topKeys);
app.get("/run-report", async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT
      api_key,
      total_requests,
      blocked_requests
    FROM logs_summary
    ORDER BY blocked_requests DESC
    LIMIT 1
  `).first();

  if (!result) {
    return c.json({
      message: "No usage data found."
    });
  }

  const totalRequests = Number(
    result.total_requests || 0
  );

  const blockedRequests = Number(
    result.blocked_requests || 0
  );

  const abuseScore =
    totalRequests > 0
      ? (
          (blockedRequests / totalRequests) * 100
        ).toFixed(2)
      : "0";

  const recommendation =
    Number(abuseScore) > 70
      ? "Temporary block recommended"
      : "Monitor traffic";

  return c.json({
    report: "Daily Abuse Report",
    topApiKey: result.api_key,
    totalRequests,
    blockedRequests,
    abuseScore: `${abuseScore}%`,
    recommendation,
  });
});

export { RateLimiter };

export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<any>,
    env: Env,
    ctx: ExecutionContext
  ) {
    for (const message of batch.messages) {
      const { apiKey, blocked } =
        message.body;

      const existingLog =
        await env.DB.prepare(`
          SELECT * FROM logs_summary
          WHERE api_key = ?
        `)
          .bind(apiKey)
          .first();

      if (existingLog) {
        await env.DB.prepare(`
          UPDATE logs_summary
          SET
            total_requests = total_requests + 1,
            blocked_requests =
              blocked_requests + ?,
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

      message.ack();
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ) {
    console.log("Running daily abuse analysis...");

    const result = await env.DB.prepare(`
      SELECT
        api_key,
        total_requests,
        blocked_requests
      FROM logs_summary
      ORDER BY blocked_requests DESC
      LIMIT 1
    `).first();

    if (!result) {
      console.log("No usage data found.");
      return;
    }

    const totalRequests = Number(
      result.total_requests || 0
    );

    const blockedRequests = Number(
      result.blocked_requests || 0
    );

    const abuseScore =
      totalRequests > 0
        ? (
            (blockedRequests / totalRequests) * 100
          ).toFixed(2)
        : "0";

    console.log(`
=== Daily Abuse Report ===

Top API Key: ${result.api_key}

Total Requests: ${totalRequests}

Blocked Requests: ${blockedRequests}

Abuse Score: ${abuseScore}%

Recommendation:
${
  Number(abuseScore) > 70
    ? "Temporary block recommended"
    : "Monitor traffic"
}
==========================
    `);
  },
};