import { env as realEnv } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/shared/env";
import { call, check, flushQueue, json, makeEnv, register, savePolicy } from "./helpers";

const failingKv = {
  get: async () => {
    throw new Error("KV unavailable");
  },
} as unknown as KVNamespace;

const failingDo = {
  idFromName: (name: string) => realEnv.RATE_LIMITER.idFromName(name),
  get: () => ({
    check: async () => {
      throw new Error("Durable Object unavailable");
    },
  }),
} as unknown as DurableObjectNamespace;

const failingDb = {
  prepare: () => {
    throw new Error("D1 unavailable");
  },
} as unknown as D1Database;

async function setup() {
  const env = makeEnv();
  const account = await register(env);
  await savePolicy(env, account.apiKey, {
    tenantId: account.tenantId,
    route: "/r",
    limit: 5,
    window: 60,
  });
  return { env, ...account };
}

describe("fail-open / fail-closed", () => {
  for (const [name, override, reason] of [
    ["KV", { CONFIG_KV: failingKv }, "policy_unavailable"],
    ["Durable Object", { RATE_LIMITER: failingDo }, "limiter_unavailable"],
  ] as const) {
    it(`${name} failure → allow + degraded header by default`, async () => {
      const { env, tenantId, apiKey } = await setup();
      const res = await check({ ...env, ...override } as Env, apiKey, tenantId, "/r");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-EdgeLimiter-Degraded")).toBe(reason);
      expect(await json(res)).toMatchObject({ allowed: true, degraded: reason });
    });

    it(`${name} failure → 503 with RATE_LIMIT_FAIL_MODE=closed`, async () => {
      const { env, tenantId, apiKey } = await setup();
      const res = await check({ ...env, ...override, RATE_LIMIT_FAIL_MODE: "closed" } as Env, apiKey, tenantId, "/r");
      expect(res.status).toBe(503);
      expect(res.headers.get("X-EdgeLimiter-Degraded")).toBe(reason);
    });
  }

  it("D1 failure during authentication always fails closed", async () => {
    const { env, tenantId, apiKey } = await setup();
    const res = await check({ ...env, DB: failingDb }, apiKey, tenantId, "/r");
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ degraded: "auth_unavailable" });
  });

  it("unexpected errors elsewhere return a JSON 500 without internals", async () => {
    const { env, apiKey } = await setup();
    // Auth succeeds on the real DB, then the report query hits a broken DB.
    let calls = 0;
    const flakyDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            calls += 1;
            if (calls > 1) throw new Error("secret internal detail");
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    const res = await call({ ...env, DB: flakyDb }, "GET", "/client/metrics", { apiKey });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret internal detail");
  });
});

describe("logging never blocks or fails a request", () => {
  it("queue send failure", async () => {
    const { env, tenantId, apiKey } = await setup();
    const brokenQueue = {
      send: async () => {
        throw new Error("queue down");
      },
    } as unknown as Queue;
    const res = await check({ ...env, LOG_QUEUE: brokenQueue }, apiKey, tenantId, "/r");
    expect(res.status).toBe(200);
  });

  it("analytics and audit write failures", async () => {
    const { env, tenantId, apiKey } = await setup();
    const brokenAnalytics = {
      writeDataPoint: () => {
        throw new Error("AE down");
      },
    } as unknown as AnalyticsEngineDataset;
    // Audit writes fail but the policy save itself (KV) succeeds.
    let n = 0;
    const auditFailingDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("INSERT INTO audit_logs")) {
              n += 1;
              throw new Error("audit down");
            }
            return target.prepare(sql);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    const broken = { ...env, ANALYTICS: brokenAnalytics, DB: auditFailingDb };

    expect((await check(broken, apiKey, tenantId, "/r")).status).toBe(200);
    const saved = await call(broken, "POST", "/config", {
      apiKey,
      body: { tenantId, route: "/r2", limit: 1, window: 60 },
    });
    expect(saved.status).toBe(200);
    expect(n).toBeGreaterThan(0);
  });
});

