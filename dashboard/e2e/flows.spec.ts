import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/*
 Critical dashboard flows against the real Worker running locally
 (wrangler dev --local: Miniflare D1/KV/Durable Objects/Queues).
 Mirrors the user flows in docs/BEHAVIOR.md.
*/

const API = process.env.E2E_API_BASE!;
const ROOT = resolve(import.meta.dirname, "../..");
const run = Date.now().toString(36);
const tenant = `e2e-${run}`;

let clientKey = "";

test.describe.configure({ mode: "serial" });

test.beforeEach(({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
});

const nav = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name, exact: true }).click();

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function signIn(page: Page, key = clientKey) {
  await page.goto("/login");
  await page.getByLabel("Project ID").fill(tenant);
  await page.getByLabel("API key").fill(key);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function promoteToAdmin(email: string) {
  execFileSync(
    "npx",
    [
      "wrangler", "d1", "execute", "edge-limiter-db", "--local",
      "--persist-to", process.env.E2E_STATE_DIR!,
      "--command", `UPDATE users SET role = 'super_admin' WHERE email = '${email}'`,
    ],
    { cwd: ROOT, stdio: "ignore" },
  );
}

test("onboarding: create project → key shown once → starter limit → first request arrives live", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Create a project" }).first().click();
  await page.getByLabel("Email").fill(`owner-${run}@example.com`);
  await page.getByLabel("Project ID").fill(tenant);
  await page.getByRole("button", { name: "Create project" }).click();

  const key = page.locator("code", { hasText: "edge_limit_" });
  await expect(key).toBeVisible();
  clientKey = (await key.textContent())!.trim();

  // Public sign-up into an existing project is refused.
  const hijack = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `evil-${run}@example.com`, tenantId: tenant }),
  });
  expect(hijack.status).toBe(409);

  await page.getByRole("button", { name: "I've saved my key, continue" }).click();
  await expect(page).toHaveURL(/\/dashboard\/setup$/);
  await expect(heading(page)).toHaveText("Get started");

  await page.getByRole("button", { name: "Create starter limit" }).click();
  await expect(page.getByRole("tab", { name: "curl" })).toBeVisible();
  await expect(page.locator("pre")).toContainText("/api/hello");
  await expect(page.locator("pre")).not.toContainText(clientKey); // masked on screen

  await page.getByRole("button", { name: "Or send one from the browser" }).click();
  await expect(page.getByText("You're set up.")).toBeVisible({ timeout: 20_000 });
});

