import type { AppContext, Env } from "../shared/env";

export interface KeyOwner {
  user_id: number;
  email: string;
  role: string;
  /*
   NULL for accounts created before users.tenant_id existed (production has
   some). Such an owner has access to no tenant, never "all tenants".
  */
  tenant_id: string | null;
  key_id: number;
  key_hint: string;
  status: string;
}

// Real keys are 40–43 chars; anything far longer is rejected before hashing.
export const MAX_API_KEY_LENGTH = 128;

export function generateApiKey() {
  return "edge_limit_" + crypto.randomUUID().replace(/-/g, "");
}

/*
 Keys are 122-bit random tokens, so an unsalted SHA-256 is enough (there is
 no dictionary to attack) and lookups stay a single indexed equality.
*/
export async function hashApiKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function maskApiKey(key: string) {
  // Short values would be fully revealed by prefix + suffix.
  if (key.length <= 16) return "••••••••";
  return key.slice(0, 12) + "••••" + key.slice(-4);
}

async function findOwner(env: Env, apiKey: string) {
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) return null;
  const keyHash = await hashApiKey(apiKey);

  const row = await env.DB.prepare(
    `
    SELECT u.id AS user_id, u.email, u.role, u.tenant_id,
           a.id AS key_id, a.key_hint, a.status, a.key_hash
    FROM api_keys a
    INNER JOIN users u ON u.id = a.user_id
    WHERE a.key_hash = ?1 OR a.legacy_key = ?2
    LIMIT 1
  `,
  )
    .bind(keyHash, apiKey)
    .first<KeyOwner & { key_hash: string | null }>();
  if (!row) return null;

  // Created before migration 0002: hash it now so no plaintext stays at rest.
  if (row.key_hash === null) {
    await env.DB.prepare("UPDATE api_keys SET key_hash = ?, legacy_key = NULL WHERE id = ?")
      .bind(keyHash, row.key_id)
      .run();
  }

  const { key_hash: _, ...owner } = row;
  return owner;
}

/*
 The active owner of a key, or null. Deliberately not cached: D1 is the
 source of truth, so a revoked key fails on its very next request.
*/
export async function findActiveOwner(env: Env, apiKey: string | undefined) {
  if (!apiKey) return null;
  const owner = await findOwner(env, apiKey);
  return owner?.status === "active" ? owner : null;
}

/** The caller's key owner, or the 401 response to return. */
export async function authenticate(c: AppContext): Promise<KeyOwner | Response> {
  const apiKey = c.req.header("x-api-key");
  if (!apiKey) return c.json({ error: "API key missing" }, 401);
  const owner = await findActiveOwner(c.env, apiKey);
  return owner ?? c.json({ error: "Unauthorized" }, 401);
}

/** Clients reach their own tenant only; super admins reach every tenant. */
export function canAccessTenant(owner: KeyOwner, tenantId: string) {
  return owner.role === "super_admin" || (owner.tenant_id !== null && owner.tenant_id === tenantId);
}

export function actorFor(owner: KeyOwner) {
  return owner.role === "super_admin" ? "admin" : "client";
}
