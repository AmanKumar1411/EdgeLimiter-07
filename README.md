# EdgeLimiter

EdgeLimiter is a multi-tenant, edge-native rate limiting service built on Cloudflare Workers and Durable Objects. It provides per-tenant, per-route rate limit policies with real-time enforcement, AI-powered threat intelligence, and a full-featured React dashboard.

---

## Features

- **Three algorithms** — sliding window, fixed window, token bucket
- **Multi-tenant** — per-tenant, per-route policies stored in KV
- **API key auth** — every request validated against D1 with role-based access (`client` / `super_admin`)
- **Security intelligence** — Workers AI (Llama 3.1) analyzes abuse patterns with a heuristic fallback
- **Audit logging** — full action trail for policy changes and rate limit blocks
- **Analytics** — request telemetry via Cloudflare Analytics Engine
- **React dashboard** — client portal and admin portal with live stats, policy management, security intel, and tenant drill-down

---

## Architecture

```
Client Request
     │
     ▼
Cloudflare Worker (Hono)
     │
     ├── POST /check ──► KV (load policy) ──► Durable Object (enforce limit)
     │                                               │
     │                                        Queue (async log)
     │                                               │
     │                                        D1: security_logs + logs_summary
     │
     ├── POST /config ──► KV (store policy) + D1 audit_logs
     ├── POST /register ──► D1 users + api_keys
     ├── GET  /whoami ──► D1 users (validate + return role)
     ├── GET  /security-report ──► D1 security_logs + Workers AI
     ├── GET  /audit-report ──► D1 audit_logs
     ├── GET  /metrics ──► D1 logs_summary
     └── GET  /top-keys ──► D1 logs_summary
```

**Infrastructure bindings:**

| Binding | Purpose |
|---|---|
| `CONFIG_KV` | Rate limit policies (`tenantId:route` → JSON config) |
| `RATE_LIMITER` | Durable Object namespace (one DO per `tenantId:route`) |
| `LOG_QUEUE` | Async queue for security log writes |
| `DB` | Cloudflare D1 (users, api_keys, logs_summary, security_logs, audit_logs) |
| `ANALYTICS` | Cloudflare Analytics Engine (request telemetry) |
| `AI` | Workers AI (attack pattern analysis) |

---

## API Reference

Base URL: `https://edge-limiter.edgeaman.workers.dev`

All authenticated endpoints require the `x-api-key` header.

---

### POST /register

Register a new tenant and generate an API key. Public endpoint, only creates `client` accounts.

```bash
curl -X POST /register \
  -H "Content-Type: application/json" \
  -d '{"email":"ops@company.com","tenantId":"company-a","role":"client"}'
```

**Response:**
```json
{
  "success": true,
  "email": "ops@company.com",
  "tenantId": "company-a",
  "role": "client",
  "apiKey": "edge_limit_abc123..."
}
```

---

### GET /whoami

Validate an API key and return the account details. Used by the dashboard at login.

```bash
curl /whoami -H "x-api-key: <your-key>"
```

**Response:**
```json
{ "email": "ops@company.com", "role": "client", "tenantId": "company-a" }
```

---

### POST /config

Create or update a rate limit policy. Requires `x-api-key`. Clients can only configure their own tenant.

```bash
curl -X POST /config \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-key>" \
  -d '{
    "tenantId": "company-a",
    "route": "login-api",
    "limit": 100,
    "window": 60,
    "algorithm": "sliding_window"
  }'
```

**Algorithms:** `sliding_window` | `fixed_window` | `token_bucket`

---

### POST /check

Check if a request should be allowed. Enforces the tenant's configured policy.

```bash
curl -X POST /check \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-key>" \
  -d '{"tenantId":"company-a","route":"login-api"}'
```

**Response (allowed):** `200`
```json
{ "tenant": "company-a", "route": "login-api", "allowed": true, "remaining": 47, "retryAfter": 0, "algorithm": "sliding_window" }
```

**Response (blocked):** `429`
```json
{ "tenant": "company-a", "route": "login-api", "allowed": false, "remaining": 0, "retryAfter": 12 }
```

**Rate limit headers returned on every response:**

| Header | Description |
|---|---|
| `X-RateLimit-Limit` | Configured request limit |
| `X-RateLimit-Remaining` | Requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds until the next allowed request (only on `429`) |

---

### POST /reset

Manually reset the rate limit counter for a tenant + route. Clients can only reset their own tenant.

```bash
curl -X POST /reset \
  -H "x-api-key: <your-key>" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"company-a","route":"login-api"}'
```

---

### GET /security-report

Returns the last 50 security log entries, top abusive IPs (24h window), and an AI-generated threat summary. Clients can only query their own tenant.

```bash
curl "/security-report?tenantId=company-a" -H "x-api-key: <your-key>"
```

---

### GET /audit-report

Returns the last 50 audit log entries for a tenant. Clients can only query their own tenant.

```bash
curl "/audit-report?tenantId=company-a" -H "x-api-key: <your-key>"
```

---

### GET /client/metrics

Returns request totals and block rate scoped to the requesting API key.

