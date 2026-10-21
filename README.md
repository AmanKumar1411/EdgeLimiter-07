# EdgeLimiter

EdgeLimiter is a multi-tenant, edge-native rate limiting service built on Cloudflare Workers and Durable Objects. Tenants define per-route policies; your backend calls `POST /check` before serving a request and gets an allow/deny decision with standard rate-limit headers. It includes rule-based and Workers AI threat summaries, an audit trail, and a React dashboard.

---

## Features

- **Three algorithms**: sliding window, fixed window, token bucket
- **Per tenant, per route, optionally per end user**: pass `identifier` (user ID, IP, …) to `/check` to give each end user their own counter under the route's policy
- **Strongly consistent counters**: one Durable Object per `tenant:route[:identifier]`, so limits hold across Worker instances and survive restarts
- **API keys**: shown once, stored as SHA-256 hashes, revocable (takes effect on the next request)
- **RBAC + tenant isolation** enforced server-side on every endpoint (`client` / `super_admin`)
- **Security intelligence**: rule-based scoring, optionally summarised by Workers AI (timeout, cache, rule-based fallback)
- **Audit log**: policy changes, resets, key create/revoke, one entry per rate-limit block streak
- **React dashboard**: client portal and admin portal

---

## Architecture

```
Your backend
     │  POST /check {tenantId, route, identifier?}   x-api-key
     ▼
Cloudflare Worker (Hono)
     ├── D1: validate key hash + tenant          (fail-closed)
     ├── KV: load policy tenantId:route          (cached at edge, ≤ ~60s stale)
     ├── Durable Object: atomic count + decide   (one per tenant:route[:identifier])
     ├── Queue → consumer → D1 security_logs + logs_summary   (async, best-effort)
     ├── D1 audit_logs (first block of a streak)              (async, best-effort)
     └── Analytics Engine data point                          (best-effort)
```

| Binding | Purpose |
|---|---|
| `CONFIG_KV` | Rate limit policies (`tenantId:route` → JSON, mirrored in key metadata) |
| `RATE_LIMITER` | Durable Object namespace: counters, plus the `/register` throttle |
| `LOG_QUEUE` | Async security log writes (`rate-limit-logs`) |
| `DB` | D1: users, api_keys, logs_summary, security_logs, audit_logs, ai_insights |
| `ANALYTICS` | Analytics Engine (blobs: key ID, tenant, route, algorithm; never the key) |
| `AI` | Workers AI (optional; reports fall back to rules without it) |

### Consistency and failure behaviour

| Dependency | Used for | On failure |
|---|---|---|
| D1 | API key validation | **Fail-closed**: `/check` returns `503 {degraded: "auth_unavailable"}`. Unauthenticated requests are never allowed. |
| KV | Policy lookup | `RATE_LIMIT_FAIL_MODE=open` (default): `200 allowed: true` with `X-EdgeLimiter-Degraded: policy_unavailable`. `closed`: `503`. |
| Durable Object | Counting | Same as KV, with `limiter_unavailable`. |
| Queue, audit, Analytics Engine | Logging | Errors are logged and swallowed. Logging never blocks or fails a request. |
| Workers AI | Report text | 8s timeout (`AI_TIMEOUT_MS`), then rule-based fallback. Never fails the report. |

Fail-open is the default because an outage of the limiter should not take your API down; set `closed` if you'd rather reject traffic than serve it unlimited.

**Policy staleness:** KV is eventually consistent. A policy change is read back immediately in the location that wrote it, but other locations can keep serving the previous policy for **up to ~60 seconds**. Counters are not affected (they live in Durable Objects).

**Counter lifetime:** a Durable Object deletes its state after one full idle window (alarm-based), which is lossless: by then every algorithm's state has expired.

---

## API reference

All authenticated endpoints take the `x-api-key` header. Request bodies are JSON, max 16 KiB.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /`, `GET /health` | public | Liveness, touches no dependencies |
| `GET /health/ready` | super_admin | Probes D1, KV and Durable Objects; `503` if any fail |
| `POST /register` | public / super_admin | Public: creates a **new** tenant only (5 per IP per hour). super_admin: may add a user to an existing tenant |
| `GET /whoami` | key | |
| `POST /config` | key, own tenant | Create/update a policy |
| `GET /config?tenantId=` | key, own tenant | List policies (`?cursor=` to paginate) |
| `DELETE /config?tenantId=&route=` | key, own tenant | Delete a policy and reset its counter |
| `POST /check` | key, own tenant | The hot path |
| `POST /reset` | key, own tenant | Reset a counter (optionally one `identifier`) |
| `GET /keys` | key | Own keys; super_admin: `?tenantId=` lists a tenant's keys |
| `POST /keys` | key | New key for the caller, shown once (max 10 active) |
| `POST /keys/:id/revoke` | key | Own keys; super_admin: any |
| `GET /client/metrics` | key | Tenant totals; super_admin: `?tenantId=` |
| `GET /client/report` | key | Usage for the calling key |
| `GET /top-keys` | key | Own tenant; super_admin: all or `?tenantId=` |
| `GET /security-report?tenantId=` | key, own tenant | Last 50 logs, top IPs (24h), AI/rule summary |
| `GET /audit-report?tenantId=` | key, own tenant | Last 50 audit entries |
| `GET /metrics`, `GET /run-report` | super_admin | System-wide |

"Own tenant" means a `client` key may only name its own tenant (`403` otherwise); `super_admin` may name any.

### POST /register

```bash
curl -X POST "$API/register" -H "Content-Type: application/json" \
  -d '{"email":"ops@company.com","tenantId":"company-a"}'
