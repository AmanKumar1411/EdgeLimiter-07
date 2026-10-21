import { Hono } from "hono";
import { writeAudit } from "../analytics/audit";
import { recordCheck } from "../analytics/events";
import {
  actorFor,
  authenticate,
  canAccessTenant,
  findActiveOwner,
  maskApiKey,
  MAX_API_KEY_LENGTH,
  type KeyOwner,
} from "../keys/keys";
import { parseStoredPolicy, policyKey, readPolicy } from "../policies/policies";
import { readConfig } from "../shared/config";
import type { AppEnv } from "../shared/env";
import { clientInfo, readJsonObject } from "../shared/http";
import { log } from "../shared/log";
import { cleanString, MAX_IDENTIFIER_LENGTH, MAX_ROUTE_LENGTH, MAX_TENANT_ID_LENGTH } from "../shared/validation";
import { counterName, limiter, type LimitResult } from "./limiter";

export const rateLimitRoutes = new Hono<AppEnv>();

/*
 The hot path: validate → key (D1) and policy (KV) in parallel → one
 Durable Object call → respond. Logging happens after the response.
*/
rateLimitRoutes.post("/check", async (c) => {
  const client = clientInfo(c.req.raw);
  const apiKey = c.req.header("x-api-key");
  let tenantId = "";
  let route = "";
  let owner: KeyOwner | null = null;

  const record = (allowed: boolean, remaining: number, retryAfter: number, reason: string | null) =>
    recordCheck(c.env, c.executionCtx, {
      tenantId,
      route,
      apiKeyId: owner?.key_id ?? null,
      apiKeyHint: apiKey ? maskApiKey(apiKey.slice(0, MAX_API_KEY_LENGTH)) : null,
      ...client,
      allowed,
      remaining,
      retryAfter,
      reason,
    });

  const reject = (status: 400 | 401 | 403 | 404 | 500, error: string, reason: string) => {
    record(false, 0, 0, reason);
    return c.json({ error }, status);
  };

  // KV or the Durable Object failed: allow or refuse per RATE_LIMIT_FAIL_MODE.
  const degraded = (reason: string) => {
    const { failClosed } = readConfig(c.env);
    record(!failClosed, 0, 0, reason);
    const headers = { "X-EdgeLimiter-Degraded": reason };
    return failClosed
      ? c.json({ error: "Rate limiter unavailable", degraded: reason }, 503, headers)
      : c.json(
          { tenant: tenantId, route, allowed: true, remaining: null, retryAfter: 0, degraded: reason },
          200,
          headers,
        );
  };

  const body = await readJsonObject(c);
  if (!body) return reject(400, "Invalid JSON body", "invalid_request_body");

  // Invalid values are not logged verbatim: they are attacker-controlled.
  tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH) ?? "";
  route = cleanString(body.route, MAX_ROUTE_LENGTH) ?? "";
  if (!tenantId || !route) return reject(400, "tenantId and route are required", "tenant_route_missing");

  // Optional end-user identifier: each one gets its own counter under the policy.
  let identifier: string | null = null;
  if (body.identifier !== undefined && body.identifier !== null) {
    identifier = cleanString(body.identifier, MAX_IDENTIFIER_LENGTH);
    if (!identifier) {
      return c.json({ error: `identifier must be a non-empty string (max ${MAX_IDENTIFIER_LENGTH} chars)` }, 400);
    }
  }
  if (!apiKey) return reject(401, "API key missing", "api_key_missing");

  // Independent lookups, so start the policy read now. Auth results are
  // still evaluated first, and an unauthenticated caller is never allowed.
  const policyRead = readPolicy(c.env, tenantId, route).then(
    (raw) => ({ raw }),
    (error: unknown) => ({ error }),
  );

  try {
    owner = await findActiveOwner(c.env, apiKey);
  } catch (err) {
    log.error("auth_unavailable", err);
    return c.json({ error: "Authentication unavailable", degraded: "auth_unavailable" }, 503);
  }
  if (!owner) return reject(401, "Unauthorized", "unauthorized_api_key");
  if (owner.tenant_id !== tenantId) return reject(403, "Tenant mismatch", "tenant_mismatch");

  const read = await policyRead;
  if ("error" in read) {
    log.error("policy_unavailable", read.error, { tenantId, route });
    return degraded("policy_unavailable");
  }
  const configKey = policyKey(tenantId, route);
  if (!read.raw) return reject(404, `No config found for ${configKey}`, "config_not_found");
  const policy = parseStoredPolicy(read.raw);
  if (!policy) return reject(500, "Malformed policy config. Please recreate via /config.", "config_invalid");

  let decision: LimitResult;
  try {
    decision = await limiter(c.env, counterName(tenantId, route, identifier)).check({
      limit: policy.limit,
      window: policy.window,
      algorithm: policy.algorithm,
    });
  } catch (err) {
    log.error("limiter_unavailable", err, { tenantId, route });
    return degraded("limiter_unavailable");
  }

  record(decision.allowed, decision.remaining, decision.retryAfter, decision.allowed ? null : "rate_limit_exceeded");
  if (decision.firstBlock) {
    writeAudit(c.env, c.executionCtx, {
      tenantId,
      apiKey,
      route,
      actor: "system",
      actionType: "rate_limit_block",
      message: `Rate limit reached on route ${route}; blocking requests (first block from IP ${client.ipAddress ?? "unknown"})`,
      severity: "High",
    });
  }
  try {
    // Blobs carry the key ID, never the key.
    c.env.ANALYTICS.writeDataPoint({
      blobs: [String(owner.key_id), tenantId, route, decision.algorithm],
      doubles: [decision.allowed ? 1 : 0],
      indexes: [tenantId],
    });
  } catch (err) {
    log.error("analytics_write_failed", err);
  }

  const now = Math.floor(Date.now() / 1000);
  return c.json(
    {
      tenant: tenantId,
      route,
      configKey,
      allowed: decision.allowed,
      remaining: decision.remaining,
      retryAfter: decision.retryAfter,
      algorithm: decision.algorithm,
    },
    decision.allowed ? 200 : 429,
    {
      "X-RateLimit-Limit": String(policy.limit),
      "X-RateLimit-Remaining": String(decision.remaining),
      // When blocked: when the next request will be allowed (matches Retry-After).
      "X-RateLimit-Reset": String(now + (decision.retryAfter > 0 ? decision.retryAfter : policy.window)),
      ...(decision.retryAfter > 0 && { "Retry-After": String(decision.retryAfter) }),
    },
  );
});

rateLimitRoutes.post("/reset", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH);
  const route = cleanString(body.route, MAX_ROUTE_LENGTH);
  const identifier =
    body.identifier === undefined || body.identifier === null
      ? null
      : cleanString(body.identifier, MAX_IDENTIFIER_LENGTH);
  if (!tenantId || !route) return c.json({ error: "tenantId and route are required" }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden for this tenant" }, 403);

  try {
    await limiter(c.env, counterName(tenantId, route, identifier)).reset();
  } catch (err) {
    log.error("counter_reset_failed", err, { tenantId, route });
    return c.json({ error: "Failed to reset counters" }, 503);
  }

  writeAudit(c.env, c.executionCtx, {
    tenantId,
    apiKey: c.req.header("x-api-key"),
    route,
    actor: actorFor(owner),
    actionType: "rate_limit_reset",
    message: `Rate limiter manually reset for route ${route}${identifier ? " (single identifier)" : ""}`,
    severity: "High",
  });

  return c.json({ success: true, message: "Rate limit counter reset successfully", tenantId, route });
});
