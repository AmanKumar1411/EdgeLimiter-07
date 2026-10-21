import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  RateLimiter,
  type RateLimitDecision,
} from "./durable-objects/RateLimiter";
import metrics from "./api/metrics";
import topKeys from "./api/topKeys";
import { pushToQueue } from "./queue/producer";
import { createAuditLog } from "./utils/audit";
import {
  type ApiKeyOwner,
  generateApiKey,
  getActiveOwner,
  hashApiKey,
  maskApiKey,
  MAX_API_KEY_LENGTH,
} from "./utils/apiKeys";
import {
  cleanString,
  isValidEmail,
  limiterKey,
  MAX_IDENTIFIER_LENGTH,
  MAX_ROUTE_LENGTH,
  MAX_TENANT_ID_LENGTH,
  parseStoredPolicy,
  type Policy,
  policyKey,
  TENANT_ID_PATTERN,
  validatePolicyValues,
} from "./utils/validation";
import { queue as consumeQueue } from "./queue/consumer";
import { getSecurityIntelligence } from "./security/intelligence";
import type { Bindings, Env } from "./types/env";
import type {
  SecurityLogEvent,
  SecurityLogRow,
  TopAbusiveIpRow,
} from "./types/security";

type ResetResult = {
  success: boolean;
  message: string;
};

type RequestSecurityMetadata = Pick<
  SecurityLogEvent,
  "ipAddress" | "country" | "colo" | "userAgent"
>;

type AppContext = Context<{ Bindings: Bindings }>;

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ACTIVE_KEYS_PER_USER = 10;

// Public sign-ups per client IP (abuse protection for /register).
const REGISTER_LIMIT = 5;
const REGISTER_WINDOW_SECONDS = 60 * 60;

// DO names for internal limiters start with "\u0000", which validated
// tenant IDs and routes can never contain.
const SYSTEM_LIMITER_PREFIX = "\u0000system:";

const app = new Hono<{ Bindings: Bindings }>();

/*
 Returns the parsed JSON object body, or null when the body
 is missing, malformed, or not an object.
*/
async function readJsonObject(
  c: Context
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch (err) {
    // Streamed (no Content-Length) bodies over the limit surface here;
    // rethrow so the bodyLimit middleware answers 413, not "invalid JSON".
    if (err instanceof Error && err.name === "BodyLimitError") throw err;
    return null;
  }
}

function getRequestSecurityMetadata(
  request: Request
): RequestSecurityMetadata {
  const cf = request.cf as
    | { country?: unknown; colo?: unknown }
    | undefined;

  return {
    // Cloudflare always sets (and overwrites) CF-Connecting-IP. No
    // x-forwarded-for fallback: it is client-controlled and spoofable.
    ipAddress: request.headers.get("CF-Connecting-IP"),
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

/*
 Authenticates the x-api-key header. Returns the owner, or the 401
 response to send. D1 is not cached, so revocation applies immediately.
*/
async function authenticate(
  c: AppContext
): Promise<ApiKeyOwner | Response> {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) {
    return c.json({ error: "API key missing" }, 401);
  }

  const owner = await getActiveOwner(c.env, apiKey);
  if (!owner) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return owner;
}

/*
 Client → own tenant only (none, if the account has no tenant)
 Super Admin → all tenants allowed
*/
function canAccessTenant(owner: ApiKeyOwner, tenantId: string) {
  return (
    owner.role === "super_admin" ||
    (owner.tenant_id !== null && owner.tenant_id === tenantId)
  );
}

function actorFor(owner: ApiKeyOwner) {
  return owner.role === "super_admin" ? "admin" : "client";
}

/*
 "open" (default): when KV or the Durable Object fails, allow the request
 and flag it as degraded — an outage of the limiter should not take the
 tenant's API down. "closed": return 503 instead.
*/
function failClosed(env: Env) {
  return env.RATE_LIMIT_FAIL_MODE?.trim().toLowerCase() === "closed";
}

function allowedOrigin(env: Env, origin: string) {
  const configured = env.CORS_ORIGINS?.trim();
  if (!configured || configured === "*") return "*";

  const allowed = configured.split(",").map((o) => o.trim());
  return allowed.includes(origin) ? origin : null;
}

function limiterStub(env: Env, name: string) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
}

