// Starts the real Worker locally for e2e: fresh Miniflare state (D1, KV,
// Durable Objects, Queues) in E2E_STATE_DIR, migrations applied, `--local`
// so nothing (including billed Workers AI) reaches Cloudflare.
import { execFileSync, spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const stateDir = process.env.E2E_STATE_DIR;
const port = process.env.E2E_API_PORT ?? "8799";
if (!stateDir) throw new Error("E2E_STATE_DIR is not set");

execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "edge-limiter-db", "--local", "--persist-to", stateDir], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CI: "1" },
});

const child = spawn(
  "npx",
  ["wrangler", "dev", "--local", "--persist-to", stateDir, "--port", port, "--ip", "127.0.0.1"],
  { cwd: root, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
