import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/*
 Critical dashboard flows against the real Worker running locally
 (wrangler dev --local: Miniflare D1/KV/Durable Objects/Queues).
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

async function nav(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name, exact: true }).click();
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

test("client: register → login → policy → checks → keys → audit → analytics → security", async ({ page }) => {
  // Register (key shown once).
  await page.goto("/register");
  await page.getByLabel("Email").fill(`owner-${run}@example.com`);
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByRole("button", { name: "Generate API Key" }).click();
  const keyText = page.locator("code", { hasText: "edge_limit_" });
  await expect(keyText).toBeVisible();
  clientKey = (await keyText.textContent())!.trim();

  // Public sign-up into an existing tenant is refused.
  const hijack = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `evil-${run}@example.com`, tenantId: tenant }),
  });
  expect(hijack.status).toBe(409);

  // Login.
  await page.getByRole("button", { name: "Continue to Dashboard Access" }).click();
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByLabel("API Key").fill(clientKey);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Policies: create, see it listed.
  await nav(page, "Policies");
  await expect(page.getByText("No policies yet")).toBeVisible();
  await page.getByLabel("Route").fill("login-api");
  await page.getByRole("spinbutton", { name: /^Limit/ }).fill("2");
  await page.getByRole("spinbutton", { name: /^Window/ }).fill("60");
  await page.getByRole("button", { name: "Save Policy" }).click();
  await expect(page.getByText(`Rule saved for ${tenant}:login-api`)).toBeVisible();
  await expect(page.getByRole("cell", { name: "login-api", exact: true })).toBeVisible();

  // Live control: 2 allowed, 3rd blocked; headers readable cross-origin.
  await nav(page, "Live Control");
  await page.getByLabel("Route").fill("login-api");
  const testCheck = page.getByRole("button", { name: "Test Check" });
  for (let i = 0; i < 2; i++) {
    await testCheck.click();
    await expect(page.getByText("Allowed", { exact: true })).toBeVisible();
  }
  await testCheck.click();
  await expect(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect(page.getByText("Limit", { exact: true }).locator("..")).toContainText("2");

  // Per-identifier counter is independent.
  await page.getByLabel("Identifier").fill("user-1");
  await testCheck.click();
  await expect(page.getByText("Allowed", { exact: true })).toBeVisible();

  // API keys: create (shown once) and revoke it.
  await nav(page, "API Keys");
  await page.getByRole("button", { name: "New key" }).click();
  await expect(page.getByText("Copy this key now")).toBeVisible();
  const extraRow = page.getByRole("listitem").filter({ hasNotText: "this session" }).filter({ hasText: "active" });
  await extraRow.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "revoked" })).toHaveCount(1);

  // Audit trail from the server.
  await nav(page, "Audit");
  for (const action of ["policy_created", "rate_limit_block", "api_key_created", "api_key_revoked"]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }

  // Analytics fill in once the queue consumer has run (batch timeout 5s).
  await nav(page, "Analytics");
  await expect(async () => {
    await page.getByRole("button", { name: "Refresh" }).click();
    const total = page.getByText("Total Requests", { exact: true }).locator("..");
    await expect(total).toContainText("4", { timeout: 1_000 });
  }).toPass({ timeout: 30_000 });

  // Security: rule-based (no AI locally), IP table populated.
  await nav(page, "Security");
  await expect(page.getByText("Rule-based")).toBeVisible();
  await expect(page.getByRole("cell").filter({ hasText: /127\.0\.0\.1|::1/ }).first()).toBeVisible();

  // Delete the policy.
  await nav(page, "Policies");
  await page.getByRole("button", { name: "Delete login-api" }).click();
  await expect(page.getByText("No policies yet")).toBeVisible();
});

test("responsive: mobile layout uses the drawer and has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByLabel("API Key").fill(clientKey);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const closeMenu = page.getByRole("button", { name: "Close menu" });
  for (const section of ["Policies", "API Keys", "Audit", "Security"]) {
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(closeMenu).toBeInViewport();
    await nav(page, section);
    // Navigated, and the drawer slid away.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(section);
    await expect(closeMenu).not.toBeInViewport();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, section).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/mobile-${section.replace(" ", "-").toLowerCase()}.png`, fullPage: true });
  }
});

test("admin: login → overview → tenant drill-down → add user to tenant", async ({ page }) => {
  const email = `admin-${run}@example.com`;
  const res = await fetch(`${API}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, tenantId: `admin-${run}` }),
  });
  const { apiKey } = await res.json();
  promoteToAdmin(email);

  // A client key is refused by the admin portal.
  await page.goto("/admin-login");
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByLabel("Admin API Key").fill(clientKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("does not have admin privileges")).toBeVisible();

  await page.getByLabel("Tenant ID").fill(`admin-${run}`);
  await page.getByLabel("Admin API Key").fill(apiKey);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await nav(page, "Tenants");
  const row = page.getByRole("row").filter({ hasText: tenant });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "View" }).click();
  await expect(page.getByText("Admin Drill-Down")).toBeVisible();
  await expect(page.getByText("Total Requests", { exact: true }).locator("..")).toContainText("4");
  await page.getByRole("button", { name: "API Keys", exact: true }).last().click();
  await expect(page.getByText(`owner-${run}@example.com`).first()).toBeVisible();

  await nav(page, "Register Tenant");
  await page.getByLabel("Email").fill(`teammate-${run}@example.com`);
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByRole("button", { name: "Register User" }).click();
  await expect(page.locator("code", { hasText: "edge_limit_" })).toBeVisible();
});

test("revoking the session's own key signs the user out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Tenant ID").fill(tenant);
  await page.getByLabel("API Key").fill(clientKey);
  await page.getByRole("button", { name: "Access Dashboard" }).click();
  await nav(page, "API Keys");
  await page
    .getByRole("listitem")
    .filter({ hasText: "this session" })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(page).toHaveURL(/\/login$/);

  const who = await fetch(`${API}/whoami`, { headers: { "x-api-key": clientKey } });
  expect(who.status).toBe(401);
});