/*
 Fixed-window throttle on the RateLimiter DO, used for /register.
 Fails open: it is abuse protection, not authentication.
*/
async function systemThrottle(
  env: Env,
  name: string,
  limit: number,
  window: number
) {
  try {
    const response = await limiterStub(
      env,
      SYSTEM_LIMITER_PREFIX + name
    ).fetch("http://do/check", {
      method: "POST",
      body: JSON.stringify({
        limit,
        window,
        algorithm: "fixed_window",
      }),
    });
    if (!response.ok) return true;
    return ((await response.json()) as RateLimitDecision).allowed;
  } catch (err) {
    console.error("system throttle unavailable", { name, error: String(err) });
    return true;
  }
}

async function resetLimiter(env: Env, name: string, tenantId: string, route: string) {
  return limiterStub(env, name).fetch("http://do/reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "reset",
      tenantId,
      route,
    }),
  });
}

app.onError((err, c) => {
  console.error("Unhandled error", {
    method: c.req.method,
    path: c.req.path,
    error: String(err),
  });
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(
  "*",
  cors({
    origin: (origin, c) => allowedOrigin(c.env, origin),
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-api-key"],
    // Without this, browsers hide rate-limit headers from cross-origin JS.
    exposeHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "Retry-After",
      "X-EdgeLimiter-Degraded",
    ],
  })
);

app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) =>
      c.json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` }, 413),
  })
);

app.get("/", (c) => {
  return c.json({
    project: "EdgeLimiter API",
    status: "Live",
    docs: "/health"
  });
});

/*
 Liveness: no dependencies touched, safe for frequent unauthenticated probes.
*/
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    message: "EdgeLimiter Worker is running",
  });
});

/*
 Readiness: probes D1, KV and the Durable Object namespace. Super admin
 only, since each probe costs real operations.
*/
app.get("/health/ready", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  if (owner.role !== "super_admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  async function probe(fn: () => Promise<unknown>) {
    const started = Date.now();
    try {
      await fn();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String(err) };
    }
  }

  const [d1, kv, durableObject] = await Promise.all([
    probe(() => c.env.DB.prepare("SELECT 1").first()),
    probe(() => c.env.CONFIG_KV.get(`${SYSTEM_LIMITER_PREFIX}health`)),
    // Malformed body → DO answers 400 without touching storage.
    probe(async () => {
      const res = await limiterStub(c.env, `${SYSTEM_LIMITER_PREFIX}health`).fetch(
        "http://do/health",
        { method: "POST", body: "-" }
      );
      if (res.status !== 400) throw new Error(`unexpected status ${res.status}`);
    }),
  ]);

  const checks = {
    d1,
    kv,
    durableObject,
    ai: { ok: true, configured: Boolean(c.env.AI) },
  };
  const ok = d1.ok && kv.ok && durableObject.ok;

  return c.json({ status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});

app.get("/whoami", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  return c.json({
    email: owner.email,
    role: owner.role,
    tenantId: owner.tenant_id,
  });
});

app.post("/register", async (c) => {
  /*
   Joining an existing tenant grants that tenant's privileges
   (policies, resets, security and audit reports), so only a
   super admin may add users to a tenant that already exists.
   Public registration can only create a new tenant.
  */
  const caller = await getActiveOwner(
    c.env,
    c.req.header("x-api-key")
  );
  const isAdmin = caller?.role === "super_admin";

  if (!isAdmin) {
    const ip = getRequestSecurityMetadata(c.req.raw).ipAddress ?? "unknown";
    const allowed = await systemThrottle(
      c.env,
      `register:${ip}`,
      REGISTER_LIMIT,
      REGISTER_WINDOW_SECONDS
    );
    if (!allowed) {
      return c.json(
        { error: "Too many registrations from this address. Try again later." },
        429
      );
    }
  }

  const body = await readJsonObject(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const email =
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
  const tenantId =
    typeof body.tenantId === "string"
      ? body.tenantId.trim().toLowerCase()
      : "";
  const role =
    (typeof body.role === "string" &&
      body.role.trim().toLowerCase()) ||
    "client";

  if (!email || !tenantId) {
    return c.json(
      {
        error: "email and tenantId are required",
      },
      400
    );
  }

  if (!isValidEmail(email)) {
    return c.json({ error: "email is invalid" }, 400);
  }

  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return c.json(
      {
        error:
          "tenantId must be 1-64 characters: lowercase letters, digits, '-' or '_', starting and ending with a letter or digit",
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

  const apiKey = generateApiKey();

  /*
   One transaction: the tenant check and both inserts are atomic,
   so concurrent sign-ups can't both claim a new tenant and a failed
   key insert can't leave a user without a key. Only the key's hash
   is stored; the plaintext is returned once below.
  */
  let userInsert: D1Result;
  try {
    [userInsert] = await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO users (email, role, tenant_id)
        SELECT ?1, ?2, ?3
        WHERE ?4 = 1
          OR NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = ?3)
      `).bind(
        email,
        role,
        tenantId,
        isAdmin ? 1 : 0
      ),
      c.env.DB.prepare(`
        INSERT INTO api_keys (user_id, key_hash, key_hint, status)
        SELECT last_insert_rowid(), ?, ?, 'active'
        WHERE changes() = 1
      `).bind(await hashApiKey(apiKey), maskApiKey(apiKey)),
    ]);
  } catch (err) {
    // UNIQUE(email) lost a race with a concurrent registration.
    if (String(err).includes("UNIQUE")) {
      return c.json(
        {
          error: "Email already registered",
        },
        409
      );
    }
    throw err;
  }

  if (userInsert.meta.changes !== 1) {
    return c.json(
      {
        error:
          "Tenant already exists. Ask an administrator to add you to it.",
      },
      409
    );
  }

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
  /*
   API key is mandatory for config creation
  */
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const body = await readJsonObject(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH);
  const route = cleanString(body.route, MAX_ROUTE_LENGTH);

  const limit = Number(body.limit);
  const window = Number(body.window);

  const algorithm =
    typeof body.algorithm === "string" && body.algorithm
      ? body.algorithm
      : "sliding_window";

  /*
   Required field validation
  */
  if (!tenantId || !route) {
    return c.json(
      {
        error: `tenantId and route are required (max ${MAX_TENANT_ID_LENGTH}/${MAX_ROUTE_LENGTH} chars, no control characters)`,
      },
      400
    );
  }

  const invalid = validatePolicyValues(limit, window, algorithm);
  if (invalid) {
    return c.json({ error: invalid }, 400);
  }

  /*
   Prevent client cross-tenant access
  */
  if (!canAccessTenant(owner, tenantId)) {
    return c.json(
      {
        error:
          "Forbidden for this tenant",
      },
      403
    );
  }

  const configKey = policyKey(tenantId, route);
  const config: Policy = {
    tenantId,
    route,
    limit,
    window,
    algorithm,
  };

  /*
   Save config to KV. Metadata mirrors the value so listing policies
   doesn't need one KV read per key. KV is eventually consistent:
   other locations may serve the previous policy for up to ~60s.
  */
  await c.env.CONFIG_KV.put(
    configKey,
    JSON.stringify(config),
    { metadata: config }
  );

  /*
   Create persistent audit log
  */
  c.executionCtx.waitUntil(
    createAuditLog(c.env, {
      tenantId,
      apiKey: c.req.header("x-api-key"),
      route,
      actor: actorFor(owner),
      actionType: "policy_created",
      message: `Rate limit policy created for route ${route} with limit ${limit}/${window}s`,
      severity: "Medium",
    })
  );

  return c.json({
    success: true,
    message: `Rule saved for ${configKey}`,
    config,
  });
});

