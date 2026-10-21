import type { Context } from "hono";

export const MAX_BODY_BYTES = 16 * 1024;

/** The parsed JSON object body, or null when missing, malformed or not an object. */
export async function readJsonObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch (err) {
    // Streamed (no Content-Length) bodies over the limit surface here;
    // rethrow so the bodyLimit middleware answers 413, not "invalid JSON".
    if (err instanceof Error && err.name === "BodyLimitError") throw err;
    return null;
  }
}

export interface ClientInfo {
  ipAddress: string | null;
  country: string | null;
  colo: string | null;
  userAgent: string | null;
}

export function clientInfo(request: Request): ClientInfo {
  const cf = request.cf as { country?: unknown; colo?: unknown } | undefined;
  return {
    // Cloudflare always sets (and overwrites) CF-Connecting-IP. No
    // x-forwarded-for fallback: it is client-controlled and spoofable.
    ipAddress: request.headers.get("CF-Connecting-IP"),
    country: typeof cf?.country === "string" ? cf.country : null,
    colo: typeof cf?.colo === "string" ? cf.colo : null,
    userAgent: request.headers.get("user-agent"),
  };
}
