import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/*
 Applies 0001, seeds data in the pre-0002 shape (plaintext keys), then
 applies 0002 — on a scratch D1 database, not the one other tests use.
*/
describe("migration 0002 on legacy data", () => {
  it("moves keys to legacy_key, re-keys summaries, and masks logged keys", async () => {
    const db = env.MIGRATION_DB;
    const [init, harden] = env.TEST_MIGRATIONS;
    expect(init.name).toBe("0001_init.sql");
    expect(harden.name).toBe("0002_hash_api_keys.sql");

    for (const q of init.queries) await db.prepare(q).run();

    const key = "edge_limit_" + "c".repeat(32);
    await db.batch([
      db.prepare("INSERT INTO users (email, role, tenant_id) VALUES ('m@x.io', 'client', 'acme')"),
      db.prepare("INSERT INTO api_keys (user_id, api_key) VALUES (1, ?)").bind(key),
      db.prepare("INSERT INTO logs_summary (api_key, total_requests, blocked_requests) VALUES (?, 7, 2)").bind(key),
      db
        .prepare(
          `
        INSERT INTO security_logs (tenant_id, api_key, route, allowed, remaining, retry_after, created_at)
        VALUES ('acme', ?, '/a', 1, 1, 0, '2026-01-01T00:00:00.000Z')
      `,
        )
        .bind(key),
      db
        .prepare(
          `
        INSERT INTO audit_logs (tenant_id, api_key, actor, action_type, message, severity)
        VALUES ('acme', ?, 'admin', 'policy_created', 'm', 'Medium')
      `,
        )
        .bind(key),
    ]);

    for (const q of harden.queries) await db.prepare(q).run();

    const apiKey = await db.prepare("SELECT key_hash, legacy_key, key_hint, status FROM api_keys").first<any>();
    expect(apiKey).toMatchObject({ key_hash: null, legacy_key: key, status: "active" });
    expect(apiKey.key_hint).toBe("edge_limit_c••••cccc");

    const summary = await db
      .prepare("SELECT api_key_id, tenant_id, total_requests, blocked_requests FROM logs_summary")
      .first();
    expect(summary).toEqual({ api_key_id: 1, tenant_id: "acme", total_requests: 7, blocked_requests: 2 });

    const dump = JSON.stringify([
      (await db.prepare("SELECT * FROM security_logs").all()).results,
      (await db.prepare("SELECT * FROM audit_logs").all()).results,
    ]);
    expect(dump).not.toContain(key);
    expect(dump).toContain("edge_limit_c••••cccc");
  });
});