/*
 List a tenant's policies (paginated via ?cursor=).
*/
app.get("/config", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const tenantId =
    cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH) ??
    owner.tenant_id;

  if (!tenantId) {
    return c.json({ error: "tenantId is required" }, 400);
  }

  if (!canAccessTenant(owner, tenantId)) {
    return c.json({ error: "Forbidden for this tenant" }, 403);
  }

  const listed = await c.env.CONFIG_KV.list<Policy>({
    prefix: `${tenantId}:`,
    limit: 100,
    cursor: c.req.query("cursor") || undefined,
  });

  const policies = (
    await Promise.all(
      listed.keys.map(async (key) => {
        if (key.metadata) return key.metadata;
        // Policies written before metadata was added.
        const raw = await c.env.CONFIG_KV.get(key.name);
        return raw ? parseStoredPolicy(raw) : null;
      })
    )
  ).filter(
    // The prefix also matches legacy tenant IDs containing ":".
    (policy): policy is Policy =>
      policy !== null && policy.tenantId === tenantId
  );

  return c.json({
    tenantId,
    policies,
    cursor: listed.list_complete ? null : listed.cursor,
  });
});

app.delete("/config", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);
  const route = cleanString(c.req.query("route"), MAX_ROUTE_LENGTH);

  if (!tenantId || !route) {
    return c.json({ error: "tenantId and route are required" }, 400);
  }

  if (!canAccessTenant(owner, tenantId)) {
    return c.json({ error: "Forbidden for this tenant" }, 403);
  }

  const configKey = policyKey(tenantId, route);

  if ((await c.env.CONFIG_KV.get(configKey)) === null) {
    return c.json({ error: `No config found for ${configKey}` }, 404);
  }

  await c.env.CONFIG_KV.delete(configKey);

  // Drop the route's counter too (per-identifier counters expire on
  // their own via the DO idle-cleanup alarm).
  c.executionCtx.waitUntil(
    resetLimiter(c.env, limiterKey(tenantId, route), tenantId, route).catch(
      (err) => console.error("counter reset after policy delete failed", err)
    )
  );

  c.executionCtx.waitUntil(
    createAuditLog(c.env, {
      tenantId,
      apiKey: c.req.header("x-api-key"),
      route,
      actor: actorFor(owner),
      actionType: "policy_deleted",
      message: `Rate limit policy deleted for route ${route}`,
      severity: "Medium",
    })
  );

  return c.json({
    success: true,
    message: `Rule deleted for ${configKey}`,
  });
});

