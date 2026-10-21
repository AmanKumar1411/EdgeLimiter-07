# EdgeLimiter: behaviour reference

What the system does today, written so a refactor can be checked against it.
Every API statement here is enforced by a test in `test/` (named in brackets);
UI flows are covered by `dashboard/e2e/flows.spec.ts`.

## Conventions

- Auth: `x-api-key` header. Keys look like `edge_limit_<32 hex>`; only their SHA-256 is stored.
- Errors: always JSON `{ "error": string }` [contract].
- Bodies: JSON objects, max 16 KiB → `413` [contract, resilience].
- Roles: `client` (one tenant) and `super_admin` (all tenants). A client naming another tenant gets `403`; an account with no tenant gets access to none [auth, production-upgrade].

## API

| Method & path | Auth | Request | Success response | Errors |
|---|---|---|---|---|
| `GET /` | — | — | `200 {project, status, docs}` | |
| `GET /health` | — | — | `200 {status:"ok", message}` (no dependencies touched) | |
| `GET /health/ready` | super_admin | — | `200 {status:"ok", checks:{d1,kv,durableObject,ai}}`, `503` if a probe fails | 401, 403 |
| `POST /register` | — / super_admin | `{email, tenantId}` | `200 {success, email, tenantId, role:"client", apiKey}`; key shown once | 400 invalid email/tenantId (`^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$`) or role ≠ client; 409 email taken or tenant exists (only super_admin may join an existing tenant); 429 after 5 public sign-ups per IP per hour |
| `GET /whoami` | key | — | `200 {email, role, tenantId}` | 401 |
| `POST /config` | key, own tenant | `{tenantId, route, limit, window, algorithm?}` | `200 {success, message, config}` | 400 (route 1–256 chars, no control chars; integer limit 1–1,000,000, sliding_window ≤ 10,000; integer window 1–2,592,000 s; algorithm in the three below); 403 |
| `GET /config?tenantId=&cursor=` | key, own tenant | — | `200 {tenantId, policies[], cursor}` | 400 no tenant, 403 |
| `DELETE /config?tenantId=&route=` | key, own tenant | — | `200 {success, message}`; also resets the route's counter | 400, 403, 404 |
| `POST /check` | key, own tenant | `{tenantId, route, identifier?}` | `200` allowed / `429` blocked: `{tenant, route, configKey, allowed, remaining, retryAfter, algorithm}` + headers below | 400 invalid body/fields, 401 missing/unknown/revoked key, 403 tenant mismatch, 404 no policy, 500 unusable stored policy, 503 (see failure modes) |
| `POST /reset` | key, own tenant | `{tenantId, route, identifier?}` | `200 {success, message, tenantId, route}` | 400, 403, 503 |
| `GET /keys?tenantId=` | key | — | `200 {keys:[{id, hint, status, email, createdAt, revokedAt, current}]}`; client: own keys; super_admin: a tenant's keys | 401 |
| `POST /keys` | key | — | `200 {success, id, apiKey, hint}`; key shown once | 409 at 10 active keys |
| `POST /keys/:id/revoke` | key | — | `200 {success, id, status:"revoked", current}`; effective on the next request | 400, 404 (incl. other users' keys for clients) |
| `GET /client/metrics?tenantId=` | key | — | `200 {totalRequests, blockedRequests, blockRate}` for the caller's tenant (super_admin: any) | 401 |
| `GET /client/report` | key | — | `200 {report, topApiKey (masked), totalRequests, blockedRequests, abuseScore, recommendation}` for the calling key | 401 |
| `GET /top-keys?tenantId=` | key | — | `200 [{apiKey (masked), tenantId, totalRequests, blockedRequests, abuseScore}]`, top 10 by blocked; client: own tenant only | 401 |
| `GET /security-report?tenantId=` | key, own tenant | — | `200 {tenantId, recentLogs[50], topAbusiveIps[≤10, last 24h], aiSummary, abuseScore (20/55/85/95), recommendation, intelligenceSource ("ai"\|"rules"), generatedAt}`; keys masked | 400, 403 |
| `GET /audit-report?tenantId=` | key, own tenant | — | `200 {tenantId, auditLogs[50]}`; keys masked | 400, 403 |
| `GET /metrics` | super_admin | — | `200 {totalRequests, blockedRequests, blockRate}` system-wide | 401, 403 |
| `GET /run-report` | super_admin | — | `200 {report, topApiKey, …}` or `{message}` when empty | 401, 403 |

### `/check` decision rules [behavior, check, rate-limiter]

| Algorithm | Allows | `retryAfter` when blocked |
|---|---|---|
| `sliding_window` (default) | fewer than `limit` requests in the last `window` s (second resolution; a request at exactly `now - window` has expired) | seconds until enough entries expire to drop below `limit` |
| `fixed_window` | up to `limit` per aligned window `floor(now / window)` | seconds to the next window boundary |
| `token_bucket` | a token is available; bucket holds `limit`, refills `limit / window` per second continuously | seconds until one full token (rounded up); `0` when allowed |

- Counters are per `tenantId:route`, or per `tenantId:route` + `identifier` when one is sent. Tenants never share counters.
- A concurrent burst admits exactly `limit` requests. Counters survive Durable Object eviction.
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (when blocked, now + retryAfter; otherwise now + window), `Retry-After` (429 only).
- Policies saved before validation existed still work: limits are floored and unknown algorithms fall back to `sliding_window`.

### Failure modes [resilience]

| Failing dependency | `/check` result |
|---|---|
| D1 (key lookup) | `503 {error, degraded:"auth_unavailable"}`, always |
| KV (policy) | `RATE_LIMIT_FAIL_MODE=open` (default): `200 {allowed:true, degraded:"policy_unavailable"}` + `X-EdgeLimiter-Degraded`; `closed`: `503` |
| Durable Object | same, with `limiter_unavailable` |
| Queue / audit / Analytics Engine | ignored; never affect the response |
| Workers AI | report falls back to rule-based analysis |

### Side effects

- Every `/check` enqueues one security event (key ID + masked hint, never the raw key). The consumer writes `security_logs` and, for decided requests, `logs_summary` in one transaction; malformed messages are acknowledged and dropped, D1 failures retry with backoff [queue].
- Audit entries: `policy_created`, `policy_deleted`, `rate_limit_reset`, `api_key_created`, `api_key_revoked`, and `rate_limit_block` once per block streak [reports].
- Daily cron: deletes `security_logs` older than `SECURITY_LOG_RETENTION_DAYS` when set [reports].
- Durable Object state is deleted after one idle window [rate-limiter].
- Security intelligence is cached per tenant (reused while no new logs, at most 5 min); the AI severity can raise but never lower the rule-based one [resilience].

## UI pages

The dashboard calls a tenant a **project**. Every page has its own URL, so
links (e.g. from an overview number) open a filtered view.

| Path | Who | Contents |
|---|---|---|
| `/` | anyone | What EdgeLimiter does, example `/check` exchange, links to create a project or sign in |
| `/register` | anyone | Create a project: email + project ID → API key shown once → continue to setup (signed in) |
| `/login` | any role | Project ID + API key → `/dashboard` (super admins → `/dashboard` too) |
| `/admin-login` | super_admin | Same form; client keys are refused → `/admin` |
| `/dashboard` | client | Overview: requests, blocked, block rate (each links to Activity), recent traffic chart, most limited routes, top keys, recent alerts |
| `/dashboard/setup` | client | Get started: project ✓ → API key ✓ → starter limit, copyable curl/JS snippet, browser test, live request feed |
| `/dashboard/limits` | client | Limits table (search, pagination); plain-words form with preview; edit, reset counter, delete (confirmed) |
| `/dashboard/playground` | client | Test request: send `/check` with the session key (optional identifier), see status, remaining, limit, retry, reset; snippet |
| `/dashboard/activity` | client | Threat summary, request log with outcome/route/key/search filters in the URL, top IPs (24h) |
| `/dashboard/keys` | client | Keys table; create (shown once); revoke (confirmed; revoking the session key signs out) |
| `/dashboard/audit` | client | Audit table with event filter and search |
| `/admin` | super_admin | Platform overview: system totals, top keys across tenants |
| `/admin/tenants` | super_admin | Tenants table, open any tenant by ID |
| `/admin/users` | super_admin | Add a user to an existing or new tenant (key shown once) |
| `/admin/t/:tenantId/…` | super_admin | The tenant pages above for any tenant (no Test request for other tenants: `/check` needs their own key) |
| `*` | anyone | Not found |

A project switcher (admins: any tenant or "All tenants"), breadcrumbs, API
status and a light/dark/system theme toggle are on every page. A `401` for
the session's own key clears the session and returns to the login page.

Previous layout → current: Live Control → Test request · Policies →
Limits · Operations (reset) → Limits row action · Analytics + Security →
Overview + Activity · Global Security / Top API Keys → Platform overview ·
Register Tenant → Users · Tenants drill-down → `/admin/t/:tenantId`.

## User flows (e2e)

1. **Onboarding**: create project → key shown once → setup → starter limit → snippet (key masked on screen, real key copied) → browser test → request appears live.
2. **Create a limit**: Limits → New limit → route, "Allow N requests every M unit", algorithm → preview sentence → saved and listed.
3. **Test it**: Test request → allowed, then blocked (HTTP 429); limit header shown; an `identifier` gets its own counter.
4. **Observe**: Overview totals update after queue processing (≤ 5 s); clicking Blocked opens Activity filtered to rate-limited requests; Audit lists limit, block and key events.
5. **Manage keys**: create (shown once) → revoke → Revoked; revoking the session's own key signs the user out.
6. **Remove a limit**: Limits → Delete (confirm) → gone; `/check` on that route → 404.
7. **Admin**: admin sign-in (client key refused) → platform overview → Tenants → tenant pages (no Test request) → back to All tenants → add a user to a tenant.
8. **Theme**: system → light → dark, persisted across reloads.
9. **Mobile (375 px)**: every page reachable via the drawer, no horizontal scrolling.
