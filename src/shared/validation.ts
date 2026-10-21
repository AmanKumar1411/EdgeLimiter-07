/*
 New tenant IDs: lowercase alphanumerics, "-" and "_", 1–64 chars.
 Crucially no ":", which separates tenant from route in KV/DO keys:
 tenant "acme:get" + route "/x" would otherwise collide with tenant
 "acme" + route "get:/x" and let one tenant overwrite another's policy.
*/
export const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export const MAX_TENANT_ID_LENGTH = 128; // tolerates pre-validation tenants
export const MAX_ROUTE_LENGTH = 256;
export const MAX_IDENTIFIER_LENGTH = 256;
const MAX_EMAIL_LENGTH = 254;

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 Trimmed string, or null when missing, empty, too long, or containing
 control characters (which also keeps "\u0000" free for key separators).
*/
export function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  if (CONTROL_CHARS.test(trimmed)) return null;
  return trimmed;
}

export function isValidEmail(email: string) {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}