describe("Workers AI security intelligence (mocked)", () => {
  async function withBlockedTraffic(blocked = 12) {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/login", limit: 1, window: 3600 });
    for (let i = 0; i <= blocked; i++) {
      await check(env, apiKey, tenantId, "/login");
    }
    await flushQueue(env);
    return { env, tenantId, apiKey };
  }

  function report(env: Env, tenantId: string, apiKey: string) {
    return call(env, "GET", `/security-report?tenantId=${tenantId}`, { apiKey });
  }

  it("falls back to rules when AI is not bound, throws, times out or returns garbage", async () => {
    const { env, tenantId, apiKey } = await withBlockedTraffic();

    const variants: Record<string, Ai | undefined> = {
      unbound: undefined,
      throws: {
        run: vi.fn(async () => {
          throw new Error("AI down");
        }),
      } as unknown as Ai,
      hangs: { run: vi.fn(() => new Promise(() => {})) } as unknown as Ai,
      garbage: { run: vi.fn(async () => ({ response: "not json at all" })) } as unknown as Ai,
    };

    for (const [name, AI] of Object.entries(variants)) {
      // Fresh cache per variant.
      await env.DB.prepare("DELETE FROM ai_insights WHERE tenant_id = ?").bind(tenantId).run();
      const started = Date.now();
      const res = await report({ ...env, AI, AI_TIMEOUT_MS: "100" }, tenantId, apiKey);
      expect(res.status, name).toBe(200);
      const data = await json(res);
      expect(data.intelligenceSource, name).toBe("rules");
      expect(data.abuseScore, name).toBe(95); // 12/13 blocked → Critical
      expect(data.aiSummary, name).toContain("blocked requests");
      expect(Date.now() - started, name).toBeLessThan(2_000);
    }
  });

  it("answers from rules immediately, refreshes with AI in the background, then serves the cached AI result", async () => {
    const { env, tenantId, apiKey } = await withBlockedTraffic();
    const run = vi.fn(async () => ({
      response: JSON.stringify({
        summary: "Single IP hammering /login.",
        abuseScore: "Low", // below the rule-based Critical
        recommendation: "Block it.",
      }),
    }));
    const aiEnv = { ...env, AI: { run } as unknown as Ai };

    // Workers AI is not in the request path: the first report uses rules,
    // and the AI runs after the response (call() waits for waitUntil work).
    const first = await json(await report(aiEnv, tenantId, apiKey));
    expect(first).toMatchObject({ intelligenceSource: "rules", abuseScore: 95 });
    expect(run).toHaveBeenCalledTimes(1);

    const second = await json(await report(aiEnv, tenantId, apiKey));
    expect(second).toMatchObject({
      intelligenceSource: "ai",
      aiSummary: "Single IP hammering /login.",
      recommendation: "Block it.",
      abuseScore: 95, // rule-based Critical is a floor under the AI's "Low"
    });
    expect(run).toHaveBeenCalledTimes(1); // served from cache
    // New logs within the staleness window → still cached.
    await check(env, apiKey, tenantId, "/login");
    await flushQueue(env);
    const third = await json(await report(aiEnv, tenantId, apiKey));
    expect(run).toHaveBeenCalledTimes(1);
    expect(third.intelligenceSource).toBe("ai");
  });

  it("does not call AI when there are no logs", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    const run = vi.fn();
    const res = await report({ ...env, AI: { run } as unknown as Ai }, tenantId, apiKey);
    expect(res.status).toBe(200);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("request size limits", () => {
  it("rejects oversized bodies with 413", async () => {
    const { env, tenantId, apiKey } = await setup();
    const res = await call(env, "POST", "/check", {
      apiKey,
      body: { tenantId, route: "/r", padding: "x".repeat(20_000) },
    });
    expect(res.status).toBe(413);

    // Declared Content-Length path.
    const declared = await call(env, "POST", "/config", {
      apiKey,
      headers: { "Content-Length": "999999" },
      body: "{}",
    });
    expect(declared.status).toBe(413);
  });
});
