import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// One fresh local backend state per run, shared with workers via env.
process.env.E2E_STATE_DIR ??= mkdtempSync(join(tmpdir(), "edgelimiter-e2e-"));
const API_PORT = process.env.E2E_API_PORT ?? "8799";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5179";
process.env.E2E_API_BASE ??= `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // System Chrome: no Playwright browser download needed.
    ...devices["Desktop Chrome"],
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node e2e/start-backend.mjs",
      url: `${process.env.E2E_API_BASE}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { VITE_API_BASE: process.env.E2E_API_BASE },
      timeout: 60_000,
      reuseExistingServer: false,
    },
  ],
});
