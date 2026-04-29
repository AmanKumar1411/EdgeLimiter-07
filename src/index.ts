import { Hono } from "hono";
import { cors } from "hono/cors";
import { RateLimiter } from "./durable-objects/RateLimiter";
import metrics from "./api/metrics";
import topKeys from "./api/topKeys";
import { pushToQueue } from "./queue/producer";
import { createAuditLog } from "./utils/audit";
import {
  ensureSecurityLogsTable,
  queue as consumeQueue,
} from "./queue/consumer";
import { generateAttackIntelligence } from "./security/intelligence";
import type { Bindings, Env } from "./types/env";
import type {
  SecurityLogEvent,
  SecurityLogRow,
  SecurityQueueEvent,
  TopAbusiveIpRow,
} from "./types/security";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  algorithm: string;
};

type ResetResult = {
  success: boolean;
  message: string;
};

type CheckRequestBody = {
  tenantId?: string;
  route?: string;
};

type RequestSecurityMetadata = Pick<
  SecurityLogEvent,
  "ipAddress" | "country" | "colo" | "userAgent"
>;


const app = new Hono<{ Bindings: Bindings }>();

function isValidRole(role: string | undefined) {
  return role === "client" || role === "super_admin";
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

function getRequestSecurityMetadata(
  request: Request
): RequestSecurityMetadata {
  const cf = request.cf as
    | { country?: unknown; colo?: unknown }
    | undefined;

  return {
    ipAddress:
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for"),
    country:
      typeof cf?.country === "string"
        ? cf.country
        : null,
    colo:
      typeof cf?.colo === "string"
        ? cf.colo
        : null,
    userAgent: request.headers.get("user-agent"),
  };
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
    tenantId?: string;
    role?: string;
  };

  const email = body.email?.trim().toLowerCase();
  const tenantId = body.tenantId?.trim().toLowerCase();
  const role = body.role?.trim().toLowerCase() || "client";

  if (!email || !tenantId) {
    return c.json(
      {
        error: "email and tenantId are required",
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

  const userInsert = await c.env.DB.prepare(`
    INSERT INTO users(
  email,
  role,
  tenant_id
)
VALUES(?, ?, ?)
  `)
    .bind(
      email,
      role,
      tenantId
    )
    .run();

  const userId = userInsert.meta.last_row_id;

  const apiKey =
    "sk_live_" +
    crypto.randomUUID().replace(/-/g, "");

  await c.env.DB.prepare(`
    INSERT INTO api_keys(
    user_id,
    api_key,
    status
  )
VALUES(?, ?, 'active')
  `)
    .bind(
      userId,
      apiKey
    )
    .run();

  return c.json({
    success: true,
    email,
    tenantId,
    role,
    apiKey,
  });
});


/*
CONFIG ROUTE
*/
app.post("/config", async (c) => {
  const body = await c.req.json();

  const tenantId =
    typeof body.tenantId === "string"
      ? body.tenantId.trim()
      : "";

  const route =
    typeof body.route === "string"
      ? body.route.trim()
      : "";

  const limit = Number(body.limit);
  const window = Number(body.window);

  const algorithm =
    body.algorithm || "sliding_window";

  const apiKey = c.req.header("x-api-key");

  /*
   API key is mandatory for config creation
  */
  if (!apiKey) {
    return c.json(
      { error: "API key missing" },
      401
    );
  }

  /*
   Validate API key ownership
  */
  const owner = await getUserByApiKey(
    c.env,
    apiKey
  );

  if (!owner || owner.status !== "active") {
    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  /*
   Required field validation
  */
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

  /*
   Prevent client cross-tenant access
   Client → only own tenant
   Super Admin → all tenants allowed
  */
  if (
    owner.role !== "super_admin" &&
    owner.tenant_id !== tenantId
  ) {
    return c.json(
      {
        error:
          "Forbidden for this tenant",
      },
      403
    );
  }

  const configKey = `${tenantId}:${route}`;

  /*
   Save config to KV
  */
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

  /*
   NEW:
   Create persistent audit log
  */
  c.executionCtx.waitUntil(
    createAuditLog(c.env, {
      tenantId,
      apiKey,
      route,
      actor:
        owner.role === "super_admin"
          ? "admin"
          : "client",
      actionType: "policy_created",
      message: `Rate limit policy created for route ${route} with limit ${limit}/${window}s`,
      severity: "Medium",
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
// Put this helper ABOVE app.post("/check")

async function queueCheckSecurityLog(
  env: Env,
  metadata: {
    ipAddress: string | null;
    country: string | null;
    colo: string | null;
    userAgent: string | null;
  },
  payload: {
    tenantId: string;
    apiKey: string;
    route: string;
    allowed: boolean;
    remaining: number;
    retryAfter: number;
    reason: string | null;
  }
) {
  await env.LOG_QUEUE.send({
    type: "security_log",

    tenantId: payload.tenantId,
    apiKey: payload.apiKey,
    route: payload.route,

    ipAddress: metadata.ipAddress || "unknown",
    country: metadata.country || "unknown",
    colo: metadata.colo || "unknown",
    userAgent: metadata.userAgent || "unknown",

    allowed: payload.allowed,
    remaining: payload.remaining,
    retryAfter: payload.retryAfter,

    reason: payload.reason ?? null,

    timestamp: new Date().toISOString(),
  });
}
/*
CHECK ROUTE
*/

app.post("/check", async (c) => {
  const metadata = getRequestSecurityMetadata(c.req.raw);
  const apiKey = c.req.header("x-api-key");

  let body: CheckRequestBody;

  try {
    body = (await c.req.json()) as CheckRequestBody;
  } catch {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId: "",
        apiKey: apiKey || "",
        route: "",
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "invalid_request_body",
      })
    );

    return c.json(
      { error: "Invalid JSON body" },
      400
    );
  }

  const tenantId =
    typeof body.tenantId === "string"
      ? body.tenantId.trim()
      : "";

  const route =
    typeof body.route === "string"
      ? body.route.trim()
      : "";

  if (!apiKey) {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId,
        apiKey: "",
        route,
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "api_key_missing",
      })
    );

    return c.json(
      { error: "API key missing" },
      401
    );
  }

  /*
   Validate:
   1. API key exists
   2. API key belongs to correct tenant
  */
  const existingKey = await c.env.DB.prepare(`
    SELECT
      ak.*,
      u.tenant_id
    FROM api_keys ak
    JOIN users u
      ON ak.user_id = u.id
    WHERE ak.api_key = ?
      AND ak.status = 'active'
  `)
    .bind(apiKey)
    .first();

  if (!existingKey) {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId,
        apiKey,
        route,
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "unauthorized_api_key",
      })
    );

    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  /*
   Prevent cross-tenant abuse
  */
  if (existingKey.tenant_id !== tenantId) {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId,
        apiKey,
        route,
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "tenant_mismatch",
      })
    );

    return c.json(
      { error: "Tenant mismatch" },
      403
    );
  }

  if (!tenantId || !route) {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId,
        apiKey,
        route,
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "tenant_route_missing",
      })
    );

    return c.json(
      {
        error: "tenantId and route are required",
      },
      400
    );
  }

  const configKey = `${tenantId}:${route}`;

  const config =
    await c.env.CONFIG_KV.get(configKey);

  if (!config) {
    c.executionCtx.waitUntil(
      queueCheckSecurityLog(c.env, metadata, {
        tenantId,
        apiKey,
        route,
        allowed: false,
        remaining: 0,
        retryAfter: 0,
        reason: "config_not_found",
      })
    );

    return c.json(
      {
        error: `No config found for ${configKey}`,
      },
      404
    );
  }

  const parsedConfig = JSON.parse(config);

  const id =
    c.env.RATE_LIMITER.idFromName(configKey);

  const stub =
    c.env.RATE_LIMITER.get(id);

  const response = await stub.fetch(
    "http://do/check",
    {
      method: "POST",
      body: JSON.stringify({
        limit: parsedConfig.limit,
        window: parsedConfig.window,
        algorithm:
          parsedConfig.algorithm,
      }),
    }
  );

  const result =
    (await response.json()) as RateLimitResult;

  /*
   Existing security queue log
  */
  c.executionCtx.waitUntil(
    queueCheckSecurityLog(c.env, metadata, {
      tenantId,
      apiKey,
      route,
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfter: result.retryAfter,
      reason: result.allowed
        ? null
        : "rate_limit_exceeded",
    })
  );

  /*
   NEW:
   Persistent audit timeline entry
  */
  if (!result.allowed) {
    c.executionCtx.waitUntil(
      createAuditLog(c.env, {
        tenantId,
        apiKey,
        route,
        actor: "system",
        actionType: "rate_limit_block",
        message: `Blocked repeated abuse from IP ${metadata.ipAddress} on route ${route}`,
        severity: "High",
      })
    );
  }

  /*
   Analytics Engine
  */
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
        indexes: [apiKey],
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
      "X-RateLimit-Limit": String(
        parsedConfig.limit
      ),
      "X-RateLimit-Remaining": String(
        result.remaining
      ),
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