/*
CHECK ROUTE
*/

app.post("/check", async (c) => {
  const metadata = getRequestSecurityMetadata(c.req.raw);
  const apiKey = c.req.header("x-api-key");

  let tenantId = "";
  let route = "";
  let owner: ApiKeyOwner | null = null;

  /*
   Security events go to the queue via waitUntil; enqueue failures are
   swallowed in pushToQueue, so logging never blocks or fails a check.
  */
  function logCheck(event: {
    allowed: boolean;
    remaining: number;
    retryAfter: number;
    reason: string | null;
  }) {
    c.executionCtx.waitUntil(
      pushToQueue(c.env, {
        type: "security_log",

        tenantId,
        apiKeyId: owner?.key_id ?? null,
        apiKeyHint: apiKey
          ? maskApiKey(apiKey.slice(0, MAX_API_KEY_LENGTH))
          : null,
        route,

        // Keep missing values null: the security report filters out null IPs,
        // while a literal "unknown" would be ranked and correlated as a real IP.
        ipAddress: metadata.ipAddress,
        country: metadata.country,
        colo: metadata.colo,
        userAgent: metadata.userAgent,

        ...event,

        timestamp: new Date().toISOString(),
      })
    );
  }

  function reject(reason: string) {
    logCheck({ allowed: false, remaining: 0, retryAfter: 0, reason });
  }

  /*
   KV or Durable Object failure: allow (fail-open, default) or 503
   (fail-closed), per RATE_LIMIT_FAIL_MODE.
  */
  function degraded(reason: string) {
    logCheck({ allowed: !failClosed(c.env), remaining: 0, retryAfter: 0, reason });

    if (failClosed(c.env)) {
      return c.json(
        { error: "Rate limiter unavailable", degraded: reason },
        503,
        { "X-EdgeLimiter-Degraded": reason }
      );
    }

    return c.json(
      {
        tenant: tenantId,
        route,
        allowed: true,
        remaining: null,
        retryAfter: 0,
        degraded: reason,
      },
      200,
      { "X-EdgeLimiter-Degraded": reason }
    );
  }

  const body = await readJsonObject(c);

  if (!body) {
    reject("invalid_request_body");

    return c.json(
      { error: "Invalid JSON body" },
      400
    );
  }

  // Validate required fields first — before any DB lookups. Invalid
  // values are not logged verbatim (they are attacker-controlled).
  tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH) ?? "";
  route = cleanString(body.route, MAX_ROUTE_LENGTH) ?? "";

  if (!tenantId || !route) {
    reject("tenant_route_missing");

    return c.json(
      { error: "tenantId and route are required" },
      400
    );
  }

  /*
   Optional per-end-user identifier (user ID, IP, …): each identifier
   gets its own counter under the route's policy.
  */
  let identifier: string | null = null;
  if (body.identifier !== undefined && body.identifier !== null) {
    identifier = cleanString(body.identifier, MAX_IDENTIFIER_LENGTH);
    if (!identifier) {
      return c.json(
        { error: `identifier must be a non-empty string (max ${MAX_IDENTIFIER_LENGTH} chars)` },
        400
      );
    }
  }

  if (!apiKey) {
    reject("api_key_missing");

    return c.json(
      { error: "API key missing" },
      401
    );
  }

  /*
   Validate:
   1. API key exists and is active
   2. API key belongs to correct tenant

   D1 failure fails closed: an unauthenticated caller is never allowed.
  */
  try {
    owner = await getActiveOwner(c.env, apiKey);
  } catch (err) {
    console.error("API key lookup failed", err);
    return c.json(
      { error: "Authentication unavailable", degraded: "auth_unavailable" },
      503
    );
  }

  if (!owner) {
    reject("unauthorized_api_key");

    return c.json(
      { error: "Unauthorized" },
      401
    );
  }

  /*
   Prevent cross-tenant abuse
  */
  if (owner.tenant_id !== tenantId) {
    reject("tenant_mismatch");

    return c.json(
      { error: "Tenant mismatch" },
      403
    );
  }

  const configKey = policyKey(tenantId, route);

  let config: string | null;
  try {
    config = await c.env.CONFIG_KV.get(configKey);
  } catch (err) {
    console.error("policy lookup failed", { configKey, error: String(err) });
    return degraded("policy_unavailable");
  }

  if (!config) {
    reject("config_not_found");

    return c.json(
      {
        error: `No config found for ${configKey}`,
      },
      404
    );
  }

  const parsedConfig = parseStoredPolicy(config);
  if (!parsedConfig) {
    reject("config_invalid");
    return c.json({ error: "Malformed policy config. Please recreate via /config." }, 500);
  }

  let result: RateLimitDecision;
  try {
    const response = await limiterStub(
      c.env,
      limiterKey(tenantId, route, identifier)
    ).fetch("http://do/check", {
      method: "POST",
      body: JSON.stringify({
        limit: parsedConfig.limit,
        window: parsedConfig.window,
        algorithm: parsedConfig.algorithm,
      }),
    });

    if (!response.ok) {
      throw new Error(`limiter responded ${response.status}`);
    }

    result = (await response.json()) as RateLimitDecision;
  } catch (err) {
    console.error("rate limiter unavailable", { configKey, error: String(err) });
    return degraded("limiter_unavailable");
  }

  logCheck({
    allowed: result.allowed,
    remaining: result.remaining,
    retryAfter: result.retryAfter,
    reason: result.allowed
      ? null
      : "rate_limit_exceeded",
  });

  /*
   Persistent audit timeline entry — once per block streak, not per
   blocked request, so an attack doesn't become D1 write load.
  */
  if (result.firstBlock) {
    c.executionCtx.waitUntil(
      createAuditLog(c.env, {
        tenantId,
        apiKey,
        route,
        actor: "system",
        actionType: "rate_limit_block",
        message: `Rate limit reached on route ${route}; blocking requests (first block from IP ${metadata.ipAddress ?? "unknown"})`,
        severity: "High",
      })
    );
  }

  /*
   Analytics Engine (best-effort). Blobs carry the key ID, never the key.
  */
  try {
    c.env.ANALYTICS.writeDataPoint({
      blobs: [
        String(owner.key_id),
        tenantId,
        route,
        result.algorithm,
      ],
      doubles: [
        result.allowed ? 1 : 0,
      ],
      indexes: [tenantId],
    });
  } catch (err) {
    console.error("analytics write failed", err);
  }

  const { firstBlock: _, ...publicResult } = result;

  return c.json(
    {
      tenant: tenantId,
      route,
      configKey,
      ...publicResult,
    },
    result.allowed ? 200 : 429,
    {
      "X-RateLimit-Limit": String(
        parsedConfig.limit
      ),
      "X-RateLimit-Remaining": String(
        result.remaining
      ),
      // When blocked, reset is when the limiter will next allow a request,
      // not a full window from now (keeps it consistent with Retry-After).
      "X-RateLimit-Reset": String(
        Math.floor(Date.now() / 1000) +
          (result.retryAfter > 0
            ? Math.ceil(result.retryAfter)
            : parsedConfig.window)
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
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  /*
   Tenant-wide totals.
   Client → own tenant only
   Super Admin → any tenant via ?tenantId= (admin drill-down)
  */
  const tenantId =
    owner.role === "super_admin"
      ? c.req.query("tenantId")?.trim() || owner.tenant_id
      : owner.tenant_id;

  if (!tenantId) {
    return c.json({ totalRequests: 0, blockedRequests: 0, blockRate: "0%" });
  }

  const result = await c.env.DB.prepare(
    `
      SELECT
        SUM(total_requests) AS total_requests,
        SUM(blocked_requests) AS blocked_requests
      FROM logs_summary
      WHERE tenant_id = ?
    `
  )
    .bind(tenantId)
    .first<{ total_requests: number | null; blocked_requests: number | null }>();

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
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const result = await c.env.DB.prepare(
    `
      SELECT
        total_requests,
        blocked_requests
      FROM logs_summary
      WHERE api_key_id = ?
      LIMIT 1
    `
  )
    .bind(owner.key_id)
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
    topApiKey: owner.key_hint,
    totalRequests,
    blockedRequests,
    abuseScore: `${abuseScore}%`,
    recommendation,
  });
});

