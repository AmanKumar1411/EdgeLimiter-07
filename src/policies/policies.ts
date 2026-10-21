import { isAlgorithm, type AlgorithmName } from "../ratelimit/algorithms";
import type { Env } from "../shared/env";

export interface Policy {
  tenantId: string;
  route: string;
  limit: number;
  window: number;
  algorithm: AlgorithmName;
}

const MAX_LIMIT = 1_000_000;
const MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;
// sliding_window stores one timestamp per request in a single DO value.
const MAX_SLIDING_WINDOW_LIMIT = 10_000;

/*
 KV caches reads at the edge for this long. Policy edits can take up to a
 minute to reach every location; counters (Durable Objects) are unaffected.
*/
const POLICY_CACHE_SECONDS = 60;

/** KV key; tenant IDs can't contain ":" so tenant:route is unambiguous. */
export function policyKey(tenantId: string, route: string) {
  return `${tenantId}:${route}`;
}

type Rule = Pick<Policy, "limit" | "window" | "algorithm">;

/** The rule for a new or updated policy, or why it is invalid. */
export function parseRule(limit: number, window: number, algorithm: unknown): Rule | { error: string } {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be a positive integer (max ${MAX_LIMIT})` };
  }
  if (!Number.isInteger(window) || window < 1 || window > MAX_WINDOW_SECONDS) {
    return { error: `window must be a positive integer (seconds, max ${MAX_WINDOW_SECONDS})` };
  }
  if (!isAlgorithm(algorithm)) {
    return { error: "algorithm must be one of: sliding_window, fixed_window, token_bucket" };
  }
  if (algorithm === "sliding_window" && limit > MAX_SLIDING_WINDOW_LIMIT) {
    return {
      error: `sliding_window supports limit up to ${MAX_SLIDING_WINDOW_LIMIT}; use fixed_window or token_bucket for higher limits`,
    };
  }
  return { limit, window, algorithm };
}

/*
 Parses a stored policy, or null when unusable (so /check never sends NaN
 to the limiter). More lenient than parseRule: policies saved before
 validation existed (fractional limits, unknown algorithm) keep working as
 they always did.
*/
export function parseStoredPolicy(raw: string): Policy | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof Policy, unknown>>;
    const limit = Math.floor(Number(parsed.limit));
    const window = Math.floor(Number(parsed.window));
    if (!Number.isFinite(limit) || limit < 1) return null;
    if (!Number.isFinite(window) || window < 1) return null;
    return {
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : "",
      route: typeof parsed.route === "string" ? parsed.route : "",
      limit,
      window,
      algorithm: isAlgorithm(parsed.algorithm) ? parsed.algorithm : "sliding_window",
    };
  } catch {
    return null;
  }
}

/** The raw stored policy JSON, or null if the route has none. */
export function readPolicy(env: Env, tenantId: string, route: string) {
  return env.CONFIG_KV.get(policyKey(tenantId, route), { cacheTtl: POLICY_CACHE_SECONDS });
}

export function savePolicy(env: Env, policy: Policy) {
  // Metadata mirrors the value so listing needs no extra read per key.
  return env.CONFIG_KV.put(policyKey(policy.tenantId, policy.route), JSON.stringify(policy), {
    metadata: policy,
  });
}

export function deletePolicy(env: Env, tenantId: string, route: string) {
  return env.CONFIG_KV.delete(policyKey(tenantId, route));
}

export async function listPolicies(env: Env, tenantId: string, cursor?: string) {
  const listed = await env.CONFIG_KV.list<Policy>({ prefix: `${tenantId}:`, limit: 100, cursor });
  const policies = await Promise.all(
    listed.keys.map(async (key) => {
      if (key.metadata) return key.metadata;
      // Saved before metadata was added.
      const raw = await env.CONFIG_KV.get(key.name);
      return raw ? parseStoredPolicy(raw) : null;
    }),
  );
  return {
    // The prefix also matches legacy tenant IDs that contain ":".
    policies: policies.filter((p): p is Policy => p !== null && p.tenantId === tenantId),
    cursor: listed.list_complete ? null : listed.cursor,
  };
}
