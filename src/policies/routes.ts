import { Hono } from "hono";
import { writeAudit } from "../analytics/audit";
import { actorFor, authenticate, canAccessTenant } from "../keys/keys";
import { counterName, limiter } from "../ratelimit/limiter";
import type { AppEnv } from "../shared/env";
import { readJsonObject } from "../shared/http";
import { log } from "../shared/log";
import { cleanString, MAX_ROUTE_LENGTH, MAX_TENANT_ID_LENGTH } from "../shared/validation";
import { deletePolicy, listPolicies, parseRule, policyKey, readPolicy, savePolicy } from "./policies";

export const policyRoutes = new Hono<AppEnv>();

policyRoutes.post("/config", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const tenantId = cleanString(body.tenantId, MAX_TENANT_ID_LENGTH);
  const route = cleanString(body.route, MAX_ROUTE_LENGTH);
  if (!tenantId || !route) {
    return c.json(
      {
        error: `tenantId and route are required (max ${MAX_TENANT_ID_LENGTH}/${MAX_ROUTE_LENGTH} chars, no control characters)`,
      },
      400,
    );
  }

  const algorithm = typeof body.algorithm === "string" && body.algorithm ? body.algorithm : "sliding_window";
  const rule = parseRule(Number(body.limit), Number(body.window), algorithm);
  if ("error" in rule) return c.json({ error: rule.error }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden for this tenant" }, 403);

  const policy = { tenantId, route, ...rule };
  await savePolicy(c.env, policy);

  writeAudit(c.env, c.executionCtx, {
    tenantId,
    apiKey: c.req.header("x-api-key"),
    route,
    actor: actorFor(owner),
    actionType: "policy_created",
    message: `Rate limit policy created for route ${route} with limit ${rule.limit}/${rule.window}s`,
    severity: "Medium",
  });

  return c.json({ success: true, message: `Rule saved for ${policyKey(tenantId, route)}`, config: policy });
});

policyRoutes.get("/config", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH) ?? owner.tenant_id;
  if (!tenantId) return c.json({ error: "tenantId is required" }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden for this tenant" }, 403);

  const { policies, cursor } = await listPolicies(c.env, tenantId, c.req.query("cursor") || undefined);
  return c.json({ tenantId, policies, cursor });
});

policyRoutes.delete("/config", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH);
  const route = cleanString(c.req.query("route"), MAX_ROUTE_LENGTH);
  if (!tenantId || !route) return c.json({ error: "tenantId and route are required" }, 400);
  if (!canAccessTenant(owner, tenantId)) return c.json({ error: "Forbidden for this tenant" }, 403);

  const key = policyKey(tenantId, route);
  if ((await readPolicy(c.env, tenantId, route)) === null) {
    return c.json({ error: `No config found for ${key}` }, 404);
  }
  await deletePolicy(c.env, tenantId, route);

  // Drop the route's counter too; per-identifier counters expire on their own.
  c.executionCtx.waitUntil(
    limiter(c.env, counterName(tenantId, route))
      .reset()
      .catch((err) => log.error("counter_reset_failed", err, { tenantId, route })),
  );
  writeAudit(c.env, c.executionCtx, {
    tenantId,
    apiKey: c.req.header("x-api-key"),
    route,
    actor: actorFor(owner),
    actionType: "policy_deleted",
    message: `Rate limit policy deleted for route ${route}`,
    severity: "Medium",
  });

  return c.json({ success: true, message: `Rule deleted for ${key}` });
});