app.get("/security-report", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);

  if (!tenantId) {
    return c.json(
      { error: "tenantId is required" },
      400
    );
  }

  if (!canAccessTenant(owner, tenantId)) {
    return c.json(
      { error: "Forbidden for this tenant" },
      403
    );
  }

  // Bound as an ISO string so it compares correctly with created_at
  // (stored as ISO-8601). SQLite's datetime() uses a space separator,
  // which sorts below "T" and silently widened the window to ~48h.
  const since = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  // Independent queries — run concurrently.
  const [recentLogsResult, topIpResult] = await Promise.all([
    c.env.DB.prepare(`
    SELECT
      id,
      tenant_id,
      api_key_hint,
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
    ORDER BY created_at DESC
    LIMIT 50
  `)
    .bind(tenantId)
    .all<SecurityLogRow>(),

    // Only IPs that hit this tenant inside the window; scanning the
    // tenant's full history made this query grow without bound.
    c.env.DB.prepare(`
    WITH tenant_ips AS (
      SELECT DISTINCT ip_address
      FROM security_logs
      WHERE tenant_id = ?
        AND created_at >= ?
        AND ip_address IS NOT NULL
        AND ip_address <> ''
    )
    SELECT
      l.ip_address,
      MAX(l.country) AS country,
      MAX(l.colo) AS colo,
      COUNT(*) AS total_requests,
      SUM(
        CASE
          WHEN l.allowed = 0 THEN 1
          ELSE 0
        END
      ) AS blocked_requests,
      SUM(
        CASE
          WHEN l.tenant_id = ? THEN 1
          ELSE 0
        END
      ) AS tenant_requests,
      SUM(
        CASE
          WHEN l.tenant_id = ?
            AND l.allowed = 0
          THEN 1
          ELSE 0
        END
      ) AS tenant_blocked_requests,
      COUNT(DISTINCT l.tenant_id) AS tenant_count,
      MAX(l.created_at) AS last_seen
    FROM security_logs l
    INNER JOIN tenant_ips ti
      ON ti.ip_address = l.ip_address
    WHERE l.created_at >= ?
    GROUP BY l.ip_address
    ORDER BY
      tenant_blocked_requests DESC,
      blocked_requests DESC,
      total_requests DESC
    LIMIT 10
  `)
    .bind(
      tenantId,
      since,
      tenantId,
      tenantId,
      since
    )
    .all<TopAbusiveIpRow>(),
  ]);

  const recentLogs =
    recentLogsResult.results ?? [];

  const topAbusiveIps = (
    topIpResult.results ?? []
  ).map((row) => ({
    ipAddress: row.ip_address,
    country: row.country,
    colo: row.colo,
    totalRequests: Number(
      row.total_requests || 0
    ),
    blockedRequests: Number(
      row.blocked_requests || 0
    ),
    tenantRequests: Number(
      row.tenant_requests || 0
    ),
    tenantBlockedRequests: Number(
      row.tenant_blocked_requests || 0
    ),
    tenantCount: Number(
      row.tenant_count || 0
    ),
    lastSeen: row.last_seen,
  }));

  const intelligence =
    await getSecurityIntelligence(
      c.env,
      tenantId,
      recentLogs,
      topIpResult.results ?? [],
      (promise) => c.executionCtx.waitUntil(promise)
    );

  /*
    Convert text severity -> numeric score
  */
  const scoreMap: Record<string, number> = {
    Critical: 95,
    High: 85,
    Medium: 55,
    Low: 20,
  };

  return c.json({
    tenantId,

    recentLogs: recentLogs.map((log) => ({
      id: log.id,
      tenantId: log.tenant_id,
      apiKey: log.api_key_hint || null,
      route: log.route,
      ipAddress: log.ip_address,
      country: log.country,
      colo: log.colo,
      userAgent: log.user_agent,
      allowed: Boolean(log.allowed),
      remaining: Number(
        log.remaining || 0
      ),
      retryAfter: Number(
        log.retry_after || 0
      ),
      reason: log.reason,
      createdAt: log.created_at,
    })),

    topAbusiveIps,

    aiSummary: intelligence.aiSummary,

    abuseScore: scoreMap[intelligence.abuseScore] ?? 0,

    recommendation:
      intelligence.recommendation,

    intelligenceSource: intelligence.source,
    generatedAt: intelligence.generatedAt,
  });
});

