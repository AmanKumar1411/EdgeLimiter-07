import type { Env } from "./env";

const DEFAULT_AI_TIMEOUT_MS = 8_000;

/** Every tunable the Worker reads from its environment, parsed in one place. */
export function readConfig(env: Env) {
  const origins = env.CORS_ORIGINS?.trim();
  const retentionDays = Number(env.SECURITY_LOG_RETENTION_DAYS);
  const aiTimeoutMs = Number(env.AI_TIMEOUT_MS);

  return {
    /*
     When KV or the Durable Object fails, "open" (default) allows the request
     and flags it as degraded, since a limiter outage shouldn't take the
     tenant's API down; "closed" answers 503 instead.
    */
    failClosed: env.RATE_LIMIT_FAIL_MODE?.trim().toLowerCase() === "closed",
    corsOrigins: !origins || origins === "*" ? "*" : origins.split(",").map((o) => o.trim()),
    retentionDays: Number.isInteger(retentionDays) && retentionDays >= 1 ? retentionDays : null,
    aiTimeoutMs: aiTimeoutMs > 0 ? aiTimeoutMs : DEFAULT_AI_TIMEOUT_MS,
  };
}
