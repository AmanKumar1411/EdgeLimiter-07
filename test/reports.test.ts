import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import {
  call,
  check,
  flushQueue,
  json,
  makeEnv,
  register,
  registerAdmin,
  savePolicy,
} from "./helpers";

describe("security report", () => {
  it("masks keys and limits top IPs to the last 24 hours", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/s", limit: 1, window: 60 });
    await call(env, "POST", "/check", { apiKey, ip: "198.51.100.7", body: { tenantId, route: "/s" } });
    await call(env, "POST", "/check", { apiKey, ip: "198.51.100.7", body: { tenantId, route: "/s" } });
    await flushQueue(env);

    // 30h-old row from another IP: outside the window.
    await env.DB.prepare(`
      INSERT INTO security_logs (tenant_id, api_key_hint, route, ip_address, allowed, remaining, retry_after, created_at)
      VALUES (?, '', '/s', '192.0.2.99', 0, 0, 0, ?)
    `).bind(tenantId, new Date(Date.now() - 30 * 3600 * 1000).toISOString()).run();

    const data = await json(await call(env, "GET", `/security-report?tenantId=${tenantId}`, { apiKey }));
    expect(data.topAbusiveIps.map((ip: any) => ip.ipAddress)).toEqual(["198.51.100.7"]);
    expect(data.topAbusiveIps[0]).toMatchObject({ totalRequests: 2, tenantBlockedRequests: 1 });
    expect(JSON.stringify(data)).not.toContain(apiKey);
    expect(data.recentLogs[0].apiKey).toMatch(/••••/);
    expect(data.intelligenceSource).toBe("rules");
  });
});

describe("audit log", () => {
  it("records policy/reset/key actions and one block per streak, with masked keys", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/a", limit: 1, window: 3600 });
    for (let i = 0; i < 6; i++) await check(env, apiKey, tenantId, "/a"); // 1 allowed, 5 blocked
    await call(env, "POST", "/reset", { apiKey, body: { tenantId, route: "/a" } });
    for (let i = 0; i < 3; i++) await check(env, apiKey, tenantId, "/a"); // new streak
    await call(env, "POST", "/keys", { apiKey });
    await call(env, "DELETE", `/config?tenantId=${tenantId}&route=/a`, { apiKey });

    const { auditLogs } = await json(
      await call(env, "GET", `/audit-report?tenantId=${tenantId}`, { apiKey })
    );
    const actions = auditLogs.map((l: any) => l.action_type).reverse();
    expect(actions).toEqual([
      "policy_created",
      "rate_limit_block",
      "rate_limit_reset",
      "rate_limit_block",
      "api_key_created",
      "policy_deleted",
    ]);
    expect(JSON.stringify(auditLogs)).not.toContain(apiKey);
  });

  it("admin actions on a tenant don't expose the admin key to that tenant", async () => {
    const env = makeEnv();
    const client = await register(env);
    const admin = await registerAdmin(env);
    await savePolicy(env, admin.apiKey, { tenantId: client.tenantId, route: "/adm", limit: 1, window: 60 });
    const res = await call(env, "GET", `/audit-report?tenantId=${client.tenantId}`, { apiKey: client.apiKey });
    expect(JSON.stringify(await json(res))).not.toContain(admin.apiKey);
  });
});

describe("policies CRUD", () => {
  it("lists, updates and deletes a tenant's policies", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/one", limit: 1, window: 60 });
    await savePolicy(env, apiKey, { tenantId, route: "/two", limit: 2, window: 60, algorithm: "token_bucket" });
    await savePolicy(env, apiKey, { tenantId, route: "/two", limit: 9, window: 60, algorithm: "token_bucket" });

    const listed = await json(await call(env, "GET", "/config", { apiKey }));
    expect(listed.policies.map((p: any) => [p.route, p.limit, p.algorithm]).sort()).toEqual([
      ["/one", 1, "sliding_window"],
      ["/two", 9, "token_bucket"],
    ]);

    expect((await call(env, "DELETE", `/config?tenantId=${tenantId}&route=/one`, { apiKey })).status).toBe(200);
    expect((await call(env, "DELETE", `/config?tenantId=${tenantId}&route=/one`, { apiKey })).status).toBe(404);
    expect((await check(env, apiKey, tenantId, "/one")).status).toBe(404);
  });

  it("validates policy values", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    for (const body of [
      { tenantId, route: "/v", limit: 2.5, window: 60 },
      { tenantId, route: "/v", limit: 0, window: 60 },
      { tenantId, route: "/v", limit: 5, window: 60, algorithm: "bogus" },
      { tenantId, route: "/v", limit: 50_000, window: 60, algorithm: "sliding_window" },
      { tenantId, route: "", limit: 5, window: 60 },
      { tenantId, route: "/v", limit: 5, window: 99_999_999 },
    ]) {
      expect((await call(env, "POST", "/config", { apiKey, body })).status, JSON.stringify(body)).toBe(400);
    }
    // High limits are fine for O(1) algorithms.
    expect(
      (await call(env, "POST", "/config", {
        apiKey,
        body: { tenantId, route: "/v", limit: 50_000, window: 60, algorithm: "fixed_window" },
      })).status
    ).toBe(200);
  });
});

describe("scheduled retention", () => {
  it("prunes security logs past SECURITY_LOG_RETENTION_DAYS and keeps recent ones", async () => {
    const env = makeEnv();
    const { tenantId } = await register(env);
    const insert = (createdAt: string) =>
      env.DB.prepare(`
        INSERT INTO security_logs (tenant_id, api_key_hint, route, allowed, remaining, retry_after, created_at)
        VALUES (?, '', '/ret', 1, 0, 0, ?)
      `).bind(tenantId, createdAt).run();
    await insert(new Date(Date.now() - 40 * 86400_000).toISOString());
    await insert(new Date(Date.now() - 1 * 86400_000).toISOString());

    const count = async () =>
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM security_logs WHERE tenant_id = ?")
        .bind(tenantId).first<{ n: number }>())?.n;

    // Unset → nothing deleted.
    let ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await count()).toBe(2);

    ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), { ...env, SECURITY_LOG_RETENTION_DAYS: "30" }, ctx);
    await waitOnExecutionContext(ctx);
    expect(await count()).toBe(1);
  });
});

describe("health", () => {
  it("reports liveness publicly and dependency readiness to admins", async () => {
    const env = makeEnv();
    expect((await call(env, "GET", "/health")).status).toBe(200);
    const admin = await registerAdmin(env);
    const ready = await json(await call(env, "GET", "/health/ready", { apiKey: admin.apiKey }));
    expect(ready.status).toBe("ok");
    expect(ready.checks).toMatchObject({
      d1: { ok: true },
      kv: { ok: true },
      durableObject: { ok: true },
    });
  });
});
