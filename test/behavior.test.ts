import { afterEach, describe, expect, it, vi } from "vitest";
import { check, json, makeEnv, register, savePolicy } from "./helpers";

/*
 Black-box timelines for each algorithm through the public /check
 endpoint, with the clock pinned. Only the HTTP contract is asserted,
 so these must keep passing however the limiter is implemented.
*/

const T0 = 1_800_000_000_000; // ms; aligned to 60s windows

afterEach(() => {
  vi.restoreAllMocks();
});

function at(ms: number) {
  vi.spyOn(Date, "now").mockReturnValue(ms);
}

async function decide(env: ReturnType<typeof makeEnv>, apiKey: string, tenantId: string, route: string) {
  const res = await check(env, apiKey, tenantId, route);
  const body = await json(res);
  return {
    status: res.status,
    remaining: body.remaining as number,
    retryAfter: body.retryAfter as number,
    retryAfterHeader: res.headers.get("Retry-After"),
  };
}

async function setup(limit: number, window: number, algorithm: string) {
  const env = makeEnv();
  const { tenantId, apiKey } = await register(env);
  const route = `/${algorithm}`;
  await savePolicy(env, apiKey, { tenantId, route, limit, window, algorithm });
  return {
    env,
    tenantId,
    apiKey,
    route,
    hit: () => decide(env, apiKey, tenantId, route),
  };
}

describe("sliding_window via /check", () => {
  it("allows the limit, then blocks until the oldest request leaves the window", async () => {
    const { hit } = await setup(3, 60, "sliding_window");
    at(T0);
    expect(await hit()).toMatchObject({ status: 200, remaining: 2, retryAfterHeader: null });
    expect(await hit()).toMatchObject({ status: 200, remaining: 1 });
    expect(await hit()).toMatchObject({ status: 200, remaining: 0 });
    expect(await hit()).toMatchObject({ status: 429, remaining: 0, retryAfter: 60, retryAfterHeader: "60" });

    at(T0 + 59_000);
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 1 });
    at(T0 + 60_000);
    expect(await hit()).toMatchObject({ status: 200, remaining: 2 });
  });

  it("frees slots one at a time as individual requests expire", async () => {
    const { hit } = await setup(3, 60, "sliding_window");
    at(T0);
    await hit();
    at(T0 + 10_000);
    await hit();
    at(T0 + 20_000);
    await hit();
    at(T0 + 30_000);
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 30 });
    at(T0 + 60_000);
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(429);
  });

  it("reports retryAfter correctly after the limit is lowered", async () => {
    const ctx = await setup(3, 60, "sliding_window");
    at(T0);
    await ctx.hit();
    at(T0 + 3_000);
    await ctx.hit();
    await ctx.hit();
    vi.restoreAllMocks();
    await savePolicy(ctx.env, ctx.apiKey, { tenantId: ctx.tenantId, route: ctx.route, limit: 2, window: 60 });
    at(T0 + 4_000);
    expect(await ctx.hit()).toMatchObject({ status: 429, retryAfter: 59 });
  });
});

describe("fixed_window via /check", () => {
  it("counts per aligned window and resets exactly at the boundary", async () => {
    const { hit } = await setup(2, 60, "fixed_window");
    const start = T0 + 120_000;
    at(start);
    expect(await hit()).toMatchObject({ status: 200, remaining: 1 });
    expect(await hit()).toMatchObject({ status: 200, remaining: 0 });
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 60 });
    at(start + 59_999);
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 1 });
    at(start + 60_000);
    expect(await hit()).toMatchObject({ status: 200, remaining: 1 });
  });
});

describe("token_bucket via /check", () => {
  it("bursts to the limit, refills continuously, never exceeds capacity", async () => {
    const { hit } = await setup(2, 10, "token_bucket");
    at(T0);
    expect(await hit()).toMatchObject({ status: 200, remaining: 1, retryAfter: 0 });
    expect(await hit()).toMatchObject({ status: 200, remaining: 0, retryAfter: 0, retryAfterHeader: null });
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 5 });
    at(T0 + 2_500);
    expect(await hit()).toMatchObject({ status: 429, retryAfter: 3 });
    at(T0 + 5_000);
    expect((await hit()).status).toBe(200);
    at(T0 + 600_000);
    expect(await hit()).toMatchObject({ status: 200, remaining: 1 });
  });
});
