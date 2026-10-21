import { describe, expect, it } from "vitest";
import { hashApiKey } from "../src/keys/keys";
import { call, check, flushQueue, json, makeEnv, register, registerAdmin, savePolicy, unique } from "./helpers";

describe("registration", () => {
  it("creates a tenant, shows the key once, and stores only its hash", async () => {
    const env = makeEnv();
    const { tenantId, apiKey, email } = await register(env);
    expect(apiKey).toMatch(/^edge_limit_[0-9a-f]{32}$/);

    const row = await env.DB.prepare(
      `
      SELECT a.key_hash, a.legacy_key, a.key_hint, u.tenant_id
      FROM api_keys a JOIN users u ON u.id = a.user_id WHERE u.email = ?
    `,
    )
      .bind(email)
      .first<any>();
    expect(row.key_hash).toBe(await hashApiKey(apiKey));
    expect(row.legacy_key).toBeNull();
    expect(row.key_hint).not.toContain(apiKey.slice(12, -4));
    expect(row.tenant_id).toBe(tenantId);

    const who = await call(env, "GET", "/whoami", { apiKey });
    expect(await json(who)).toMatchObject({ email, tenantId, role: "client" });
  });

  it("rejects joining an existing tenant unless the caller is super_admin", async () => {
    const env = makeEnv();
    const owner = await register(env);

    const hijack = await call(env, "POST", "/register", {
      body: { email: `${unique("evil")}@example.com`, tenantId: owner.tenantId },
    });
    expect(hijack.status).toBe(409);

    // A client key doesn't help either.
    const viaClient = await call(env, "POST", "/register", {
      apiKey: owner.apiKey,
      body: { email: `${unique("evil")}@example.com`, tenantId: owner.tenantId },
    });
    expect(viaClient.status).toBe(409);

    const admin = await registerAdmin(env);
    const added = await call(env, "POST", "/register", {
      apiKey: admin.apiKey,
      body: { email: `${unique("mate")}@example.com`, tenantId: owner.tenantId },
    });
    expect(added.status).toBe(200);

    const orphans = await env.DB.prepare(
      `
      SELECT COUNT(*) AS n FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM api_keys a WHERE a.user_id = u.id)
    `,
    ).first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });

  it("validates tenant IDs (no ':' — it would collide KV/DO keys across tenants)", async () => {
    const env = makeEnv();
    for (const tenantId of ["acme:get", "-acme", "a".repeat(65), "has space", "UP:per"]) {
      const res = await call(env, "POST", "/register", {
        body: { email: `${unique("u")}@example.com`, tenantId },
      });
      expect(res.status, tenantId).toBe(400);
    }
    const badEmail = await call(env, "POST", "/register", {
      body: { email: "not-an-email", tenantId: unique("t") },
    });
    expect(badEmail.status).toBe(400);
    expect((await call(env, "POST", "/register", { body: "{bad" })).status).toBe(400);
    expect(
      (
        await call(env, "POST", "/register", {
          body: { email: `${unique("u")}@example.com`, tenantId: unique("t"), role: "super_admin" },
        })
      ).status,
    ).toBe(400);
  });

  it("rejects duplicate emails", async () => {
    const env = makeEnv();
    const { email } = await register(env);
    const dup = await call(env, "POST", "/register", {
      body: { email, tenantId: unique("t") },
    });
    expect(dup.status).toBe(409);
  });

  it("throttles public registration per IP", async () => {
    const env = makeEnv();
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await call(env, "POST", "/register", {
        ip,
        body: { email: `${unique("u")}@example.com`, tenantId: unique("t") },
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);

    // Other IPs and admins are unaffected.
    expect(
      (
        await call(env, "POST", "/register", {
          body: { email: `${unique("u")}@example.com`, tenantId: unique("t") },
        })
      ).status,
    ).toBe(200);
  });
});

describe("API key validation and revocation", () => {
  it("rejects missing, unknown and oversized keys", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/a", limit: 5, window: 60 });

    expect((await call(env, "POST", "/check", { body: { tenantId, route: "/a" } })).status).toBe(401);
    expect((await check(env, "edge_limit_" + "0".repeat(32), tenantId, "/a")).status).toBe(401);
    expect((await check(env, "k".repeat(5000), tenantId, "/a")).status).toBe(401);
    expect((await call(env, "GET", "/whoami", { apiKey: "nope" })).status).toBe(401);
  });

  it("revocation takes effect on the very next request", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/a", limit: 50, window: 60 });

    const created = await json(await call(env, "POST", "/keys", { apiKey }));
    expect(created.apiKey).toMatch(/^edge_limit_/);
    expect((await check(env, created.apiKey, tenantId, "/a")).status).toBe(200);

    const revoke = await call(env, "POST", `/keys/${created.id}/revoke`, { apiKey });
    expect(revoke.status).toBe(200);

    expect((await check(env, created.apiKey, tenantId, "/a")).status).toBe(401);
    expect((await call(env, "GET", "/whoami", { apiKey: created.apiKey })).status).toBe(401);
    // The other key still works.
    expect((await check(env, apiKey, tenantId, "/a")).status).toBe(200);

    const keys = await json(await call(env, "GET", "/keys", { apiKey }));
    expect(keys.keys.map((k: any) => k.status).sort()).toEqual(["active", "revoked"]);
    expect(JSON.stringify(keys)).not.toContain(created.apiKey);
  });

  it("clients cannot list or revoke other users' keys; admins can", async () => {
    const env = makeEnv();
    const a = await register(env);
    const b = await register(env);
    const bKeys = await json(await call(env, "GET", "/keys", { apiKey: b.apiKey }));
    const bKeyId = bKeys.keys[0].id;

    expect((await call(env, "POST", `/keys/${bKeyId}/revoke`, { apiKey: a.apiKey })).status).toBe(404);
    // ?tenantId is ignored for clients.
    const aView = await json(await call(env, "GET", `/keys?tenantId=${b.tenantId}`, { apiKey: a.apiKey }));
    expect(aView.keys.every((k: any) => k.email === a.email)).toBe(true);

    const admin = await registerAdmin(env);
    const adminView = await json(await call(env, "GET", `/keys?tenantId=${b.tenantId}`, { apiKey: admin.apiKey }));
    expect(adminView.keys.map((k: any) => k.id)).toEqual([bKeyId]);
    expect((await call(env, "POST", `/keys/${bKeyId}/revoke`, { apiKey: admin.apiKey })).status).toBe(200);
    expect((await call(env, "GET", "/whoami", { apiKey: b.apiKey })).status).toBe(401);
  });

  it("upgrades legacy plaintext keys to hashes on first use", async () => {
    const env = makeEnv();
    const tenantId = unique("legacy");
    const legacyKey = "edge_limit_" + "ab".repeat(16);
    const user = await env.DB.prepare("INSERT INTO users (email, role, tenant_id) VALUES (?, 'client', ?)")
      .bind(`${unique("l")}@example.com`, tenantId)
      .run();
    await env.DB.prepare("INSERT INTO api_keys (user_id, legacy_key, key_hint) VALUES (?, ?, 'edge_limit_a••••abab')")
      .bind(user.meta.last_row_id, legacyKey)
      .run();

    expect((await call(env, "GET", "/whoami", { apiKey: legacyKey })).status).toBe(200);

    const row = await env.DB.prepare("SELECT key_hash, legacy_key FROM api_keys WHERE user_id = ?")
      .bind(user.meta.last_row_id)
      .first<any>();
    expect(row.legacy_key).toBeNull();
    expect(row.key_hash).toBe(await hashApiKey(legacyKey));
    expect((await call(env, "GET", "/whoami", { apiKey: legacyKey })).status).toBe(200);
  });

  it("never writes the raw key to D1 logs, summaries or the queue", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/a", limit: 1, window: 60 });
    await check(env, apiKey, tenantId, "/a");
    await check(env, apiKey, tenantId, "/a"); // blocked → audit entry
    await call(env, "POST", "/reset", { apiKey, body: { tenantId, route: "/a" } });

    expect(JSON.stringify(env.sent)).not.toContain(apiKey);
    await flushQueue(env);

    const secret = apiKey.slice(11);
    for (const sql of [
      "SELECT * FROM api_keys",
      "SELECT * FROM logs_summary",
      "SELECT * FROM security_logs",
      "SELECT * FROM audit_logs",
    ]) {
      const rows = await env.DB.prepare(sql).all();
      expect(JSON.stringify(rows.results), sql).not.toContain(secret);
    }
  });
});

