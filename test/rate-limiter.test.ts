import {
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { RateLimiter } from "../src/durable-objects/RateLimiter";
import { unique } from "./helpers";

function stub() {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(unique("do")));
}

function inDO<R>(
  s: DurableObjectStub,
  fn: (instance: RateLimiter) => Promise<R>
) {
  return runInDurableObject(s, (instance: RateLimiter) => fn(instance));
}

async function hit(
  s: DurableObjectStub,
  body: Record<string, unknown>
) {
  const res = await s.fetch("http://do/check", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as any };
}

const T0 = 1_800_000_000_000; // fixed epoch ms, aligned to 60s windows

describe("sliding_window", () => {
  it("allows exactly `limit` per window and reopens when the oldest expires", async () => {
    const s = stub();
    await inDO(s, async (rl) => {
      for (let i = 0; i < 3; i++) {
        expect((await rl.slidingWindow(3, 60, T0)).allowed).toBe(true);
      }
      const blocked = await rl.slidingWindow(3, 60, T0);
      expect(blocked).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60 });

      expect(await rl.slidingWindow(3, 60, T0 + 59_000)).toMatchObject({
        allowed: false,
        retryAfter: 1,
      });
      // now - ts < window → at exactly +60s the entries have expired.
      expect(await rl.slidingWindow(3, 60, T0 + 60_000)).toMatchObject({
        allowed: true,
        remaining: 2,
      });
    });
  });

  it("frees slots one by one as individual timestamps expire", async () => {
    const s = stub();
    await inDO(s, async (rl) => {
      await rl.slidingWindow(3, 60, T0);
      await rl.slidingWindow(3, 60, T0 + 10_000);
      await rl.slidingWindow(3, 60, T0 + 20_000);
      expect(await rl.slidingWindow(3, 60, T0 + 30_000)).toMatchObject({
        allowed: false,
        retryAfter: 30,
      });
      expect((await rl.slidingWindow(3, 60, T0 + 60_000)).allowed).toBe(true);
      expect((await rl.slidingWindow(3, 60, T0 + 60_000)).allowed).toBe(false);
    });
  });

  it("computes retryAfter from the right entry after the limit is lowered", async () => {
    const s = stub();
    await inDO(s, async (rl) => {
      await rl.slidingWindow(3, 60, T0);
      await rl.slidingWindow(3, 60, T0 + 3_000);
      await rl.slidingWindow(3, 60, T0 + 3_000);
      // New limit 2: a slot frees when the 2nd-oldest (T0+3s) expires.
      expect(await rl.slidingWindow(2, 60, T0 + 4_000)).toMatchObject({
        allowed: false,
        retryAfter: 59,
      });
    });
  });
});

describe("fixed_window", () => {
  it("counts per aligned window and resets at the boundary", async () => {
    const s = stub();
    const start = T0 + 120_000; // start of a 60s window
    await inDO(s, async (rl) => {
      expect(await rl.fixedWindow(2, 60, start)).toMatchObject({ allowed: true, remaining: 1 });
      expect(await rl.fixedWindow(2, 60, start)).toMatchObject({ allowed: true, remaining: 0 });
      expect(await rl.fixedWindow(2, 60, start)).toMatchObject({ allowed: false, retryAfter: 60 });
      expect(await rl.fixedWindow(2, 60, start + 59_999)).toMatchObject({
        allowed: false,
        retryAfter: 1,
      });
      expect(await rl.fixedWindow(2, 60, start + 60_000)).toMatchObject({
        allowed: true,
        remaining: 1,
      });
    });
  });
});

describe("token_bucket", () => {
  it("bursts to limit, refills continuously, and only sets retryAfter when blocked", async () => {
    const s = stub();
    await inDO(s, async (rl) => {
      // 2 tokens per 10s → one token every 5s.
      expect(await rl.tokenBucket(2, 10, T0)).toMatchObject({ allowed: true, remaining: 1, retryAfter: 0 });
      expect(await rl.tokenBucket(2, 10, T0)).toMatchObject({ allowed: true, remaining: 0, retryAfter: 0 });
      expect(await rl.tokenBucket(2, 10, T0)).toMatchObject({ allowed: false, retryAfter: 5 });
      // Half a token after 2.5s → still blocked, ~2.5s left (rounded up).
      expect(await rl.tokenBucket(2, 10, T0 + 2_500)).toMatchObject({ allowed: false, retryAfter: 3 });
      expect((await rl.tokenBucket(2, 10, T0 + 5_000)).allowed).toBe(true);
      // Long idle never exceeds capacity.
      expect(await rl.tokenBucket(2, 10, T0 + 600_000)).toMatchObject({ allowed: true, remaining: 1 });
    });
  });
});

describe("Durable Object fetch", () => {
  it("rejects invalid limits instead of computing with NaN", async () => {
    const s = stub();
    expect((await hit(s, { limit: "abc", window: 60 })).status).toBe(400);
    expect((await hit(s, { limit: 2.5, window: 60 })).status).toBe(400);
    expect((await hit(s, { limit: 5, window: 0 })).status).toBe(400);
  });

  it("flags only the first block of a streak", async () => {
    const s = stub();
    const body = { limit: 1, window: 60, algorithm: "fixed_window" };
    expect((await hit(s, body)).data).toMatchObject({ allowed: true, firstBlock: false });
    expect((await hit(s, body)).data).toMatchObject({ allowed: false, firstBlock: true });
    expect((await hit(s, body)).data).toMatchObject({ allowed: false, firstBlock: false });

    await s.fetch("http://do/reset", {
      method: "POST",
      body: JSON.stringify({ type: "reset", tenantId: "t", route: "r" }),
    });
    expect((await hit(s, body)).data).toMatchObject({ allowed: true, firstBlock: false });
    expect((await hit(s, body)).data).toMatchObject({ allowed: false, firstBlock: true });
  });

  it("persists counters across eviction (simulated restart)", async () => {
    for (const algorithm of ["sliding_window", "fixed_window", "token_bucket"]) {
      const s = stub();
      const body = { limit: 2, window: 3600, algorithm };
      expect((await hit(s, body)).data.allowed).toBe(true);
      expect((await hit(s, body)).data.allowed).toBe(true);

      await evictDurableObject(s);

      expect((await hit(s, body)).data.allowed, algorithm).toBe(false);
    }
  });

  it("schedules idle cleanup and deletes state once a full window passes", async () => {
    const s = stub();
    await hit(s, { limit: 5, window: 10, algorithm: "sliding_window" });

    const alarm = await inDO(s, async (rl) => rl.state.storage.getAlarm());
    expect(alarm).not.toBeNull();

    // Before expiry: alarm re-arms and keeps state.
    await inDO(s, async (rl) => {
      await rl.alarm();
      expect((await rl.state.storage.list()).size).toBeGreaterThan(0);
    });

    // After a full idle window: everything is deleted.
    await inDO(s, async (rl) => {
      const spy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
      try {
        await rl.alarm();
      } finally {
        spy.mockRestore();
      }
      expect((await rl.state.storage.list()).size).toBe(0);
    });

    // A fresh request starts from a clean counter.
    expect((await hit(s, { limit: 5, window: 10 })).data.remaining).toBe(4);
    expect(await runDurableObjectAlarm(s)).toBe(true);
  });
});
