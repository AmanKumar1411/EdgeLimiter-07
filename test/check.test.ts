import { evictAllDurableObjects } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { call, check, json, makeEnv, register, savePolicy, unique } from "./helpers";

const ALGORITHMS = ["sliding_window", "fixed_window", "token_bucket"];

describe("/check enforcement", () => {
  for (const algorithm of ALGORITHMS) {
    it(`${algorithm}: allows exactly the limit, then 429 with Retry-After`, async () => {
      const env = makeEnv();
      const { tenantId, apiKey } = await register(env);
      await savePolicy(env, apiKey, { tenantId, route: "/login", limit: 3, window: 3600, algorithm });

      for (let i = 0; i < 3; i++) {
        const res = await check(env, apiKey, tenantId, "/login");
        expect(res.status).toBe(200);
        expect(res.headers.get("Retry-After")).toBeNull();
        expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
      }

      const blocked = await check(env, apiKey, tenantId, "/login");
      expect(blocked.status).toBe(429);
      const body = await json(blocked);
      expect(body).toMatchObject({ allowed: false, remaining: 0, algorithm });
      expect(body.firstBlock).toBeUndefined(); // internal flag not exposed
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      const expectedReset = Math.floor(Date.now() / 1000) + Number(blocked.headers.get("Retry-After"));
      expect(Math.abs(Number(blocked.headers.get("X-RateLimit-Reset")) - expectedReset)).toBeLessThanOrEqual(1);
    });

    it(`${algorithm}: concurrent burst admits exactly the limit`, async () => {
      const env = makeEnv();
      const { tenantId, apiKey } = await register(env);
      await savePolicy(env, apiKey, { tenantId, route: "/burst", limit: 10, window: 3600, algorithm });

      const results = await Promise.all(Array.from({ length: 30 }, () => check(env, apiKey, tenantId, "/burst")));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(10);
      expect(statuses.filter((s) => s === 429)).toHaveLength(20);
    });
  }

  it("isolates counters per tenant, per route and per identifier", async () => {
    const env = makeEnv();
    const a = await register(env);
    const b = await register(env);
    for (const t of [a, b]) {
      await savePolicy(env, t.apiKey, { tenantId: t.tenantId, route: "/x", limit: 1, window: 3600 });
      await savePolicy(env, t.apiKey, { tenantId: t.tenantId, route: "/y", limit: 1, window: 3600 });
    }

    expect((await check(env, a.apiKey, a.tenantId, "/x")).status).toBe(200);
    expect((await check(env, a.apiKey, a.tenantId, "/x")).status).toBe(429);
    // Other tenant, same route name: unaffected.
    expect((await check(env, b.apiKey, b.tenantId, "/x")).status).toBe(200);
    // Same tenant, other route: unaffected.
    expect((await check(env, a.apiKey, a.tenantId, "/y")).status).toBe(200);

    // Per end-user identifiers get independent counters under one policy.
    expect((await check(env, a.apiKey, a.tenantId, "/y", { identifier: "user-1" })).status).toBe(200);
    expect((await check(env, a.apiKey, a.tenantId, "/y", { identifier: "user-1" })).status).toBe(429);
    expect((await check(env, a.apiKey, a.tenantId, "/y", { identifier: "user-2" })).status).toBe(200);
  });

  it("isolates users of the same tenant only via identifier (route counter is shared)", async () => {
    const env = makeEnv();
    const admin = await register(env, unique("adm"));
    await env.DB.prepare("UPDATE users SET role='super_admin' WHERE email=?").bind(admin.email).run();
    const owner = await register(env);
    const teammate = await register(env, owner.tenantId, `${unique("mate")}@example.com`, admin.apiKey);

    await savePolicy(env, owner.apiKey, { tenantId: owner.tenantId, route: "/shared", limit: 1, window: 3600 });
    expect((await check(env, owner.apiKey, owner.tenantId, "/shared")).status).toBe(200);
    expect((await check(env, teammate.apiKey, owner.tenantId, "/shared")).status).toBe(429);
  });

  it("keeps counting after all Durable Objects are evicted (restart)", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/persist", limit: 2, window: 3600 });
    await check(env, apiKey, tenantId, "/persist");
    await check(env, apiKey, tenantId, "/persist");

    await evictAllDurableObjects();

    expect((await check(env, apiKey, tenantId, "/persist")).status).toBe(429);
  });

  it("applies policy updates on the next check (local KV is immediately consistent)", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/p", limit: 1, window: 3600, algorithm: "fixed_window" });
    expect((await check(env, apiKey, tenantId, "/p")).status).toBe(200);
    expect((await check(env, apiKey, tenantId, "/p")).status).toBe(429);

    await savePolicy(env, apiKey, { tenantId, route: "/p", limit: 3, window: 3600, algorithm: "fixed_window" });
    const res = await check(env, apiKey, tenantId, "/p");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  it("resets a counter via /reset", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/r", limit: 1, window: 3600 });
    await check(env, apiKey, tenantId, "/r");
    expect((await check(env, apiKey, tenantId, "/r")).status).toBe(429);

    const reset = await call(env, "POST", "/reset", { apiKey, body: { tenantId, route: "/r" } });
    expect(reset.status).toBe(200);
    expect((await check(env, apiKey, tenantId, "/r")).status).toBe(200);
  });

  it("returns 404 without a policy and validates inputs", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);

    expect((await check(env, apiKey, tenantId, "/none")).status).toBe(404);
    expect((await call(env, "POST", "/check", { apiKey, body: "{bad" })).status).toBe(400);
    expect((await check(env, apiKey, tenantId, "/a\u0001b")).status).toBe(400);
    expect((await check(env, apiKey, tenantId, "/" + "x".repeat(300))).status).toBe(400);
    expect((await check(env, apiKey, tenantId, "/a", { identifier: "" })).status).toBe(400);
  });

  it("enforces legacy KV policies that predate strict validation", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await env.CONFIG_KV.put(
      `${tenantId}:/legacy`,
      JSON.stringify({ tenantId, route: "/legacy", limit: 1.7, window: 60, algorithm: "bogus" }),
    );
    const first = await check(env, apiKey, tenantId, "/legacy");
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({ algorithm: "sliding_window" });
    expect((await check(env, apiKey, tenantId, "/legacy")).status).toBe(429);

    await env.CONFIG_KV.put(`${tenantId}:/broken`, JSON.stringify({ limit: "NaN", window: 60 }));
    expect((await check(env, apiKey, tenantId, "/broken")).status).toBe(500);
  });
});
