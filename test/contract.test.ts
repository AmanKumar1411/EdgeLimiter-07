import { describe, expect, it } from "vitest";
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

/*
 Public API contract: status codes and response shapes of every endpoint
 (field names, not values). A refactor that renames or drops a field the
 dashboard or API clients rely on fails here.
*/

const keys = (value: object) => Object.keys(value).sort();

async function shape(res: Response) {
  return { status: res.status, keys: keys(await json(res)) };
}

describe("API contract", () => {
  it("public endpoints", async () => {
    const env = makeEnv();
    expect(await shape(await call(env, "GET", "/"))).toEqual({
      status: 200,
      keys: ["docs", "project", "status"],
    });
    expect(await shape(await call(env, "GET", "/health"))).toEqual({
      status: 200,
      keys: ["message", "status"],
    });
    const reg = await call(env, "POST", "/register", {
      body: { email: "contract@example.com", tenantId: "contract-co" },
    });
    expect(await shape(reg)).toEqual({
      status: 200,
      keys: ["apiKey", "email", "role", "success", "tenantId"],
    });
  });

  it("tenant endpoints", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);

    expect(await shape(await call(env, "GET", "/whoami", { apiKey }))).toEqual({
      status: 200,
      keys: ["email", "role", "tenantId"],
    });

    const saved = await json(
      await call(env, "POST", "/config", {
        apiKey,
        body: { tenantId, route: "/c", limit: 1, window: 60 },
      })
    );
    expect(keys(saved)).toEqual(["config", "message", "success"]);
    expect(keys(saved.config)).toEqual(["algorithm", "limit", "route", "tenantId", "window"]);

    const listed = await json(await call(env, "GET", "/config", { apiKey }));
    expect(keys(listed)).toEqual(["cursor", "policies", "tenantId"]);
    expect(keys(listed.policies[0])).toEqual(["algorithm", "limit", "route", "tenantId", "window"]);

    const allowed = await check(env, apiKey, tenantId, "/c");
    expect(await shape(allowed)).toEqual({
      status: 200,
      keys: ["algorithm", "allowed", "configKey", "remaining", "retryAfter", "route", "tenant"],
    });
    for (const header of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]) {
      expect(allowed.headers.get(header), header).not.toBeNull();
    }
    const blocked = await check(env, apiKey, tenantId, "/c");
    expect(await shape(blocked)).toEqual({
      status: 429,
      keys: ["algorithm", "allowed", "configKey", "remaining", "retryAfter", "route", "tenant"],
    });
    expect(blocked.headers.get("Retry-After")).not.toBeNull();
    await flushQueue(env);

    expect(
      await shape(await call(env, "POST", "/reset", { apiKey, body: { tenantId, route: "/c" } }))
    ).toEqual({ status: 200, keys: ["message", "route", "success", "tenantId"] });

    for (const [path, expected] of [
      ["/client/metrics", ["blockRate", "blockedRequests", "totalRequests"]],
      ["/client/report", ["abuseScore", "blockedRequests", "recommendation", "report", "topApiKey", "totalRequests"]],
    ] as const) {
      expect(await shape(await call(env, "GET", path, { apiKey })), path).toEqual({
        status: 200,
        keys: [...expected],
      });
    }

    const top = await json(await call(env, "GET", "/top-keys", { apiKey }));
    expect(keys(top[0])).toEqual(["abuseScore", "apiKey", "blockedRequests", "tenantId", "totalRequests"]);

    const report = await json(await call(env, "GET", `/security-report?tenantId=${tenantId}`, { apiKey }));
    expect(keys(report)).toEqual([
      "abuseScore",
      "aiSummary",
      "generatedAt",
      "intelligenceSource",
      "recentLogs",
      "recommendation",
      "tenantId",
      "topAbusiveIps",
    ]);
    expect(keys(report.recentLogs[0])).toEqual([
      "allowed",
      "apiKey",
      "colo",
      "country",
      "createdAt",
      "id",
      "ipAddress",
      "reason",
      "remaining",
      "retryAfter",
      "route",
      "tenantId",
      "userAgent",
    ]);

    const audit = await json(await call(env, "GET", `/audit-report?tenantId=${tenantId}`, { apiKey }));
    expect(keys(audit)).toEqual(["auditLogs", "tenantId"]);
    expect(keys(audit.auditLogs[0])).toEqual([
      "action_type",
      "actor",
      "api_key_hint",
      "created_at",
      "id",
      "message",
      "route",
      "severity",
      "tenant_id",
    ]);

    const created = await json(await call(env, "POST", "/keys", { apiKey }));
    expect(keys(created)).toEqual(["apiKey", "hint", "id", "success"]);
    const list = await json(await call(env, "GET", "/keys", { apiKey }));
    expect(keys(list)).toEqual(["keys"]);
    expect(keys(list.keys[0])).toEqual(["createdAt", "current", "email", "hint", "id", "revokedAt", "status"]);
    expect(
      await shape(await call(env, "POST", `/keys/${created.id}/revoke`, { apiKey }))
    ).toEqual({ status: 200, keys: ["current", "id", "status", "success"] });

    expect(
      await shape(await call(env, "DELETE", `/config?tenantId=${tenantId}&route=/c`, { apiKey }))
    ).toEqual({ status: 200, keys: ["message", "success"] });
  });

  it("admin endpoints", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/a", limit: 5, window: 60 });
    await check(env, apiKey, tenantId, "/a");
    await flushQueue(env);
    const admin = await registerAdmin(env);

    expect(await shape(await call(env, "GET", "/metrics", { apiKey: admin.apiKey }))).toEqual({
      status: 200,
      keys: ["blockRate", "blockedRequests", "totalRequests"],
    });
    expect(await shape(await call(env, "GET", "/run-report", { apiKey: admin.apiKey }))).toEqual({
      status: 200,
      keys: ["abuseScore", "blockedRequests", "recommendation", "report", "topApiKey", "totalRequests"],
    });
    const ready = await json(await call(env, "GET", "/health/ready", { apiKey: admin.apiKey }));
    expect(keys(ready)).toEqual(["checks", "status"]);
    expect(keys(ready.checks)).toEqual(["ai", "d1", "durableObject", "kv"]);
  });

  it("errors are always JSON {error} with the documented status", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    const other = await register(env);

    const cases: [string, Response][] = [
      ["400 bad json", await call(env, "POST", "/config", { apiKey, body: "{" })],
      ["400 validation", await call(env, "POST", "/config", { apiKey, body: { tenantId, route: "", limit: 1, window: 1 } })],
      ["401 missing key", await call(env, "GET", "/whoami")],
      ["401 bad key", await call(env, "GET", "/whoami", { apiKey: "nope" })],
      ["403 other tenant", await call(env, "GET", `/audit-report?tenantId=${other.tenantId}`, { apiKey })],
      ["403 admin only", await call(env, "GET", "/metrics", { apiKey })],
      ["404 no policy", await check(env, apiKey, tenantId, "/missing")],
      ["404 unknown route", await call(env, "GET", "/nope")],
      ["409 duplicate", await call(env, "POST", "/register", { body: { email: "x@y.io", tenantId } })],
      ["413 too large", await call(env, "POST", "/check", { apiKey, body: { pad: "x".repeat(20_000) } })],
    ];
    const statuses = cases.map(([name, res]) => [name, res.status]);
    expect(statuses).toEqual([
      ["400 bad json", 400],
      ["400 validation", 400],
      ["401 missing key", 401],
      ["401 bad key", 401],
      ["403 other tenant", 403],
      ["403 admin only", 403],
      ["404 no policy", 404],
      ["404 unknown route", 404],
      ["409 duplicate", 409],
      ["413 too large", 413],
    ]);
    for (const [name, res] of cases) {
      const body = await json(res);
      expect(keys(body), name).toEqual(["error"]);
      expect(typeof body.error, name).toBe("string");
    }
  });
});
