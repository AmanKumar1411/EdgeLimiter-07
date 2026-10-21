import type { Context } from "hono";
import type { RateLimiter } from "../ratelimit/limiter";

export interface Env {
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  CONFIG_KV: KVNamespace;
  DB: D1Database;
  LOG_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  // Optional so the Worker (and tests) run without Workers AI.
  AI?: Ai;

  CORS_ORIGINS?: string;
  RATE_LIMIT_FAIL_MODE?: string;
  SECURITY_LOG_RETENTION_DAYS?: string;
  AI_TIMEOUT_MS?: string;
}

export type AppEnv = { Bindings: Env };

/** Work allowed to finish after the response (Hono's c.executionCtx). */
export interface Background {
  waitUntil(promise: Promise<unknown>): void;
}
export type AppContext = Context<AppEnv>;
