import type { Algorithm, Policy, RequestLog } from "./api";

export const ALGORITHMS: { value: Algorithm; label: string; explanation: string }[] = [
  {
    value: "sliding_window",
    label: "Sliding window",
    explanation: "Counts requests in the last window. Smoothest; the right default.",
  },
  {
    value: "fixed_window",
    label: "Fixed window",
    explanation: "Resets the count at each window boundary. Simple, but allows bursts at the edges.",
  },
  {
    value: "token_bucket",
    label: "Token bucket",
    explanation: "Refills steadily and allows short bursts up to the limit.",
  },
];

export const WINDOW_UNITS = [
  { value: 1, singular: "second", plural: "seconds" },
  { value: 60, singular: "minute", plural: "minutes" },
  { value: 3600, singular: "hour", plural: "hours" },
  { value: 86400, singular: "day", plural: "days" },
] as const;

// The server's limits (see src/utils/validation.ts in the Worker).
export const MAX_SLIDING_WINDOW_LIMIT = 10_000;
export const MAX_WINDOW_SECONDS = 30 * 86400;

/** Largest unit that divides the window evenly: 120 → { count: 2, unit: 60 }. */
export function splitWindow(seconds: number) {
  const unit = [...WINDOW_UNITS].reverse().find((u) => seconds % u.value === 0) ?? WINDOW_UNITS[0];
  return { count: seconds / unit.value, unit: unit.value };
}

/** "minute", "5 minutes" */
export function describeWindow(seconds: number) {
  const { count, unit } = splitWindow(seconds);
  const names = WINDOW_UNITS.find((u) => u.value === unit)!;
  return count === 1 ? names.singular : `${count} ${names.plural}`;
}

/** "100 per minute" */
export function describeRule(policy: Pick<Policy, "limit" | "window">) {
  return `${policy.limit.toLocaleString()} per ${describeWindow(policy.window)}`;
}

export function algorithmLabel(algorithm: string) {
  return ALGORITHMS.find((a) => a.value === algorithm)?.label ?? algorithm;
}

export type Outcome = "allowed" | "limited" | "rejected";

export function outcomeOf(log: RequestLog): Outcome {
  if (log.allowed) return "allowed";
  return log.reason === "rate_limit_exceeded" ? "limited" : "rejected";
}

const REASONS: Record<string, string> = {
  rate_limit_exceeded: "Rate limited",
  unauthorized_api_key: "Invalid API key",
  api_key_missing: "Missing API key",
  tenant_mismatch: "Wrong project",
  config_not_found: "No limit for route",
  config_invalid: "Invalid limit",
  tenant_route_missing: "Bad request",
  invalid_request_body: "Bad request",
  policy_unavailable: "Allowed (degraded)",
  limiter_unavailable: "Allowed (degraded)",
};

export function describeOutcome(log: RequestLog) {
  if (log.reason && REASONS[log.reason]) return REASONS[log.reason];
  return log.allowed ? "Allowed" : (log.reason ?? "Blocked");
}

export type Severity = "Low" | "Medium" | "High" | "Critical";

export const SEVERITY_TONE = {
  Low: "success",
  Medium: "warning",
  High: "danger",
  Critical: "danger",
} as const satisfies Record<Severity, string>;

/** The API reports severity as 20 / 55 / 85 / 95. */
export function severityOf(score: number): Severity {
  if (score >= 90) return "Critical";
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}
