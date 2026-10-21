import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { RateLimiter } from "../src/ratelimit/limiter";
import { unique } from "./helpers";

function stub() {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(unique("do")));
}

describe("RateLimiter Durable Object", () => {
  it("flags only the first block of a streak", async () => {
    const s = stub();
    const rule = { limit: 1, window: 60, algorithm: "fixed_window" } as const;
    expect(await s.check(rule)).toMatchObject({ allowed: true, firstBlock: false });
    expect(await s.check(rule)).toMatchObject({ allowed: false, firstBlock: true });
    expect(await s.check(rule)).toMatchObject({ allowed: false, firstBlock: false });

    await s.reset();
    expect(await s.check(rule)).toMatchObject({ allowed: true, firstBlock: false });
    expect(await s.check(rule)).toMatchObject({ allowed: false, firstBlock: true });
  });

  it("persists counters across eviction (simulated restart)", async () => {
    for (const algorithm of ["sliding_window", "fixed_window", "token_bucket"] as const) {
      const s = stub();
      const rule = { limit: 2, window: 3600, algorithm };
      expect((await s.check(rule)).allowed).toBe(true);
      expect((await s.check(rule)).allowed).toBe(true);

      await evictDurableObject(s);

      expect((await s.check(rule)).allowed, algorithm).toBe(false);
    }
  });

  it("schedules idle cleanup and deletes state once a full window passes", async () => {
    const s = stub();
    await s.check({ limit: 5, window: 10, algorithm: "sliding_window" });

    const alarm = await runInDurableObject(s, (_: RateLimiter, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();

    // Before expiry: the alarm re-arms and keeps state.
    await runInDurableObject(s, async (rl: RateLimiter, state) => {
      await rl.alarm();
      expect((await state.storage.list()).size).toBeGreaterThan(0);
    });

    // After a full idle window: everything is deleted.
    await runInDurableObject(s, async (rl: RateLimiter, state) => {
      const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
      try {
        await rl.alarm();
      } finally {
        clock.mockRestore();
      }
      expect((await state.storage.list()).size).toBe(0);
    });

    // A fresh request starts from a clean counter.
    expect((await s.check({ limit: 5, window: 10, algorithm: "sliding_window" })).remaining).toBe(4);
    expect(await runDurableObjectAlarm(s)).toBe(true);
  });

  it("answers readiness pings", async () => {
    expect(await stub().ping()).toBe("ok");
  });
});