# {"success":true,"email":"ops@company.com","tenantId":"company-a","role":"client","apiKey":"edge_limit_…"}
```

`tenantId`: 1–64 chars, lowercase letters, digits, `-`, `_`. The `apiKey` is returned **once**; only its hash is stored.

### POST /config

```bash
curl -X POST "$API/config" -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"tenantId":"company-a","route":"login-api","limit":100,"window":60,"algorithm":"sliding_window"}'
```

| Field | Rule |
|---|---|
| `route` | 1–256 chars, no control characters |
| `limit` | integer ≥ 1 (max 1,000,000; `sliding_window` max 10,000 because it stores one timestamp per request) |
| `window` | integer seconds, 1 to 2,592,000 (30 days) |
| `algorithm` | `sliding_window` (default), `fixed_window`, `token_bucket` |

### POST /check

```bash
curl -X POST "$API/check" -H "Content-Type: application/json" -H "x-api-key: $KEY" \
  -d '{"tenantId":"company-a","route":"login-api","identifier":"user-42"}'
```

- `200` allowed: `{"tenant","route","configKey","allowed":true,"remaining":47,"retryAfter":0,"algorithm"}`
- `429` blocked: `{"allowed":false,"remaining":0,"retryAfter":12,…}`
- `401` missing, unknown or revoked key · `403` key belongs to another tenant · `404` no policy · `400` invalid input
- Degraded: see the failure table above

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Policy limit |
| `X-RateLimit-Remaining` | Remaining in the current window |
| `X-RateLimit-Reset` | Unix time: when blocked, the next allowed moment; otherwise now + window |
| `Retry-After` | Seconds until the next allowed request (only on `429`) |
| `X-EdgeLimiter-Degraded` | Present when the decision was made without KV or the Durable Object |

Without `identifier`, all callers of the tenant share the route's counter.

---

## Data model

Migrations live in `migrations/` (applied with `wrangler d1 migrations apply`).

| Table | Purpose |
|---|---|
| `users` | Accounts: email, role, tenant |
| `api_keys` | `key_hash` (SHA-256), `key_hint` (masked, for display), status, `revoked_at`. `legacy_key` only holds keys created before migration 0002 until their first use |
| `logs_summary` | Request and block totals per `api_key_id` / `tenant_id` |
| `security_logs` | Per-request events (masked key hint, IP, country, route, reason) |
| `audit_logs` | Action trail (masked key hint) |
| `ai_insights` | Cached security summary per tenant |

---

## Local development

Requires Node 20+ (tested on 22.14).

```bash
npm install                        # root (Worker)
(cd dashboard && npm install)      # dashboard
cp .env.example .dev.vars          # optional: override Worker vars locally
cp dashboard/.env.example dashboard/.env.local
```

Create the local database (Miniflare, under `.wrangler/state`):

```bash
npx wrangler d1 migrations apply edge-limiter-db --local
```

Run:

```bash
npx wrangler dev --local                 # Worker on http://localhost:8787
(cd dashboard && npm run dev)            # dashboard; VITE_API_BASE from .env.local
```

`--local` keeps every binding local. Workers AI has no local simulator: reports use rule-based analysis, and nothing is billed.

Create a super admin: register normally, then promote:

```bash
curl -X POST http://localhost:8787/register -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","tenantId":"admin"}'
npx wrangler d1 execute edge-limiter-db --local \
  --command "UPDATE users SET role='super_admin' WHERE email='admin@example.com'"