```bash
curl /client/metrics -H "x-api-key: <your-key>"
```

---

### GET /metrics

Returns system-wide aggregated request totals. No auth required.

---

### GET /run-report

Returns the single most-abused API key with abuse score and recommendation. Requires `super_admin` API key. API key is masked in the response.

```bash
curl /run-report -H "x-api-key: <super-admin-key>"
```

**Response:**
```json
{
  "report": "Daily Abuse Report",
  "topApiKey": "edge_limit_ab••••3f4e",
  "totalRequests": 5200,
  "blockedRequests": 1800,
  "abuseScore": "34.62%",
  "recommendation": "Monitor traffic"
}
```

---

### GET /client/report

Returns the abuse report scoped to the requesting API key.

```bash
curl /client/report -H "x-api-key: <your-key>"
```

---

### GET /top-keys

Returns the top 10 API keys by blocked request volume. No auth required. API keys are masked.

---

### GET /

Returns API identity.

```bash
curl /
# {"project":"EdgeLimiter API","status":"Live","docs":"/health"}
```

---

### GET /health

Health check.

```bash
curl /health
# {"status":"ok","message":"EdgeLimiter Worker is running"}
```

---

## Dashboard

The React dashboard lives in `/dashboard` and points at the deployed Worker by default. It has two portals:

### Client Portal (`/dashboard`)

| Section | Description |
|---|---|
| Live Control | Test a route in real time; see result, remaining count, headers |
| Policies | Create or update rate limit policies |
| Analytics | Traffic totals, block rate, top API keys |
| Security | AI threat summary, abuse score, abusive IP table |
| Operations | Manually reset a route counter |
| Audit | Local activity log |

### Admin Portal (`/admin`)

| Section | Description |
|---|---|
| System Overview | Platform-wide request and block totals |
| Tenants | All observed tenants with drill-down into any tenant's sections |
| Global Security | System-wide AI threat analysis |
| Top API Keys | Full top-key leaderboard |
| Register Tenant | Create new client accounts |
| Audit | Local activity log |

Access is gated by API key role — the login pages call `/whoami` to verify credentials before establishing a session.

---

## Data Model

D1 schema is in `migrations/init.sql`.

| Table | Purpose |
|---|---|
| `users` | Tenant accounts with role (`client` / `super_admin`) |
| `api_keys` | API keys with `active` / `revoked` status, linked to a user |
| `logs_summary` | Aggregated request + block counts per API key |
| `security_logs` | Per-request security events (IP, country, route, allow/block reason) |
| `audit_logs` | Admin action trail (policy created, counter reset, rate limit block) |

---

## Rate Limiting Algorithms

| Algorithm | Behavior |
|---|---|
| `sliding_window` | Tracks individual request timestamps; smoothest enforcement |
| `fixed_window` | Resets counter at fixed time boundaries; simpler, slight burst risk |
| `token_bucket` | Continuous refill rate; allows short bursts up to the limit |

---

## Local Development

**1. Install root dependencies:**
```bash
npm install
```

**2. Create Cloudflare resources and update `wrangler.toml`:**
- KV namespace (`CONFIG_KV`)
- D1 database (`DB`)
- Queue (`LOG_QUEUE`)
- Analytics Engine dataset (`ANALYTICS`)
- Workers AI binding (`AI`)

**3. Apply the D1 schema:**
```bash
wrangler d1 execute edge-limiter-db --file migrations/init.sql
```

**4. Seed an initial super_admin account directly in D1:**
```bash
wrangler d1 execute edge-limiter-db --command \
  "INSERT INTO users(email,role,tenant_id) VALUES('admin@example.com','super_admin','admin-tenant')"
```

**5. Start the Worker in dev mode:**
```bash
npx wrangler dev
```

**6. Start the dashboard (separate terminal):**
```bash
cd dashboard
npm install
npm run dev
```

The dashboard reads `VITE_API_BASE` from a `.env` file in `/dashboard`. It defaults to the deployed Worker URL.

---

## Deploy

```bash
npx wrangler deploy
```

Build and deploy the dashboard separately as a static site (Cloudflare Pages, Vercel, etc.):
```bash
cd dashboard
npm run build
# dist/ is the output directory
```

---

## Scheduled Tasks

A cron handler runs daily at midnight UTC (`0 0 * * *`). It queries the top abusive API key from `logs_summary`, computes an abuse score, and logs a summary to the Worker console (API key is masked). Use Workers Logpush or Tail Workers to ship these logs to your observability pipeline.

---

## Production Notes

- Revoke compromised API keys by setting `status = 'revoked'` in the `api_keys` table.
- The `/check` endpoint is the hot path — Durable Object instances are isolated per `tenantId:route` key.
- `security_logs` grows unbounded; schedule a D1 prune query for rows older than your retention window (e.g. 30 days).
- Workers AI calls have a per-request latency cost; the security report uses a heuristic fallback if AI is unavailable.
- Set `VITE_API_BASE` in your dashboard deployment environment to point at your Worker URL.
- To seed a `super_admin` account, insert directly into D1 then create an API key row manually — the `/register` endpoint is public-only and creates `client` accounts.