app.get("/security-report", async (c) => {
  const apiKey = c.req.header("x-api-key");
  const tenantId = c.req.query("tenantId")?.trim();

  if (!apiKey) {
    return c.json({ error: "API key missing" }, 401);
  }

  if (!tenantId) {
    return c.json(
      { error: "tenantId is required" },
      400
    );
  }

  const owner = await getUserByApiKey(c.env, apiKey);
  if (!owner || owner.status !== "active") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (owner.role === "client" && owner.tenant_id !== tenantId) {
    return c.json({ error: "Forbidden for this tenant" }, 403);
  }

  await ensureSecurityLogsTable(c.env);

  const recentLogsResult = await c.env.DB.prepare(`
    SELECT
      id,
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
    FROM security_logs
    WHERE tenant_id = ?
    ORDER BY datetime(created_at) DESC
    LIMIT 50
  `)
    .bind(tenantId)
    .all<SecurityLogRow>();

  const recentLogs =
    recentLogsResult.results ?? [];

  const topIpResult = await c.env.DB.prepare(`
    WITH tenant_ips AS (
      SELECT DISTINCT ip_address
      FROM security_logs
      WHERE tenant_id = ?
        AND ip_address IS NOT NULL
        AND ip_address <> ''
    )
    SELECT
      l.ip_address,
      MAX(l.country) AS country,
      MAX(l.colo) AS colo,
      COUNT(*) AS total_requests,
      SUM(CASE WHEN l.allowed = 0 THEN 1 ELSE 0 END) AS blocked_requests,
      SUM(CASE WHEN l.tenant_id = ? THEN 1 ELSE 0 END) AS tenant_requests,
      SUM(CASE WHEN l.tenant_id = ? AND l.allowed = 0 THEN 1 ELSE 0 END) AS tenant_blocked_requests,
      COUNT(DISTINCT l.tenant_id) AS tenant_count,
      MAX(l.created_at) AS last_seen
    FROM security_logs l
    INNER JOIN tenant_ips ti
      ON ti.ip_address = l.ip_address
    WHERE l.created_at >= datetime('now', '-24 hours')
    GROUP BY l.ip_address
    ORDER BY tenant_blocked_requests DESC,
      blocked_requests DESC,
      total_requests DESC
    LIMIT 10
  `)
    .bind(tenantId, tenantId, tenantId)
    .all<TopAbusiveIpRow>();

  const topAbusiveIps = (
    topIpResult.results ?? []
  ).map((row) => ({
    ipAddress: row.ip_address,
    country: row.country,
    colo: row.colo,
    totalRequests: Number(row.total_requests || 0),
    blockedRequests: Number(row.blocked_requests || 0),
    tenantRequests: Number(row.tenant_requests || 0),
    tenantBlockedRequests: Number(
      row.tenant_blocked_requests || 0
    ),
    tenantCount: Number(row.tenant_count || 0),
    lastSeen: row.last_seen,
  }));

  const intelligence =
    await generateAttackIntelligence(
      c.env,
      tenantId,
      recentLogs,
      topIpResult.results ?? []
    );

  return c.json({
    tenantId,
    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      tenantId: log.tenant_id,
      apiKey: log.api_key,
      route: log.route,
      ipAddress: log.ip_address,
      country: log.country,
      colo: log.colo,
      userAgent: log.user_agent,
      allowed: Boolean(log.allowed),
      remaining: Number(log.remaining || 0),
      retryAfter: Number(log.retry_after || 0),
      reason: log.reason,
      createdAt: log.created_at,
    })),
    topAbusiveIps,
    aiSummary: intelligence.aiSummary,
    abuseScore: intelligence.abuseScore,
    recommendation: intelligence.recommendation,
  });
});