```

Security logs and analytics arrive through the queue, in batches of up to 5 seconds.

---

## Tests

```bash
npm test            # Worker: Vitest + @cloudflare/vitest-plugin (Miniflare)
npm run typecheck   # src + tests
cd dashboard && npm run test:e2e   # Playwright, real local Worker + Vite
```

- **Worker tests** (`test/`) run inside workerd against local D1, KV, Durable Objects and Queues. They cover allow/block boundaries for all three algorithms, window reset, concurrent bursts, per-tenant/route/identifier isolation, persistence across Durable Object eviction, keys (hashing, legacy upgrade, revocation), RBAC and cross-tenant access, the queue consumer (retries, poison messages, legacy events), failure of each dependency, report masking, retention, and migration 0002 on legacy data. Workers AI is always mocked; tests never use the real binding.
- **Dashboard e2e** (`dashboard/e2e/`) starts `wrangler dev --local` with a fresh temporary state plus Vite, and drives the system Google Chrome (`channel: "chrome"`, no browser download). It covers register, login, policy CRUD, live checks, key create/revoke, audit, analytics, security, admin drill-down, mobile layout, and sign-out on revocation.

---

## Migrations

```bash
npx wrangler d1 migrations list  edge-limiter-db --remote
npx wrangler d1 migrations apply edge-limiter-db --remote
```

### Upgrading an existing deployment (pre-0002)

`0001_init.sql` is the former `init.sql` (idempotent). `0002_hash_api_keys.sql`:

- rebuilds `api_keys`: existing plaintext keys move to `legacy_key` and are hashed, then cleared, by the Worker on first use. All existing keys keep working.
- re-keys `logs_summary` by key ID. The old table is kept as `logs_summary_legacy`; drop it once you've checked the numbers.
- **irreversibly masks** plaintext keys stored in `security_logs` and `audit_logs`.
- tolerates the older production schema (extra `users.plan`, nullable `users.tenant_id`, non-unique `logs_summary.api_key`). Accounts with no tenant keep working for `/whoami` and key management, but get access to no tenant's data.

Steps:

1. Bookmark the database for rollback: `npx wrangler d1 time-travel info edge-limiter-db`.
2. Apply the migrations and deploy back-to-back. The old Worker can't read the new schema, and the new Worker can't read the old one, so keep the gap short.
   ```bash
   npx wrangler d1 migrations apply edge-limiter-db --remote && npx wrangler deploy
   ```
3. Optional: `SELECT COUNT(*) FROM api_keys WHERE legacy_key IS NOT NULL` shows keys not yet used since the upgrade. Revoke ones you don't recognise.

---

## Deploy

1. Create the resources (one-time) and put their IDs in `wrangler.toml`: KV namespace, D1 database, queue `rate-limit-logs`, Analytics Engine dataset. Workers AI needs no ID.
2. Optional dead-letter queue: `npx wrangler queues create rate-limit-logs-dlq`, then uncomment `dead_letter_queue` in `wrangler.toml`.
3. Set `[vars]` in `wrangler.toml`: restrict `CORS_ORIGINS` to your dashboard origin, and set `SECURITY_LOG_RETENTION_DAYS` if you want retention.
4. `npx wrangler d1 migrations apply edge-limiter-db --remote && npx wrangler deploy`

   If the Worker is connected to Git (Workers Builds), every push to `main` deploys it automatically, so apply migrations **before** pushing code that needs them. To make that automatic, set the build's deploy command to `npx wrangler d1 migrations apply edge-limiter-db --remote && npx wrangler deploy`; the build token needs D1 edit permission.
5. Dashboard: `cd dashboard && VITE_API_BASE=https://<worker-host> npm run build`, then host `dist/` as a static site (Cloudflare Pages, etc.).

Recommended in production: a Cloudflare WAF rate-limiting rule in front of `/check` and `/register` for unauthenticated floods, and Workers Logs or Logpush for the structured error logs.

---

## Scheduled tasks

Daily at 00:00 UTC: prunes `security_logs` older than `SECURITY_LOG_RETENTION_DAYS` (if set), then logs the top abusive key (masked).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `migrations apply` fails: `NOT NULL constraint failed: logs_summary.tenant_id` | Fixed in `0002`. Databases created before `users.tenant_id` existed have tenant-less users; their usage now stays in `logs_summary_legacy`. A failed run rolls back completely, so pull the fix and re-run. |
| Cloudflare build fails at `npm clean-install` with `ERESOLVE … @cloudflare/workers-types` | `wrangler` and `@cloudflare/workers-types` must agree: wrangler 4.15x expects workers-types `^5`. Keep them in step, and never commit a lockfile produced with `--legacy-peer-deps` (CI's `npm ci` rejects it). |
| Every request returns `401` right after upgrading | The migration was applied but the new Worker isn't deployed yet (or the reverse). Deploy immediately. |
| A policy change isn't enforced everywhere | KV propagation, up to ~60s. |
| Dashboard shows `Failed to connect` | `VITE_API_BASE` is wrong, or the dashboard origin isn't in `CORS_ORIGINS`. |
| Dashboard can't read `X-RateLimit-*` headers | Fixed: the Worker now exposes them via CORS. Redeploy if you see this. |
| Analytics and security logs lag a few seconds | Queue batching (`max_batch_timeout = 5`). |
| `/check` returns `X-EdgeLimiter-Degraded` | KV or the Durable Object failed and fail-open allowed the request. Check Workers logs. |
| Security report says "Rule-based" | No AI binding (local), AI timed out or failed, or there are no logs yet. |
| `wrangler dev` warns that AI bindings access remote resources | Use `--local`, or the AI binding will call (and bill) real Workers AI. |
