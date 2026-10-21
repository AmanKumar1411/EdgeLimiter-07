import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { test, type Page } from "@playwright/test";

/*
 Captures every page for docs/ui/. Skipped unless SCREENSHOT_DIR is set:
   SCREENSHOT_DIR=../docs/ui/after npx playwright test screenshots
*/

const dir = process.env.SCREENSHOT_DIR;
test.skip(!dir, "set SCREENSHOT_DIR to capture screenshots");

const API = process.env.E2E_API_BASE!;
const ROOT = resolve(import.meta.dirname, "../..");
const run = Date.now().toString(36);
const tenant = `acme-${run}`;

async function api(path: string, body: unknown, apiKey?: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function seed() {
  const { apiKey } = await api("/register", { email: `owner-${run}@example.com`, tenantId: tenant });
  for (const [route, limit, algorithm] of [
    ["login-api", 3, "sliding_window"],
    ["search", 50, "token_bucket"],
    ["checkout", 10, "fixed_window"],
  ] as const) {
    await api("/config", { tenantId: tenant, route, limit, window: 60, algorithm }, apiKey);
  }
  for (let i = 0; i < 6; i++) await api("/check", { tenantId: tenant, route: "login-api" }, apiKey);
  for (let i = 0; i < 4; i++) await api("/check", { tenantId: tenant, route: "search" }, apiKey);
  await api("/keys", {}, apiKey);

  const admin = await api("/register", { email: `admin-${run}@example.com`, tenantId: `ops-${run}` });
  execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "edge-limiter-db",
      "--local",
      "--persist-to",
      process.env.E2E_STATE_DIR!,
      "--command",
      `UPDATE users SET role = 'super_admin' WHERE email = 'admin-${run}@example.com'`,
    ],
    { cwd: ROOT, stdio: "ignore" },
  );
  // Let the queue consumer write logs and summaries (batch timeout 5s).
  await new Promise((r) => setTimeout(r, 7_000));
  return { clientKey: apiKey as string, adminKey: admin.apiKey as string };
}

async function signIn(page: Page, path: string, tenantId: string, apiKey: string) {
  await page.goto("/");
  await page.evaluate(
    ([t, k, role]) =>
      localStorage.setItem(
        "edge-limiter-session",
        JSON.stringify({ tenantId: t, apiKey: k, role, email: "x@example.com" }),
      ),
    [tenantId, apiKey, path === "/admin" ? "super_admin" : "client"],
  );
  await page.goto(path);
}

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${name}.jpg`, fullPage: true, type: "jpeg", quality: 80 });
}

async function captureNav(page: Page, prefix: string, suffix: string) {
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  const hrefs = await links.evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).pathname));
  for (const href of hrefs) {
    await page.goto(href);
    const name = (await page.getByRole("heading", { level: 1 }).textContent()) ?? href;
    await shoot(page, `${prefix}-${name.toLowerCase().replace(/\s+/g, "-")}${suffix}`);
  }
}

test("capture all pages", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { clientKey, adminKey } = await seed();
  const schemes = (process.env.SCREENSHOT_SCHEMES ?? "dark").split(",");

  for (const scheme of schemes) {
    await page.emulateMedia({ colorScheme: scheme as "light" | "dark" });
    const suffix = process.env.SCREENSHOT_SCHEMES ? `-${scheme}` : "";

    for (const path of ["/", "/register", "/login", "/admin-login"]) {
      await page.goto(path);
      await shoot(page, `public${path === "/" ? "-landing" : path.replace("/", "-")}${suffix}`);
    }

    await signIn(page, "/dashboard", tenant, clientKey);
    await captureNav(page, "client", suffix);

    await signIn(page, "/admin", `ops-${run}`, adminKey);
    await captureNav(page, "admin", suffix);
    await page.goto(`/admin/t/${tenant}`);
    await shoot(page, `admin-tenant-overview${suffix}`);
  }

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  for (const scheme of schemes) {
    await mobile.emulateMedia({ colorScheme: scheme as "light" | "dark" });
    const suffix = process.env.SCREENSHOT_SCHEMES ? `-${scheme}` : "";
    await signIn(mobile, "/dashboard", tenant, clientKey);
    await shoot(mobile, `mobile-overview${suffix}`);
    await mobile.goto("/dashboard/limits");
    await shoot(mobile, `mobile-limits${suffix}`);
    await mobile.getByRole("button", { name: "Open menu" }).click();
    await shoot(mobile, `mobile-menu${suffix}`);
  }
  await mobile.close();
});