app.post("/reset", async (c) => {
  const apiKey = c.req.header("x-api-key");

  /*
   API key required
  */
  if (!apiKey) {
    return c.json(
      { error: "API key missing" },
      401
    );
  }

  /*
   Validate API key ownership
  */
  const owner = await getUserByApiKey(
    c.env,
    apiKey
  );

  if (!owner || owner.status !== "active") {
    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  const body = (await c.req.json()) as {
    tenantId?: string;
    route?: string;
  };

  const tenantId =
    typeof body.tenantId === "string"
      ? body.tenantId.trim()
      : "";

  const route =
    typeof body.route === "string"
      ? body.route.trim()
      : "";

  /*
   Required fields validation
  */
  if (!tenantId || !route) {
    return c.json(
      {
        error:
          "tenantId and route are required",
      },
      400
    );
  }

  /*
   Prevent client cross-tenant reset
   Client → only own tenant
   Super Admin → all tenants allowed
  */
  if (
    owner.role !== "super_admin" &&
    owner.tenant_id !== tenantId
  ) {
    return c.json(
      {
        error:
          "Forbidden for this tenant",
      },
      403
    );
  }

  const configKey = `${tenantId}:${route}`;

  const id =
    c.env.RATE_LIMITER.idFromName(configKey);

  const stub =
    c.env.RATE_LIMITER.get(id);

  /*
   Durable Object reset call
  */
  const response = await stub.fetch(
    "http://do/reset",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        type: "reset",
        tenantId,
        route,
      }),
    }
  );

  if (!response.ok) {
    return c.json(
      {
        error:
          "Failed to reset counters",
      },
      500
    );
  }

  const result =
    (await response.json()) as ResetResult;

  /*
   NEW:
   Persistent audit log
  */
  c.executionCtx.waitUntil(
    createAuditLog(c.env, {
      tenantId,
      apiKey,
      route,
      actor:
        owner.role === "super_admin"
          ? "admin"
          : "client",
      actionType: "rate_limit_reset",
      message: `Rate limiter manually reset for route ${route}`,
      severity: "High",
    })
  );

  return c.json({
    success: true,
    tenantId,
    route,
    ...result,
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

app.get("/audit-report", async (c) => {
  const apiKey = c.req.header("x-api-key");
  const tenantId =
    c.req.query("tenantId")?.trim() || "";

  if (!apiKey) {
    return c.json(
      { error: "API key missing" },
      401
    );
  }

  if (!tenantId) {
    return c.json(
      { error: "tenantId is required" },
      400
    );
  }

  /*
   Validate API key + tenant ownership
  */
  const existingKey = await c.env.DB.prepare(`
    SELECT
      ak.*,
      u.tenant_id,
      u.role
    FROM api_keys ak
    JOIN users u
      ON ak.user_id = u.id
    WHERE ak.api_key = ?
      AND ak.status = 'active'
  `)
    .bind(apiKey)
    .first();

  if (!existingKey) {
    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  /*
   Client can only access own tenant
   Admin can access all
  */
  if (
    existingKey.role !== "super_admin" &&
    existingKey.tenant_id !== tenantId
  ) {
    return c.json(
      { error: "Forbidden" },
      403
    );
  }

  const logs = await c.env.DB.prepare(`
    SELECT
      id,
      tenant_id,
      api_key,
      route,
      actor,
      action_type,
      message,
      severity,
      created_at
    FROM audit_logs
    WHERE tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 50
  `)
    .bind(tenantId)
    .all();

  return c.json({
    tenantId,
    auditLogs: logs.results || [],
  });
});

export { RateLimiter };

export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<SecurityQueueEvent>,
    env: Env,
    ctx: ExecutionContext
  ) {
    await consumeQueue(batch, env);
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
