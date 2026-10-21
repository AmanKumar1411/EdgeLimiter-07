import { describe, expect, it } from "vitest";
import {
  fixedWindow,
  retryAfterSeconds,
  slidingWindow,
  tokenBucket,
  type Check,
  type LimiterState,
} from "../src/ratelimit/algorithms";

/*
 The algorithms are pure functions: these run without any Cloudflare
 runtime. Same timelines as the /check behaviour tests, one level down.
*/

const T0 = 1_800_000_000_000; // epoch ms, aligned to 60s windows

/** Feeds each decision's state into the next call, like the Durable Object does. */
function limiter(check: Check, limit: number, windowSeconds: number) {
  let state: LimiterState = {};
  return (nowMs: number) => {
    const { state: next, ...decision } = check(state, { limit, windowSeconds }, nowMs);
    if (next) state = next;
    return { ...decision, retryAfter: retryAfterSeconds(decision, nowMs) };
  };
}

describe("sliding window", () => {
  it("allows exactly `limit` per window and reopens when the oldest expires", () => {
    const hit = limiter(slidingWindow, 3, 60);
    expect(hit(T0)).toMatchObject({ allowed: true, remaining: 2, retryAfter: 0 });
    hit(T0);
    expect(hit(T0)).toMatchObject({ allowed: true, remaining: 0 });
    expect(hit(T0)).toMatchObject({ allowed: false, remaining: 0, retryAfter: 60, resetAt: T0 + 60_000 });
    expect(hit(T0 + 59_000)).toMatchObject({ allowed: false, retryAfter: 1 });
    // A request at exactly now - window has expired.
    expect(hit(T0 + 60_000)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("frees slots one by one as individual timestamps expire", () => {
    const hit = limiter(slidingWindow, 3, 60);
    hit(T0);
    hit(T0 + 10_000);
    hit(T0 + 20_000);
    expect(hit(T0 + 30_000)).toMatchObject({ allowed: false, retryAfter: 30 });
    expect(hit(T0 + 60_000).allowed).toBe(true);
    expect(hit(T0 + 60_000).allowed).toBe(false);
  });

  it("computes retryAfter from the right entry after the limit is lowered", () => {
    const state = { timestamps: [T0 / 1000, T0 / 1000 + 3, T0 / 1000 + 3] };
    const decision = slidingWindow(state, { limit: 2, windowSeconds: 60 }, T0 + 4_000);
    expect(decision).toMatchObject({ allowed: false });
    expect(retryAfterSeconds(decision, T0 + 4_000)).toBe(59);
  });

  it("skips the write when blocked and nothing expired", () => {
    const state = { timestamps: [T0 / 1000] };
    expect(slidingWindow(state, { limit: 1, windowSeconds: 60 }, T0 + 1_000).state).toBeNull();
  });

  it("rounds sub-second clocks the same as whole seconds", () => {
    const hit = limiter(slidingWindow, 1, 60);
    hit(T0);
    expect(hit(T0 + 59_500).retryAfter).toBe(1);
  });
});

describe("fixed window", () => {
  it("counts per aligned window and resets at the boundary", () => {
    const start = T0 + 120_000;
    const hit = limiter(fixedWindow, 2, 60);
    expect(hit(start)).toMatchObject({ allowed: true, remaining: 1 });
    expect(hit(start)).toMatchObject({ allowed: true, remaining: 0 });
    expect(hit(start)).toMatchObject({ allowed: false, retryAfter: 60 });
    expect(hit(start + 59_999)).toMatchObject({ allowed: false, retryAfter: 1 });
    expect(hit(start + 60_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("ignores a stale count from an earlier window", () => {
    const decision = fixedWindow({ window: 1, count: 99 }, { limit: 2, windowSeconds: 60 }, T0);
    expect(decision).toMatchObject({ allowed: true, remaining: 1, state: { count: 1 } });
  });
});

describe("token bucket", () => {
  it("bursts to limit, refills continuously, and only sets retryAfter when blocked", () => {
    // 2 tokens per 10s → one token every 5s.
    const hit = limiter(tokenBucket, 2, 10);
    expect(hit(T0)).toMatchObject({ allowed: true, remaining: 1, retryAfter: 0 });
    expect(hit(T0)).toMatchObject({ allowed: true, remaining: 0, retryAfter: 0 });
    expect(hit(T0)).toMatchObject({ allowed: false, retryAfter: 5 });
    // Half a token after 2.5s → still blocked, ~2.5s left (rounded up).
    expect(hit(T0 + 2_500)).toMatchObject({ allowed: false, retryAfter: 3 });
    expect(hit(T0 + 5_000).allowed).toBe(true);
    // A long idle period never exceeds capacity.
    expect(hit(T0 + 600_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("treats a clock that moved backwards as no elapsed time", () => {
    const decision = tokenBucket({ tokens: 0, lastRefill: T0 }, { limit: 2, windowSeconds: 10 }, T0 - 5_000);
    expect(decision.allowed).toBe(false);
  });
});