app.post("/reset", async (c) => {
  /*
   API key required
  */
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const body = await readJsonObject(c);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH);
  const route = cleanString(body.route, MAX_ROUTE_LENGTH);
  const identifier =
    body.identifier === undefined || body.identifier === null
      ? null
      : cleanString(body.identifier, MAX_IDENTIFIER_LENGTH);

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
  */
  if (!canAccessTenant(owner, tenantId)) {
    return c.json(
      {
        error:
          "Forbidden for this tenant",
      },
      403
    );
  }

  /*
   Durable Object reset call
  */
  let response: Response;
  try {
    response = await resetLimiter(
      c.env,
      limiterKey(tenantId, route, identifier),
      tenantId,
      route
    );
  } catch (err) {
    console.error("reset failed", err);
    return c.json({ error: "Failed to reset counters" }, 503);
  }

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
   Persistent audit log
  */
  c.executionCtx.waitUntil(
    createAuditLog(c.env, {
      tenantId,
      apiKey: c.req.header("x-api-key"),
      route,
      actor: actorFor(owner),
      actionType: "rate_limit_reset",
      message: `Rate limiter manually reset for route ${route}${identifier ? " (single identifier)" : ""}`,
      severity: "High",
    })
  );

  return c.json({
    ...result,
    success: true,
    tenantId,
    route,
  });
});

