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

type LoginUserRow = {
  id: number;
  email: string;
  password: string;
  role: string;
  tenant_id: string;
  api_key: string;
};

const app = new Hono<{ Bindings: Bindings }>();

function isValidRole(role: string | undefined) {
  return role === "client" || role === "super_admin";
}

function toHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string) {
  const input = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return toHex(digest);
}

async function getUserByApiKey(env: Env, apiKey: string) {
  return env.DB.prepare(
    `
      SELECT
        u.id,
        u.email,
        u.role,
        u.tenant_id,
        a.api_key,
        a.status
      FROM api_keys a
      INNER JOIN users u ON u.id = a.user_id
      WHERE a.api_key = ?
      LIMIT 1
    `
  )
    .bind(apiKey)
    .first<{
      id: number;
      email: string;
      role: string;
      tenant_id: string;
      api_key: string;
      status: string;
    }>();
}

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
  const body = (await c.req.json()) as {
    email?: string;
    password?: string;
    tenantId?: string;
    role?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const tenantId = body.tenantId?.trim().toLowerCase();
  const role = body.role?.trim().toLowerCase() || "client";

  if (!email || !password || !tenantId) {
    return c.json(
      {
        error: "email, password, and tenantId are required",
      },
      400
    );
  }

  if (role !== "client") {
    return c.json(
      {
        error: "Public registration only supports role=client",
      },
      400
    );
  }

  if (!isValidRole(role)) {
    return c.json(
      {
        error: "Invalid role",
      },
      400
    );
  }

  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email = ? LIMIT 1`
  )
    .bind(email)
    .first();

  if (existing) {
    return c.json(
      {
        error: "Email already registered",
      },
      409
    );
  }

  const passwordHash = await hashPassword(password);

  const userInsert = await c.env.DB.prepare(`
    INSERT INTO users (email, password, role, tenant_id)
    VALUES (?, ?, ?, ?)
  `)
    .bind(email, passwordHash, role, tenantId)
    .run();

  const userId = userInsert.meta.last_row_id;
  const apiKey = "sk_live_" + crypto.randomUUID().replace(/-/g, "");

  await c.env.DB.prepare(`
    INSERT INTO api_keys (user_id, api_key, status)
    VALUES (?, ?, 'active')
  `)
    .bind(userId, apiKey)
    .run();

  return c.json({
    success: true,
    email,
    tenantId,
    role,
    apiKey,
  });
});

app.post("/login", async (c) => {
  const body = (await c.req.json()) as {
    email?: string;
    password?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  if (!email || !password) {
    return c.json(
      {
        error: "email and password are required",
      },
      400
    );
  }

  const user = await c.env.DB.prepare(
    `
      SELECT
        u.id,
        u.email,
        u.password,
        u.role,
        u.tenant_id,
        a.api_key
      FROM users u
      LEFT JOIN api_keys a
        ON a.user_id = u.id
        AND a.status = 'active'
      WHERE u.email = ?
      ORDER BY a.id DESC
      LIMIT 1
    `
  )
    .bind(email)
    .first<LoginUserRow>();

  if (!user) {
    return c.json(
      {
        error: "Invalid credentials",
      },
      401
    );
  }

  const passwordHash = await hashPassword(password);
  if (passwordHash !== user.password) {
    return c.json(
      {
        error: "Invalid credentials",
      },
      401
    );
  }

  if (!user.api_key) {
    const generatedApiKey = "sk_live_" + crypto.randomUUID().replace(/-/g, "");
    await c.env.DB.prepare(
      `INSERT INTO api_keys (user_id, api_key, status) VALUES (?, ?, 'active')`
    )
      .bind(user.id, generatedApiKey)
      .run();
    user.api_key = generatedApiKey;
  }

  return c.json({
    success: true,
    role: user.role,
    tenantId: user.tenant_id,
    apiKey: user.api_key,
    email: user.email,
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

  const apiKey = c.req.header("x-api-key");
  if (apiKey) {
    const owner = await getUserByApiKey(c.env, apiKey);
    if (!owner || owner.status !== "active") {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (owner.role === "client" && owner.tenant_id !== tenantId) {
      return c.json({ error: "Forbidden for this tenant" }, 403);
    }
  }

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

app.get("/client/metrics", async (c) => {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) {
    return c.json({ error: "API key missing" }, 401);
  }

  const owner = await getUserByApiKey(c.env, apiKey);
  if (!owner || owner.status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await c.env.DB.prepare(
    `
      SELECT
        total_requests,
        blocked_requests
      FROM logs_summary
      WHERE api_key = ?
      LIMIT 1
    `
  )
    .bind(apiKey)
    .first<{ total_requests: number; blocked_requests: number }>();

  const totalRequests = Number(result?.total_requests || 0);
  const blockedRequests = Number(result?.blocked_requests || 0);
  const blockRate =
    totalRequests > 0
      ? ((blockedRequests / totalRequests) * 100).toFixed(2)
      : "0";

  return c.json({
    totalRequests,
    blockedRequests,
    blockRate: `${blockRate}%`,
  });
});

app.get("/client/report", async (c) => {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) {
    return c.json({ error: "API key missing" }, 401);
  }

  const owner = await getUserByApiKey(c.env, apiKey);
  if (!owner || owner.status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const result = await c.env.DB.prepare(
    `
      SELECT
        total_requests,
        blocked_requests
      FROM logs_summary
      WHERE api_key = ?
      LIMIT 1
    `
  )
    .bind(apiKey)
    .first<{ total_requests: number; blocked_requests: number }>();

  const totalRequests = Number(result?.total_requests || 0);
  const blockedRequests = Number(result?.blocked_requests || 0);

  const abuseScore =
    totalRequests > 0
      ? ((blockedRequests / totalRequests) * 100).toFixed(2)
      : "0";

  const recommendation =
    Number(abuseScore) > 70
      ? "Temporary block recommended"
      : "Monitor traffic";

  return c.json({
    report: "Tenant Abuse Report",
    topApiKey: apiKey,
    totalRequests,
    blockedRequests,
    abuseScore: `${abuseScore}%`,
    recommendation,
  });
});

app.post("/reset", async (c) => {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) {
    return c.json({ error: "API key missing" }, 401);
  }

  const owner = await getUserByApiKey(c.env, apiKey);
  if (!owner || owner.status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = (await c.req.json()) as {
    tenantId?: string;
    route?: string;
  };

  const tenantId = body.tenantId?.trim();
  const route = body.route?.trim();

  if (!tenantId || !route) {
    return c.json({ error: "tenantId and route are required" }, 400);
  }

  if (owner.role === "client" && owner.tenant_id !== tenantId) {
    return c.json({ error: "Forbidden for this tenant" }, 403);
  }

  const configKey = `${tenantId}:${route}`;
  const id = c.env.RATE_LIMITER.idFromName(configKey);
  const stub = c.env.RATE_LIMITER.get(id);
  const response = await stub.fetch("http://do/reset", { method: "DELETE" });

  if (!response.ok) {
    return c.json({ error: "Failed to reset counters" }, 500);
  }

  return c.json({
    success: true,
    message: `Counter reset for ${configKey}`,
  });
});
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