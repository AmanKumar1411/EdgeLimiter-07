// Local latency of POST /check (Miniflare via `wrangler dev --local`).
// Numbers are only comparable with each other on the same machine, not
// with production. Usage: node scripts/bench-check.mjs [requestsPerAlgorithm]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const requests = Number(process.argv[2] ?? 300);
const port = 8797;
const api = `http://127.0.0.1:${port}`;
const state = mkdtempSync(join(tmpdir(), "edgelimiter-bench-"));

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "edge-limiter-db", "--local", "--persist-to", state], {
  stdio: "ignore",
  env: { ...process.env, CI: "1" },
});
const worker = spawn(
  "npx",
  ["wrangler", "dev", "--local", "--persist-to", state, "--port", String(port), "--ip", "127.0.0.1"],
  { stdio: "ignore", detached: true },
);

async function waitForHealth() {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${api}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("worker did not start");
}

function post(path, body, apiKey) {
  return fetch(`${api}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
    body: JSON.stringify(body),
  });
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

try {
  await waitForHealth();
  const tenantId = `bench-${Date.now().toString(36)}`;
  const { apiKey } = await (await post("/register", { email: `${tenantId}@example.com`, tenantId })).json();

  for (const [algorithm, limit] of [
    ["sliding_window", 10_000],
    ["fixed_window", 1_000_000],
    ["token_bucket", 1_000_000],
  ]) {
    const route = `/${algorithm}`;
    await post("/config", { tenantId, route, limit, window: 3600, algorithm }, apiKey);

    for (let i = 0; i < 30; i++) await (await post("/check", { tenantId, route }, apiKey)).text();

    const timings = [];
    for (let i = 0; i < requests; i++) {
      const started = performance.now();
      const res = await post("/check", { tenantId, route }, apiKey);
      await res.text();
      timings.push(performance.now() - started);
      if (res.status !== 200) throw new Error(`unexpected ${res.status}`);
    }
    timings.sort((a, b) => a - b);
    const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
    console.log(
      `${algorithm.padEnd(15)} n=${requests}  p50=${percentile(timings, 50).toFixed(2)}ms  ` +
        `p95=${percentile(timings, 95).toFixed(2)}ms  mean=${mean.toFixed(2)}ms`,
    );
  }
} finally {
  process.kill(-worker.pid, "SIGTERM");
}
