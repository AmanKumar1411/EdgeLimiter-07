import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { hashApiKey } from "../src/keys/keys";
import { call, check, flushQueue, json, makeEnv, register, savePolicy, unique } from "./helpers";

/*
 The production D1 database predates 0001_init.sql: users has an extra
 `plan` column and nullable tenant_id/role (added by ALTER TABLE), and
 logs_summary.api_key is not UNIQUE. Two early accounts have no tenant.
 This DDL is copied from production's sqlite_master. The first remote
 attempt at 0002 failed on exactly this shape (NOT NULL logs_summary.tenant_id).
*/
const PRODUCTION_SCHEMA = [
  `CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, password TEXT, tenant_id TEXT, role TEXT DEFAULT 'client')`,
  `CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
)`,
  `CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  api_key TEXT,
  route TEXT,
  actor TEXT,
  action_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT DEFAULT 'Medium',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE logs_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key TEXT NOT NULL,
  total_requests INTEGER DEFAULT 0,
  blocked_requests INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE security_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  route TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  colo TEXT,
  user_agent TEXT,
  allowed INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  retry_after INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
];

const db = env.PROD_SHAPE_DB;
const tenant = unique("prodacme");
// Production keys are 40–43 chars (older keys were shorter).
const tenantlessKey = "edge_limit_" + "1".repeat(29); // 40 chars
const tenantlessKey2 = "edge_limit_" + "2".repeat(29);
const tenantKey = "edge_limit_" + "a".repeat(32); // 43 chars

function prodEnv() {
  return makeEnv({ DB: db });
}

beforeAll(async () => {
  for (const ddl of PRODUCTION_SCHEMA) await db.prepare(ddl).run();

  await db.batch([
    db.prepare("INSERT INTO users (id, email, role, tenant_id) VALUES (1, 'early1@x.io', 'client', NULL)"),
    db.prepare("INSERT INTO users (id, email, role, tenant_id) VALUES (2, 'early2@x.io', 'client', NULL)"),
    db.prepare("INSERT INTO users (id, email, role, tenant_id) VALUES (3, 'acme@x.io', 'client', ?)").bind(tenant),
    db.prepare("INSERT INTO users (id, email, plan, role, tenant_id) VALUES (7, 'root@x.io', 'enterprise', 'super_admin', 'admin')"),
    db.prepare("INSERT INTO api_keys (user_id, api_key) VALUES (1, ?)").bind(tenantlessKey),
    db.prepare("INSERT INTO api_keys (user_id, api_key) VALUES (2, ?)").bind(tenantlessKey2),
    db.prepare("INSERT INTO api_keys (user_id, api_key) VALUES (3, ?)").bind(tenantKey),
    // The row that made the first remote attempt fail.
    db.prepare("INSERT INTO logs_summary (api_key, total_requests, blocked_requests) VALUES (?, 9, 4)").bind(tenantlessKey),
    db.prepare("INSERT INTO logs_summary (api_key, total_requests, blocked_requests) VALUES (?, 20, 5)").bind(tenantKey),
    db.prepare(`
      INSERT INTO security_logs (tenant_id, api_key, route, ip_address, allowed, remaining, retry_after, created_at)
      VALUES (?, ?, '/x', '198.51.100.1', 0, 0, 3, ?)
    `).bind(tenant, tenantKey, new Date().toISOString()),
    db.prepare(`
      INSERT INTO audit_logs (tenant_id, api_key, actor, action_type, message, severity)
      VALUES (?, ?, 'client', 'policy_created', 'm', 'Medium')
    `).bind(tenant, tenantKey),
  ]);

  // Same sequence as production: 0001 (idempotent here), then 0002.
  for (const migration of env.TEST_MIGRATIONS) {
    for (const query of migration.queries) await db.prepare(query).run();
  }
});

describe("upgrading the production-shaped database", () => {
  it("migrates without losing data and keeps unattributable usage in the legacy table", async () => {
    const keys = await db.prepare("SELECT user_id, key_hash, legacy_key IS NOT NULL AS legacy, key_hint FROM api_keys ORDER BY user_id").all<any>();
    expect(keys.results).toEqual([
      { user_id: 1, key_hash: null, legacy: 1, key_hint: "edge_limit_1••••1111" },
      { user_id: 2, key_hash: null, legacy: 1, key_hint: "edge_limit_2••••2222" },
      { user_id: 3, key_hash: null, legacy: 1, key_hint: "edge_limit_a••••aaaa" },
    ]);

    const summary = await db.prepare("SELECT tenant_id, total_requests, blocked_requests FROM logs_summary").all();
    expect(summary.results).toEqual([{ tenant_id: tenant, total_requests: 20, blocked_requests: 5 }]);
    const legacy = await db.prepare("SELECT COUNT(*) AS n FROM logs_summary_legacy").first<{ n: number }>();
    expect(legacy?.n).toBe(2);

    const logs = JSON.stringify([
      (await db.prepare("SELECT * FROM security_logs").all()).results,
      (await db.prepare("SELECT * FROM audit_logs").all()).results,
    ]);
    expect(logs).not.toContain(tenantKey);

    // Columns the old schema had stay intact.
    const plan = await db.prepare("SELECT plan FROM users WHERE id = 7").first<{ plan: string }>();
    expect(plan?.plan).toBe("enterprise");
  });

  it("existing keys keep working and are hashed on first use", async () => {
    const e = prodEnv();
    const who = await call(e, "GET", "/whoami", { apiKey: tenantKey });
    expect(await json(who)).toMatchObject({ tenantId: tenant, role: "client" });

    const row = await db.prepare("SELECT key_hash, legacy_key FROM api_keys WHERE user_id = 3").first<any>();
    expect(row).toEqual({ key_hash: await hashApiKey(tenantKey), legacy_key: null });

    await savePolicy(e, tenantKey, { tenantId: tenant, route: "/x", limit: 1, window: 60 });
    expect((await check(e, tenantKey, tenant, "/x")).status).toBe(200);
    expect((await check(e, tenantKey, tenant, "/x")).status).toBe(429);
    await flushQueue(e);
    const summary = await db.prepare("SELECT total_requests, blocked_requests FROM logs_summary WHERE tenant_id = ?")
      .bind(tenant).first();
    expect(summary).toEqual({ total_requests: 22, blocked_requests: 6 });
  });

  it("a tenant-less account gets access to no tenant, never all tenants", async () => {
    const e = prodEnv();
    expect(await json(await call(e, "GET", "/whoami", { apiKey: tenantlessKey }))).toMatchObject({ tenantId: null });

    expect(await json(await call(e, "GET", "/top-keys", { apiKey: tenantlessKey }))).toEqual([]);
    expect((await call(e, "GET", "/config", { apiKey: tenantlessKey })).status).toBe(400);
    expect(await json(await call(e, "GET", "/client/metrics", { apiKey: tenantlessKey }))).toMatchObject({ totalRequests: 0 });
    expect((await call(e, "GET", `/security-report?tenantId=${tenant}`, { apiKey: tenantlessKey })).status).toBe(403);
    expect((await call(e, "GET", `/config?tenantId=${tenant}`, { apiKey: tenantlessKey })).status).toBe(403);
    expect((await check(e, tenantlessKey, tenant, "/x")).status).toBe(403);
    // A tenant literally named "null" must not match a NULL tenant.
    expect((await call(e, "GET", "/config?tenantId=null", { apiKey: tenantlessKey })).status).toBe(403);
    // Can still manage its own keys.
    expect((await call(e, "POST", "/keys", { apiKey: tenantlessKey })).status).toBe(200);
  });

  it("old queue messages for tenant-less keys are acked, not retried into a NOT NULL error", async () => {
    const e = prodEnv();
    const batch = createMessageBatch("rate-limit-logs", [
      { id: "old", timestamp: new Date(), attempts: 1, body: { apiKey: tenantlessKey2, blocked: 1 } },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, e);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["old"]);
  });

  it("new registrations and admin promotion work on the old users table", async () => {
    const e = prodEnv();
    const admin = await register(e, unique("admin"));
    await db.prepare("UPDATE users SET role = 'super_admin' WHERE email = ?").bind(admin.email).run();
    const top = await json(await call(e, "GET", "/top-keys", { apiKey: admin.apiKey }));
    expect(top.map((k: any) => k.tenantId)).toContain(tenant);
    const plan = await db.prepare("SELECT plan FROM users WHERE email = ?").bind(admin.email).first<{ plan: string }>();
    expect(plan?.plan).toBe("free");
  });
});
