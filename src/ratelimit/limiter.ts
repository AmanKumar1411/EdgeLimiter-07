import { DurableObject } from "cloudflare:workers";
import type { Env } from "../shared/env";
import { log } from "../shared/log";
import { ALGORITHMS, retryAfterSeconds, type AlgorithmName, type LimiterState } from "./algorithms";

export interface LimitRule {
  limit: number;
  window: number;
  algorithm: AlgorithmName;
}

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  algorithm: AlgorithmName;
  /*
   True only for the first blocked request after allowed traffic, so the
   Worker writes one audit entry per block streak, not one per blocked
   request (which would turn an attack into D1 write load).
  */
  firstBlock: boolean;
}

const STATE_KEYS = ["timestamps", "window", "count", "tokens", "lastRefill"];
// Extra time before idle state is deleted, to absorb clock skew.
const CLEANUP_GRACE_MS = 5_000;

/**
 * One counter: a tenant's route, optionally narrowed to one end user.
 * Rules arrive already validated (parseStoredPolicy, or constants).
 */
export class RateLimiter extends DurableObject<Env> {
  async check(rule: LimitRule): Promise<LimitResult> {
    const { algorithm } = rule;
    const storage = this.ctx.storage;
    const nowMs = Date.now();

    // Input gates keep get → put atomic against concurrent requests.
    const stored = Object.fromEntries(await storage.get<number | number[]>(STATE_KEYS)) as LimiterState;
    const { state, ...decision } = ALGORITHMS[algorithm](
      stored,
      { limit: rule.limit, windowSeconds: rule.window },
      nowMs,
    );
    if (state) await storage.put(state as Record<string, unknown>);

    const firstBlock = await this.trackBlockStreak(decision.allowed);
    await this.scheduleCleanup(rule.window, nowMs);

    return {
      allowed: decision.allowed,
      remaining: decision.remaining,
      retryAfter: retryAfterSeconds(decision, nowMs),
      algorithm,
      firstBlock,
    };
  }

  async reset() {
    // Each object holds exactly one counter, so clearing everything also
    // removes keys written by older versions.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Readiness probe: reaches the object without touching storage. */
  ping() {
    return "ok";
  }

  /*
   Once a full window passes with no traffic the state is equivalent to
   empty (timestamps expired, window rolled over, bucket refilled), so
   delete it instead of keeping every counter ever created.
  */
  async alarm() {
    const windowSeconds = await this.ctx.storage.get<number>("windowSeconds");
    const lastActivity = await this.lastActivityMs(windowSeconds ?? 0);

    if (!windowSeconds || lastActivity === null) {
      await this.ctx.storage.deleteAll();
      return;
    }

    const expiresAt = lastActivity + windowSeconds * 1000 + CLEANUP_GRACE_MS;
    if (Date.now() >= expiresAt) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(expiresAt);
  }

  private async trackBlockStreak(allowed: boolean) {
    const blocking = (await this.ctx.storage.get<boolean>("blocking")) ?? false;
    if (allowed) {
      if (blocking) await this.ctx.storage.delete("blocking");
      return false;
    }
    if (blocking) return false;
    await this.ctx.storage.put("blocking", true);
    return true;
  }

  private async scheduleCleanup(windowSeconds: number, nowMs: number) {
    if ((await this.ctx.storage.get<number>("windowSeconds")) !== windowSeconds) {
      await this.ctx.storage.put("windowSeconds", windowSeconds);
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(nowMs + windowSeconds * 1000 + CLEANUP_GRACE_MS);
    }
  }

  private async lastActivityMs(windowSeconds: number): Promise<number | null> {
    const state = Object.fromEntries(await this.ctx.storage.get<number | number[]>(STATE_KEYS)) as LimiterState;
    const candidates: number[] = [];
    if (state.timestamps?.length) candidates.push((Math.max(...state.timestamps) + 1) * 1000);
    // End of the stored fixed window: a conservative upper bound.
    if (state.window !== undefined) candidates.push((state.window + 1) * windowSeconds * 1000);
    if (state.lastRefill !== undefined) candidates.push(state.lastRefill);
    return candidates.length ? Math.max(...candidates) : null;
  }
}

export function limiter(env: Env, name: string) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
}

/*
 Counter names keep the tenant:route form of earlier versions so live
 counters survive deploys. An identifier is appended after "\u0000", which
 validated routes cannot contain. Internal limiters use the same prefix.
*/
export function counterName(tenantId: string, route: string, identifier?: string | null) {
  const base = `${tenantId}:${route}`;
  return identifier ? `${base}\u0000${identifier}` : base;
}

export const SYSTEM_PREFIX = "\u0000system:";

/** Fixed-window throttle for internal use (e.g. sign-ups). Fails open. */
export async function throttle(env: Env, name: string, limit: number, window: number) {
  try {
    const decision = await limiter(env, SYSTEM_PREFIX + name).check({ limit, window, algorithm: "fixed_window" });
    return decision.allowed;
  } catch (err) {
    log.error("throttle_unavailable", err, { name });
    return true;
  }
}
