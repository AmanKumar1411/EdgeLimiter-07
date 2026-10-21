import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { consumeSecurityEvents } from "./analytics/events";
import { analyticsRoutes } from "./analytics/routes";
import { runDailyMaintenance } from "./analytics/usage";
import { authenticate } from "./keys/keys";
import { keyRoutes } from "./keys/routes";
import { policyRoutes } from "./policies/routes";
import { limiter, SYSTEM_PREFIX } from "./ratelimit/limiter";
import { rateLimitRoutes } from "./ratelimit/routes";
import { readConfig } from "./shared/config";
import type { AppEnv, Env } from "./shared/env";
import { MAX_BODY_BYTES } from "./shared/http";
import { log } from "./shared/log";

export { RateLimiter } from "./ratelimit/limiter";

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  log.error("unhandled_error", err, { method: c.req.method, path: c.req.path });
  return c.json({ error: "Internal server error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      // Hono types this callback's context without the app's bindings.
      const allowed = readConfig(c.env as Env).corsOrigins;
      if (allowed === "*") return "*";
      return allowed.includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-api-key"],
    // Without this, browsers hide the rate-limit headers from cross-origin JS.
    exposeHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "Retry-After",
      "X-EdgeLimiter-Degraded",
    ],
  }),
);

app.use(
  "*",
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: `Request body exceeds ${MAX_BODY_BYTES} bytes` }, 413),
  }),
);

app.get("/", (c) => c.json({ project: "EdgeLimiter API", status: "Live", docs: "/health" }));

// Liveness: touches no dependency, safe for frequent unauthenticated probes.
app.get("/health", (c) => c.json({ status: "ok", message: "EdgeLimiter Worker is running" }));

// Readiness: probes each dependency. Super admin only, since probes cost operations.
app.get("/health/ready", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  if (owner.role !== "super_admin") return c.json({ error: "Forbidden" }, 403);

  const probe = async (run: () => Promise<unknown>) => {
    const started = Date.now();
    try {
      await run();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: String(err) };
    }
  };

  const [d1, kv, durableObject] = await Promise.all([
    probe(() => c.env.DB.prepare("SELECT 1").first()),
    probe(() => c.env.CONFIG_KV.get(`${SYSTEM_PREFIX}health`)),
    probe(() => limiter(c.env, `${SYSTEM_PREFIX}health`).ping()),
  ]);
  const ok = d1.ok && kv.ok && durableObject.ok;
  const checks = { d1, kv, durableObject, ai: { ok: true, configured: Boolean(c.env.AI) } };
  return c.json({ status: ok ? "ok" : "degraded", checks }, ok ? 200 : 503);
});

app.route("/", keyRoutes);
app.route("/", policyRoutes);
app.route("/", rateLimitRoutes);
app.route("/", analyticsRoutes);

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<unknown>, env: Env) => consumeSecurityEvents(batch, env),
  scheduled: (_controller: ScheduledController, env: Env) => runDailyMaintenance(env),
} satisfies ExportedHandler<Env>;