async function topAbuser(env: Env) {
  return env.DB.prepare(`
    SELECT
      ak.key_hint,
      ls.total_requests,
      ls.blocked_requests
    FROM logs_summary ls
    LEFT JOIN api_keys ak ON ak.id = ls.api_key_id
    ORDER BY ls.blocked_requests DESC
    LIMIT 1
  `).first<{ key_hint: string | null; total_requests: number; blocked_requests: number }>();
}

app.get("/run-report", async (c) => {
  const caller = await authenticate(c);
  if (caller instanceof Response) return caller;
  if (caller.role !== "super_admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const result = await topAbuser(c.env);

  if (!result) {
    return c.json({ message: "No usage data found." });
  }

  const totalRequests = Number(result.total_requests || 0);
  const blockedRequests = Number(result.blocked_requests || 0);
  const abuseScore =
    totalRequests > 0
      ? ((blockedRequests / totalRequests) * 100).toFixed(2)
      : "0";

  return c.json({
    report: "Daily Abuse Report",
    topApiKey: result.key_hint ?? "••••••••",
    totalRequests,
    blockedRequests,
    abuseScore: `${abuseScore}%`,
    recommendation:
      Number(abuseScore) > 70
        ? "Temporary block recommended"
        : "Monitor traffic",
  });
});

app.get("/audit-report", async (c) => {
  /*
   Validate API key + tenant ownership
  */
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);

  if (!tenantId) {
    return c.json(
      { error: "tenantId is required" },
      400
    );
  }

  if (!canAccessTenant(owner, tenantId)) {
    return c.json(
      { error: "Forbidden" },
      403
    );
  }

  const logs = await c.env.DB.prepare(`
    SELECT
      id,
      tenant_id,
      api_key_hint,
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

/*
 API KEYS
 Client → own user's keys
 Super Admin → own keys, or any tenant's keys via ?tenantId=
*/
app.get("/keys", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const tenantId =
    owner.role === "super_admin"
      ? cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH)
      : null;

  const result = tenantId
    ? await c.env.DB.prepare(`
        SELECT a.id, a.key_hint, a.status, a.created_at, a.revoked_at, u.email
        FROM api_keys a
        INNER JOIN users u ON u.id = a.user_id
        WHERE u.tenant_id = ?
        ORDER BY a.id DESC
        LIMIT 200
      `)
        .bind(tenantId)
        .all()
    : await c.env.DB.prepare(`
        SELECT a.id, a.key_hint, a.status, a.created_at, a.revoked_at, u.email
        FROM api_keys a
        INNER JOIN users u ON u.id = a.user_id
        WHERE a.user_id = ?
        ORDER BY a.id DESC
        LIMIT 200
      `)
        .bind(owner.user_id)
        .all();

  return c.json({
    keys: (result.results as Record<string, unknown>[]).map((row) => ({
      id: row.id,
      hint: row.key_hint,
      status: row.status,
      email: row.email,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      current: row.id === owner.key_id,
    })),
  });
});

/*
 Create an additional key for the caller. The plaintext is returned
 once and never stored.
*/
app.post("/keys", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const active = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND status = 'active'`
  )
    .bind(owner.user_id)
    .first<{ n: number }>();

  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
    return c.json(
      { error: `At most ${MAX_ACTIVE_KEYS_PER_USER} active keys per user; revoke one first` },
      409
    );
  }

  const apiKey = generateApiKey();
  const hint = maskApiKey(apiKey);

  const inserted = await c.env.DB.prepare(
    `INSERT INTO api_keys (user_id, key_hash, key_hint, status) VALUES (?, ?, ?, 'active')`
  )
    .bind(owner.user_id, await hashApiKey(apiKey), hint)
    .run();

  // Audit rows are per tenant; tenant-less legacy accounts have none.
  if (owner.tenant_id) {
    c.executionCtx.waitUntil(
      createAuditLog(c.env, {
        tenantId: owner.tenant_id,
        apiKey,
        actor: actorFor(owner),
        actionType: "api_key_created",
        message: `API key ${hint} created for ${owner.email}`,
        severity: "Medium",
      })
    );
  }

  return c.json({
    success: true,
    id: inserted.meta.last_row_id,
    apiKey,
    hint,
  });
});

