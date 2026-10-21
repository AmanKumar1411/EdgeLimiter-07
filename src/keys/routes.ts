import { Hono } from "hono";
import { writeAudit } from "../analytics/audit";
import { throttle } from "../ratelimit/limiter";
import type { AppEnv } from "../shared/env";
import { clientInfo, readJsonObject } from "../shared/http";
import { cleanString, isValidEmail, MAX_TENANT_ID_LENGTH, TENANT_ID_PATTERN } from "../shared/validation";
import { actorFor, authenticate, findActiveOwner, generateApiKey, hashApiKey, maskApiKey } from "./keys";

const MAX_ACTIVE_KEYS_PER_USER = 10;
// Public sign-ups per client IP.
const SIGNUPS_PER_HOUR = 5;

export const keyRoutes = new Hono<AppEnv>();

keyRoutes.get("/whoami", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  return c.json({ email: owner.email, role: owner.role, tenantId: owner.tenant_id });
});

/*
 Joining an existing tenant grants that tenant's privileges, so only a
 super admin may add users to one. Public sign-up only creates new tenants.
*/
keyRoutes.post("/register", async (c) => {
  const caller = await findActiveOwner(c.env, c.req.header("x-api-key"));
  const isAdmin = caller?.role === "super_admin";

  if (!isAdmin) {
    const ip = clientInfo(c.req.raw).ipAddress ?? "unknown";
    if (!(await throttle(c.env, `register:${ip}`, SIGNUPS_PER_HOUR, 3600))) {
      return c.json({ error: "Too many registrations from this address. Try again later." }, 429);
    }
  }

  const body = await readJsonObject(c);
  if (!body) return c.json({ error: "Invalid JSON body" }, 400);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim().toLowerCase() : "";
  const role = (typeof body.role === "string" && body.role.trim().toLowerCase()) || "client";

  if (!email || !tenantId) return c.json({ error: "email and tenantId are required" }, 400);
  if (!isValidEmail(email)) return c.json({ error: "email is invalid" }, 400);
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    return c.json(
      {
        error:
          "tenantId must be 1-64 characters: lowercase letters, digits, '-' or '_', starting and ending with a letter or digit",
      },
      400,
    );
  }
  if (role !== "client") return c.json({ error: "Public registration only supports role=client" }, 400);

  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const apiKey = generateApiKey();

  // One transaction: the tenant check and both inserts are atomic, so two
  // sign-ups can't both claim a new tenant and a user always gets a key.
  // Only the key's hash is stored; the plaintext is returned once below.
  let userInsert: D1Result;
  try {
    [userInsert] = await c.env.DB.batch([
      c.env.DB.prepare(
        `
        INSERT INTO users (email, role, tenant_id)
        SELECT ?1, ?2, ?3
        WHERE ?4 = 1 OR NOT EXISTS (SELECT 1 FROM users WHERE tenant_id = ?3)
      `,
      ).bind(email, role, tenantId, isAdmin ? 1 : 0),
      c.env.DB.prepare(
        `
        INSERT INTO api_keys (user_id, key_hash, key_hint, status)
        SELECT last_insert_rowid(), ?, ?, 'active'
        WHERE changes() = 1
      `,
      ).bind(await hashApiKey(apiKey), maskApiKey(apiKey)),
    ]);
  } catch (err) {
    // UNIQUE(email) lost a race with a concurrent registration.
    if (String(err).includes("UNIQUE")) return c.json({ error: "Email already registered" }, 409);
    throw err;
  }

  if (userInsert.meta.changes !== 1) {
    return c.json({ error: "Tenant already exists. Ask an administrator to add you to it." }, 409);
  }
  return c.json({ success: true, email, tenantId, role, apiKey });
});

/* Clients list their own keys; super admins any tenant's via ?tenantId=. */
keyRoutes.get("/keys", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const tenantId = owner.role === "super_admin" ? cleanString(c.req.query("tenantId"), MAX_TENANT_ID_LENGTH) : null;

  const columns = "a.id, a.key_hint, a.status, a.created_at, a.revoked_at, u.email";
  const query = tenantId
    ? c.env.DB.prepare(
        `SELECT ${columns} FROM api_keys a JOIN users u ON u.id = a.user_id WHERE u.tenant_id = ? ORDER BY a.id DESC LIMIT 200`,
      ).bind(tenantId)
    : c.env.DB.prepare(
        `SELECT ${columns} FROM api_keys a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 200`,
      ).bind(owner.user_id);

  const { results } = await query.all<{
    id: number;
    key_hint: string;
    status: string;
    created_at: string;
    revoked_at: string | null;
    email: string;
  }>();

  return c.json({
    keys: results.map((row) => ({
      id: row.id,
      hint: row.key_hint,
      status: row.status,
      email: row.email,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      current: row.id === owner.key_id,
    })),
  });
});

/* A new key for the caller; the plaintext is returned once, never stored. */
keyRoutes.post("/keys", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;

  const active = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND status = 'active'")
    .bind(owner.user_id)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_KEYS_PER_USER) {
    return c.json({ error: `At most ${MAX_ACTIVE_KEYS_PER_USER} active keys per user; revoke one first` }, 409);
  }

  const apiKey = generateApiKey();
  const hint = maskApiKey(apiKey);
  const { meta } = await c.env.DB.prepare(
    "INSERT INTO api_keys (user_id, key_hash, key_hint, status) VALUES (?, ?, ?, 'active')",
  )
    .bind(owner.user_id, await hashApiKey(apiKey), hint)
    .run();

  // Audit rows belong to a tenant; tenant-less legacy accounts have none.
  if (owner.tenant_id) {
    writeAudit(c.env, c.executionCtx, {
      tenantId: owner.tenant_id,
      apiKey,
      actor: actorFor(owner),
      actionType: "api_key_created",
      message: `API key ${hint} created for ${owner.email}`,
      severity: "Medium",
    });
  }

  return c.json({ success: true, id: meta.last_row_id, apiKey, hint });
});

keyRoutes.post("/keys/:id/revoke", async (c) => {
  const owner = await authenticate(c);
  if (owner instanceof Response) return owner;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: "Invalid key id" }, 400);

  const key = await c.env.DB.prepare(
    `
    SELECT a.id, a.user_id, a.key_hint, a.status, u.tenant_id, u.email
    FROM api_keys a JOIN users u ON u.id = a.user_id
    WHERE a.id = ?
  `,
  )
    .bind(id)
    .first<{ user_id: number; key_hint: string; status: string; tenant_id: string | null; email: string }>();

  // Clients may only revoke their own keys; 404 avoids revealing others'.
  if (!key || (owner.role !== "super_admin" && key.user_id !== owner.user_id)) {
    return c.json({ error: "Key not found" }, 404);
  }

  if (key.status !== "revoked") {
    await c.env.DB.prepare("UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id)
      .run();
    if (key.tenant_id) {
      writeAudit(c.env, c.executionCtx, {
        tenantId: key.tenant_id,
        actor: actorFor(owner),
        actionType: "api_key_revoked",
        message: `API key ${key.key_hint} for ${key.email} revoked`,
        severity: "High",
      });
    }
  }

  return c.json({ success: true, id, status: "revoked", current: id === owner.key_id });
});
