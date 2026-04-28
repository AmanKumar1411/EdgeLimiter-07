# EdgeLimiter

EdgeLimiter is a multi-tenant, edge-native rate limiting service built on Cloudflare Workers and Durable Objects. It provides per-tenant, per-route policies with analytics and abuse reporting for operational visibility.

## Highlights

- Per-tenant, per-route rate limiting at the edge
- Algorithms: sliding_window, fixed_window, token_bucket
- API key auth backed by D1
- Aggregated usage and abuse signals in D1
- Request-level telemetry via Analytics Engine
- Optional React dashboard in /dashboard

## Architecture

1. Policies are stored in KV under the key tenantId:route.
2. /check validates the API key, loads the policy, and calls the Durable Object instance for that policy.
3. The Durable Object enforces the rate limit and returns headers.
4. A Queue consumer aggregates request totals and blocked counts into D1.
5. A daily cron produces an abuse report.

## API

Base URL is your Worker endpoint.

### POST /config

Create or update a policy for a tenant and route.

Request body:

```json
{
  "tenantId": "company-a",
  "route": "login-api",
  "limit": 100,
  "window": 60,
  "algorithm": "sliding_window"
}
```

### POST /check

Check if a request is allowed. Requires x-api-key.

```bash
curl -i -X POST https://edge-limiter.edgeaman.workers.dev/check \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your-api-key>" \
  -d '{"tenantId":"company-a","route":"login-api"}'
```

Response headers:

- X-RateLimit-Limit
- X-RateLimit-Remaining
- X-RateLimit-Reset
- Retry-After (when applicable)

### GET /metrics

Returns total request counts and block rate.

### GET /top-keys

Returns the top API keys by blocked requests.

### GET /run-report

Returns the daily abuse report data.

### GET /health

Health check endpoint.

## Data model

The D1 schema is in migrations/init.sql and includes:

- users
- api_keys
- logs_summary

## Local development

1. Install dependencies at the repo root:

```bash
npm install
```

2. Create Cloudflare resources (KV, D1, Queue, Analytics dataset) and update wrangler.toml with the IDs.
3. Apply the D1 schema:

```bash
wrangler d1 execute edge-limiter-db --file migrations/init.sql
```

4. Seed api_keys with at least one active key.
5. Run the Worker:

```bash
npx wrangler dev
```

## Dashboard

The dashboard is a Vite app under /dashboard and points at https://edge-limiter.edgeaman.workers.dev by default.

```bash
cd dashboard
npm install
npm run dev
```

## Production notes

- Protect /config behind admin auth or an internal control plane.
- Rotate and store API keys securely.
- Use a custom domain and TLS termination via Cloudflare.

## Deploy

```bash
npx wrangler deploy
```

# EdgeLimiter-07
