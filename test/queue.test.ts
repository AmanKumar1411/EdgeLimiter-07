import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/shared/env";
import { check, flushQueue, makeEnv, register, savePolicy, unique } from "./helpers";

async function runBatch(
  env: Env,
  bodies: unknown[],
  inspect?: (batch: MessageBatch<unknown>) => void
) {
  const batch = createMessageBatch(
    "rate-limit-logs",
    bodies.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      attempts: 2,
      body,
    }))
  );
  inspect?.(batch);
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, ctx);
}

describe("queue consumer", () => {
  it("stores security logs and usage summaries from /check events", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);
    await savePolicy(env, apiKey, { tenantId, route: "/q", limit: 2, window: 60 });
    for (let i = 0; i < 3; i++) await check(env, apiKey, tenantId, "/q");
    await check(env, "edge_limit_bogus000000000000000000000000", tenantId, "/q");

    const result = await flushQueue(env);
    expect(result?.explicitAcks).toHaveLength(4);
    expect(result?.retryMessages).toHaveLength(0);

    const logs = await env.DB.prepare(
      "SELECT reason, allowed FROM security_logs WHERE tenant_id = ? ORDER BY id"
    ).bind(tenantId).all<any>();
    expect(logs.results.map((l) => l.reason)).toEqual([
      null,
      null,
      "rate_limit_exceeded",
      "unauthorized_api_key",
    ]);

    // Only authenticated decisions count toward usage.
    const summary = await env.DB.prepare(
      "SELECT total_requests, blocked_requests FROM logs_summary WHERE tenant_id = ?"
    ).bind(tenantId).first<any>();
    expect(summary).toEqual({ total_requests: 3, blocked_requests: 1 });
  });

  it("acks malformed messages instead of retrying them forever", async () => {
    const env = makeEnv();
    const result = await runBatch(env, [
      null,
      "string",
      { type: "security_log", tenantId: 1 },
      { apiKey: 5, blocked: "x" },
    ]);
    expect(result.explicitAcks.sort()).toEqual(["m0", "m1", "m2", "m3"]);
    expect(result.retryMessages).toHaveLength(0);
  });

  it("retries with backoff when D1 is unavailable", async () => {
    const env = makeEnv();
    const brokenDb = {
      batch: async () => {
        throw new Error("D1 unavailable");
      },
      prepare: (sql: string) => env.DB.prepare(sql),
    } as unknown as D1Database;

    const event = {
      type: "security_log",
      tenantId: unique("t"),
      apiKeyId: null,
      apiKeyHint: null,
      route: "/x",
      timestamp: new Date().toISOString(),
      allowed: true,
      remaining: 1,
      retryAfter: 0,
      ipAddress: null,
      country: null,
      colo: null,
      userAgent: null,
      reason: "api_key_missing",
    };
    let retry: ReturnType<typeof vi.spyOn> | undefined;
    const result = await runBatch({ ...env, DB: brokenDb }, [event], (batch) => {
      retry = vi.spyOn(batch.messages[0], "retry");
    });
    expect(result.explicitAcks).toHaveLength(0);
    expect(result.retryMessages.map((m) => m.msgId)).toEqual(["m0"]);
    // attempts=2 → 2^2 s backoff. (getQueueResult doesn't surface delaySeconds.)
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 4 });
  });

  it("handles events queued by the previous version (raw key) without storing the key", async () => {
    const env = makeEnv();
    const { tenantId, apiKey } = await register(env);

    const result = await runBatch(env, [
      {
        type: "security_log",
        tenantId,
        apiKey,
        route: "/old",
        timestamp: new Date().toISOString(),
        allowed: false,
        remaining: 0,
        retryAfter: 3,
        ipAddress: "198.51.100.1",
        country: "US",
        colo: "SJC",
        userAgent: "curl",
        reason: "rate_limit_exceeded",
      },
      { apiKey, blocked: 0 },
    ]);
    expect(result.explicitAcks).toHaveLength(2);

    const log = await env.DB.prepare(
      "SELECT api_key_hint FROM security_logs WHERE tenant_id = ? AND route = '/old'"
    ).bind(tenantId).first<any>();
    expect(log.api_key_hint).toMatch(/••••/);
    expect(log.api_key_hint).not.toBe(apiKey);

    const summary = await env.DB.prepare(
      "SELECT total_requests, blocked_requests FROM logs_summary WHERE tenant_id = ?"
    ).bind(tenantId).first<any>();
    expect(summary).toEqual({ total_requests: 2, blocked_requests: 1 });
  });
});
