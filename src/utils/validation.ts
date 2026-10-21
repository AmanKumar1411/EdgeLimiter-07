export const RATE_LIMIT_ALGORITHMS = [
  "sliding_window",
  "fixed_window",
  "token_bucket",
];

/*
 New tenant IDs: lowercase alphanumerics, "-" and "_", 1–64 chars.
 Crucially no ":", which separates tenant from route in KV/DO keys —
 tenant "acme:get" + route "/x" would otherwise collide with tenant
 "acme" + route "get:/x" and let one tenant overwrite another's policy.
*/
export const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export const MAX_TENANT_ID_LENGTH = 128; // tolerates pre-validation tenants
export const MAX_ROUTE_LENGTH = 256;
export const MAX_IDENTIFIER_LENGTH = 256;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export const MAX_LIMIT = 1_000_000;
// sliding_window stores one timestamp per request in a single DO value.
export const MAX_SLIDING_WINDOW_LIMIT = 10_000;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 Trimmed string, or null when missing, empty, too long, or containing
 control characters (which also keeps "\u0000" free for key separators).
*/
export function cleanString(
  value: unknown,
  maxLength: number
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  return trimmed;
}

export function isValidEmail(email: string) {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

/*
 Durable Object / KV key. The tenant/route form is unchanged from earlier
 versions so existing policies and counters keep working; the optional
 per-end-user identifier is appended after "\u0000", which cleanString
 guarantees cannot occur inside a route.
*/
export function policyKey(tenantId: string, route: string) {
  return `${tenantId}:${route}`;
}

export function limiterKey(
  tenantId: string,
  route: string,
  identifier?: string | null
) {
  const base = policyKey(tenantId, route);
  return identifier ? `${base}\u0000${identifier}` : base;
}

export type Policy = {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: string;
};

/*
 Returns an error message, or null when the policy values are valid.
*/
export function validatePolicyValues(
  limit: unknown,
  window: unknown,
  algorithm: unknown
): string | null {
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_LIMIT) {
    return `limit must be a positive integer (max ${MAX_LIMIT})`;
  }
  if (!Number.isInteger(window) || (window as number) < 1 || (window as number) > MAX_WINDOW_SECONDS) {
    return `window must be a positive integer (seconds, max ${MAX_WINDOW_SECONDS})`;
  }
  if (typeof algorithm !== "string" || !RATE_LIMIT_ALGORITHMS.includes(algorithm)) {
    return `algorithm must be one of: ${RATE_LIMIT_ALGORITHMS.join(", ")}`;
  }
  if (algorithm === "sliding_window" && (limit as number) > MAX_SLIDING_WINDOW_LIMIT) {
    return `sliding_window supports limit up to ${MAX_SLIDING_WINDOW_LIMIT}; use fixed_window or token_bucket for higher limits`;
  }
  return null;
}

/*
 Parses a stored KV policy. Returns null when unusable so /check never
 feeds NaN limits into the Durable Object. Deliberately more lenient than
 validatePolicyValues: policies saved before stricter validation (e.g.
 fractional limits, unknown algorithm) keep enforcing as they did.
*/
export function parseStoredPolicy(raw: string): Policy | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Policy>;
    const limit = Math.floor(Number(parsed.limit));
    const window = Math.floor(Number(parsed.window));

    if (!Number.isFinite(limit) || limit < 1) return null;
    if (!Number.isFinite(window) || window < 1) return null;

    const algorithm =
      typeof parsed.algorithm === "string" &&
      RATE_LIMIT_ALGORITHMS.includes(parsed.algorithm)
        ? parsed.algorithm
        : "sliding_window"; // what the DO always fell back to

    return {
      tenantId: String(parsed.tenantId ?? ""),
      route: String(parsed.route ?? ""),
      limit,
      window,
      algorithm,
    };
  } catch {
    return null;
  }
}