test("limits: plain-words form with preview, then test requests until blocked", async ({ page }) => {
  await signIn(page);
  await nav(page, "Limits");
  await page.getByRole("button", { name: "New limit" }).first().click();
  await page.getByLabel("Route", { exact: true }).fill("login-api");
  await page.getByLabel("Requests allowed").fill("2");
  await page.getByLabel("Window length").fill("1");
  await page.getByLabel("Window unit").selectOption("60");
  await expect(page.getByText("allowed 2 times in any rolling minute")).toBeVisible();
  await page.getByRole("button", { name: "Save limit" }).click();
  await expect(page.getByText("Limit for login-api saved.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "login-api" });
  await expect(row).toContainText("2 per minute");

  await nav(page, "Test request");
  await page.getByLabel("Route", { exact: true }).selectOption("login-api");
  const send = page.getByRole("button", { name: "Send request" });
  for (let i = 0; i < 2; i++) {
    await send.click();
    await expect(page.getByText("HTTP 200")).toBeVisible();
  }
  await send.click();
  await expect(page.getByText("HTTP 429")).toBeVisible();
  // X-RateLimit-* headers are readable cross-origin (CORS expose).
  await expect(page.getByText("Limit", { exact: true }).locator("..")).toContainText("2");

  await page.getByLabel("Identifier (optional)").fill("user-1");
  await send.click();
  await expect(page.getByText("HTTP 200")).toBeVisible();
});

test("keys, audit, overview links and activity filters", async ({ page }) => {
  await signIn(page);

  await nav(page, "API keys");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("New API key")).toBeVisible();
  const extra = page.getByRole("row").filter({ hasNotText: "This session" }).filter({ hasText: "Active" });
  await extra.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Revoked" })).toHaveCount(1);

  await nav(page, "Audit log");
  for (const event of ["Limit saved", "Limit reached", "Key created", "Key revoked"]) {
    await expect(page.getByRole("cell", { name: event }).first()).toBeVisible();
  }

  // Overview numbers come from the queue consumer (batch timeout 5s).
  await nav(page, "Overview");
  await expect(async () => {
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByRole("link", { name: /^Requests/ })).toContainText("5", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  await page.getByRole("link", { name: /^Blocked/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/activity\?outcome=limited$/);
  await expect(page.getByLabel("Outcome")).toHaveValue("limited");
  await expect(page.getByRole("cell", { name: "Rate limited" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Allowed" })).toHaveCount(0);

  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByRole("cell", { name: "Allowed" }).first()).toBeVisible();
  await expect(page.getByText("Rule-based analysis")).toBeVisible();

  await nav(page, "Limits");
  await page.getByRole("button", { name: "Delete login-api" }).click();
  await expect(page.getByText("Limit for login-api deleted.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "login-api" })).toHaveCount(0);
});

test("theme: light/dark toggle applies the design tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: /^System theme/ }).click(); // → light
  await page.getByRole("button", { name: /^Light theme/ }).click(); // → dark
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/); // persisted, applied before first paint
  await page.getByRole("button", { name: /^Dark theme/ }).click(); // → system
  await expect(html).not.toHaveClass(/dark/);
});

test("mobile (375px): drawer navigation and no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);

  for (const section of ["Limits", "Test request", "Activity", "API keys", "Audit log", "Get started", "Overview"]) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await nav(page, section);
    await expect(heading(page)).toHaveText(section);
    await expect(page.getByRole("button", { name: "Close menu" })).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, section).toBeLessThanOrEqual(0);
  }
});

test("admin: client key refused → platform overview → tenant drill-down → add user", async ({ page }) => {
  const email = `admin-${run}@example.com`;
  const { apiKey } = await (
    await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, tenantId: `admin-${run}` }),
    })
  ).json();
  promoteToAdmin(email);

  await page.goto("/admin-login");
  await page.getByLabel("Project ID").fill(tenant);
  await page.getByLabel("API key").fill(clientKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("does not have admin privileges")).toBeVisible();

  await page.getByLabel("Project ID").fill(`admin-${run}`);
  await page.getByLabel("API key").fill(apiKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(heading(page)).toHaveText("Platform overview");

  await nav(page, "Tenants");
  await page.getByRole("row").filter({ hasText: tenant }).getByRole("link", { name: "View" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/t/${tenant}$`));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(tenant);
  await expect(page.getByRole("link", { name: /^Requests/ })).toContainText("5");
  // Another tenant's /check needs its own key, so no Test request page.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Test request" })).toHaveCount(0);

  await nav(page, "API keys");
  await expect(page.getByRole("cell", { name: `owner-${run}@example.com` }).first()).toBeVisible();

  await page.getByLabel("Project").selectOption("");
  await expect(page).toHaveURL(/\/admin$/);

  await nav(page, "Users");
  await page.getByLabel("Email").fill(`teammate-${run}@example.com`);
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.locator("code", { hasText: "edge_limit_" })).toBeVisible();
});

test("revoking the session's own key signs the user out", async ({ page }) => {
  await signIn(page);
  await nav(page, "API keys");
  await page.getByRole("row").filter({ hasText: "This session" }).getByRole("button", { name: "Revoke" }).click();
  await expect(page).toHaveURL(/\/login$/);

  const who = await fetch(`${API}/whoami`, { headers: { "x-api-key": clientKey } });
  expect(who.status).toBe(401);
});
