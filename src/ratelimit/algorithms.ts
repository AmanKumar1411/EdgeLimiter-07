/*
 The three algorithms as pure functions: state + rule + clock in, decision
 + next state out. No Cloudflare APIs, so they are unit-testable as-is.

 State field names double as Durable Object storage keys and must not
 change, or counters stored by a previous deploy would be ignored.
*/

interface Rule {
  limit: number;
  windowSeconds: number;
}

export interface Decision {
  allowed: boolean;
  remaining: number;
  /** Epoch ms at which a request would next be allowed (`nowMs` if allowed now). */
  resetAt: number;
}

export interface LimiterState {
  /** sliding_window: unix seconds of requests still in the window. */
  timestamps?: number[];
  /** fixed_window: index of the current window, and requests counted in it. */
  window?: number;
  count?: number;
  /** token_bucket: tokens left, and when they were last topped up (epoch ms). */
  tokens?: number;
  lastRefill?: number;
}

/** `state` is null when nothing needs to be written back. */
export type Check = (state: LimiterState, rule: Rule, nowMs: number) => Decision & { state: LimiterState | null };

export const slidingWindow: Check = ({ timestamps = [] }, { limit, windowSeconds }, nowMs) => {
  const now = Math.floor(nowMs / 1000);
  // A request at exactly now - window has expired.
  const live = timestamps.filter((t) => now - t < windowSeconds);

  if (live.length < limit) {
    live.push(now);
    return { allowed: true, remaining: limit - live.length, resetAt: nowMs, state: { timestamps: live } };
  }

  // A slot frees once enough entries expire to drop below `limit`. That is
  // the oldest entry only when the list is exactly full; after the limit is
  // lowered it can hold more entries than the new limit.
  const freesAt = live[live.length - limit] + windowSeconds;
  return {
    allowed: false,
    remaining: 0,
    resetAt: freesAt * 1000,
    state: live.length === timestamps.length ? null : { timestamps: live },
  };
};

export const fixedWindow: Check = (state, { limit, windowSeconds }, nowMs) => {
  const now = Math.floor(nowMs / 1000);
  const window = Math.floor(now / windowSeconds);
  let count = (state.window ?? window) === window ? (state.count ?? 0) : 0;

  const allowed = count < limit;
  if (allowed) count += 1;

  return {
    allowed,
    remaining: Math.max(0, limit - count),
    resetAt: allowed ? nowMs : (window + 1) * windowSeconds * 1000,
    state: { window, count },
  };
};

export const tokenBucket: Check = (state, { limit, windowSeconds }, nowMs) => {
  const refillPerMs = limit / (windowSeconds * 1000);
  const elapsed = Math.max(0, nowMs - (state.lastRefill ?? nowMs));
  let tokens = Math.min(limit, (state.tokens ?? limit) + elapsed * refillPerMs);

  const allowed = tokens >= 1;
  if (allowed) tokens -= 1;

  return {
    allowed,
    remaining: Math.floor(tokens),
    // Whole milliseconds, so the seconds derived from it round exactly as
    // ceil((1 - tokens) / rate) would.
    resetAt: allowed ? nowMs : nowMs + Math.ceil((1 - tokens) / refillPerMs),
    state: { tokens, lastRefill: nowMs },
  };
};

export const ALGORITHMS = {
  sliding_window: slidingWindow,
  fixed_window: fixedWindow,
  token_bucket: tokenBucket,
} satisfies Record<string, Check>;

export type AlgorithmName = keyof typeof ALGORITHMS;

export function isAlgorithm(name: unknown): name is AlgorithmName {
  return typeof name === "string" && Object.hasOwn(ALGORITHMS, name);
}

/** Seconds to wait before retrying, as reported to clients. */
export function retryAfterSeconds(decision: Decision, nowMs: number) {
  return decision.allowed ? 0 : Math.ceil((decision.resetAt - nowMs) / 1000);
}