describe("RBAC and tenant isolation", () => {
  it("restricts admin-only endpoints", async () => {
    const env = makeEnv();
    const client = await register(env);
    const admin = await registerAdmin(env);

    for (const path of ["/metrics", "/run-report", "/health/ready"]) {
      expect((await call(env, "GET", path)).status, path).toBe(401);
      expect((await call(env, "GET", path, { apiKey: client.apiKey })).status, path).toBe(403);
      expect((await call(env, "GET", path, { apiKey: admin.apiKey })).status, path).toBe(200);
    }
  });

  it("blocks clients from every other-tenant endpoint", async () => {
    const env = makeEnv();
    const a = await register(env);
    const b = await register(env);
    await savePolicy(env, b.apiKey, { tenantId: b.tenantId, route: "/b", limit: 5, window: 60 });

    const forbidden: [string, string, unknown?][] = [
      ["POST", "/config", { tenantId: b.tenantId, route: "/b", limit: 1, window: 60 }],
      ["GET", `/config?tenantId=${b.tenantId}`],
      ["DELETE", `/config?tenantId=${b.tenantId}&route=/b`],
      ["POST", "/reset", { tenantId: b.tenantId, route: "/b" }],
      ["GET", `/security-report?tenantId=${b.tenantId}`],
      ["GET", `/audit-report?tenantId=${b.tenantId}`],
    ];
    for (const [method, path, body] of forbidden) {
      const res = await call(env, method, path, { apiKey: a.apiKey, body });
      expect(res.status, `${method} ${path}`).toBe(403);
    }

    // /check with another tenant's ID is a tenant mismatch.
    expect((await check(env, a.apiKey, b.tenantId, "/b")).status).toBe(403);

    // B's policy is untouched.
    expect((await check(env, b.apiKey, b.tenantId, "/b")).headers.get("X-RateLimit-Limit")).toBe("5");
  });

  it("scopes tenant data endpoints to the caller's tenant", async () => {
    const env = makeEnv();
    const a = await register(env);
    const b = await register(env);
    for (const t of [a, b]) {
      await savePolicy(env, t.apiKey, { tenantId: t.tenantId, route: "/s", limit: 5, window: 60 });
      await check(env, t.apiKey, t.tenantId, "/s");
    }
    await flushQueue(env);

    const topKeys = await json(await call(env, "GET", "/top-keys", { apiKey: a.apiKey }));
    expect(topKeys.every((k: any) => k.tenantId === a.tenantId)).toBe(true);

    const metrics = await json(await call(env, "GET", `/client/metrics?tenantId=${b.tenantId}`, { apiKey: a.apiKey }));
    expect(metrics.totalRequests).toBe(1); // a's own, param ignored

    const admin = await registerAdmin(env);
    const drill = await json(
      await call(env, "GET", `/client/metrics?tenantId=${b.tenantId}`, { apiKey: admin.apiKey }),
    );
    expect(drill.totalRequests).toBe(1);
    const adminTop = await json(await call(env, "GET", `/top-keys?tenantId=${b.tenantId}`, { apiKey: admin.apiKey }));
    expect(adminTop.map((k: any) => k.tenantId)).toEqual([b.tenantId]);
  });
});