app.post("/keys/:id/revoke", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid key id" }, 400);
  }

  const key = await c.env.DB.prepare(`
    SELECT a.id, a.user_id, a.key_hint, a.status, u.tenant_id, u.email
    FROM api_keys a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.id = ?
  `)
    .bind(id)
    .first<{
      id: number;
      user_id: number;
      key_hint: string;
      status: string;
      tenant_id: string;
      email: string;
    }>();

  // Clients may only revoke their own keys; 404 avoids revealing others.
  if (
    !key ||
    (owner.role !== "super_admin" && key.user_id !== owner.user_id)
  ) {
    return c.json({ error: "Key not found" }, 404);
  }

  if (key.status !== "revoked") {
    await c.env.DB.prepare(
      `UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ?`
    )
      .bind(new Date().toISOString(), id)
      .run();

    c.executionCtx.waitUntil(
      createAuditLog(c.env, {
        tenantId: key.tenant_id,
        actor: actorFor(owner),
        actionType: "api_key_revoked",
        message: `API key ${key.key_hint} for ${key.email} revoked`,
        severity: "High",
      })
    );
  }

  return c.json({
    success: true,
    id,
    status: "revoked",
    current: id === owner.key_id,
  });
});

/*
 Daily retention: delete security_logs older than
 SECURITY_LOG_RETENTION_DAYS (unset = keep everything). Deletes in
 bounded chunks so a large backlog can't exceed D1 statement limits.
*/
async function pruneSecurityLogs(env: Env) {
  const days = Number(env.SECURITY_LOG_RETENTION_DAYS);
  if (!Number.isInteger(days) || days < 1) return 0;

  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();

  let deleted = 0;
  for (let i = 0; i < 50; i++) {
    const result = await env.DB.prepare(`
      DELETE FROM security_logs
      WHERE id IN (
        SELECT id FROM security_logs WHERE created_at < ? LIMIT 5000
      )
    `)
      .bind(cutoff)
      .run();
    deleted += result.meta.changes;
    if (result.meta.changes < 5000) break;
  }
  return deleted;
}

export { RateLimiter };

export default {
  fetch: app.fetch,

  async queue(
    batch: MessageBatch<unknown>,
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

    const pruned = await pruneSecurityLogs(env);
    if (pruned) {
      console.log(`Pruned ${pruned} security_logs rows past retention.`);
    }

    const result = await topAbuser(env);

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
Top API Key:        ${result.key_hint ?? "••••••••"}
Total Requests:     ${totalRequests}
Blocked Requests:   ${blockedRequests}
Abuse Score:        ${abuseScore}%
Recommendation:     ${Number(abuseScore) > 70 ? "Temporary block recommended" : "Monitor traffic"}
==========================
    `);
  },
};
