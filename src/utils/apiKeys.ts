import type { Env } from "../types/env";

export type ApiKeyOwner = {
  user_id: number;
  email: string;
  role: string;
  // NULL for accounts created before users.tenant_id existed (production
  // has some). Such an owner has access to no tenant — never "all tenants".
  tenant_id: string | null;
  key_id: number;
  key_hint: string;
  status: string;
};

const API_KEY_PREFIX = "edge_limit_";

// Real keys are 43 chars; anything far longer is rejected before hashing/DB.
export const MAX_API_KEY_LENGTH = 128;

export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomUUID().replace(/-/g, "");
}

/*
 Keys are 122-bit random tokens, so an unsalted SHA-256 is sufficient
 (no dictionary to attack) and keeps lookups a single indexed equality.
*/
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(key)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getUserByApiKey(env: Env, apiKey: string) {
  if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH) return null;

  const keyHash = await hashApiKey(apiKey);

  const row = await env.DB.prepare(
    `
      SELECT
        u.id AS user_id,
        u.email,
        u.role,
        u.tenant_id,
        a.id AS key_id,
        a.key_hint,
        a.status,
        a.key_hash
      FROM api_keys a
      INNER JOIN users u ON u.id = a.user_id
      WHERE a.key_hash = ?1 OR a.legacy_key = ?2
      LIMIT 1
    `
  )
    .bind(keyHash, apiKey)
    .first<ApiKeyOwner & { key_hash: string | null }>();

  if (!row) return null;

  // Key created before hashing (migration 0002): hash it now and drop the
  // plaintext so it no longer exists at rest.
  if (row.key_hash === null) {
    await env.DB.prepare(
      `UPDATE api_keys SET key_hash = ?, legacy_key = NULL WHERE id = ?`
    )
      .bind(keyHash, row.key_id)
      .run();
  }

  const { key_hash: _, ...owner } = row;
  return owner;
}

/*
 Returns the active owner of the key, or null. Not cached: D1 is the
 source of truth, so a revoked key stops working on the next request.
*/
export async function getActiveOwner(
  env: Env,
  apiKey: string | undefined
) {
  if (!apiKey) return null;

  const owner = await getUserByApiKey(env, apiKey);
  return owner && owner.status === "active" ? owner : null;
}

export function maskApiKey(key: string): string {
  // Short values would be fully revealed by prefix + suffix.
  if (key.length <= 16) return "••••••••";
  return key.slice(0, 12) + "••••" + key.slice(-4);
}
