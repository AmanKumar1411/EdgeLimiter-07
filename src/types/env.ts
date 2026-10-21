export type Env = {
  RATE_LIMITER: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  DB: D1Database;
  LOG_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  // Optional so the Worker (and tests) run without Workers AI; reports
  // fall back to rule-based intelligence.
  AI?: Ai;

  /** Comma-separated allowed origins, or "*" (default). */
  CORS_ORIGINS?: string;
  /** "open" (default): allow when KV/DO fail. "closed": return 503. */
  RATE_LIMIT_FAIL_MODE?: string;
  /** Delete security_logs older than N days in the daily cron. Unset = keep. */
  SECURITY_LOG_RETENTION_DAYS?: string;
  /** Workers AI call timeout in ms (default 8000). */
  AI_TIMEOUT_MS?: string;
};

export type Bindings = Env;
