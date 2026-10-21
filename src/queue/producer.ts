import type { Env } from "../types/env";
import type { SecurityLogEvent } from "../types/security";

/*
 Best-effort: logging must never block or fail a rate-limit decision, so
 send errors (queue unavailable, quota) are logged and swallowed.
*/
export async function pushToQueue(
  env: Env,
  event: SecurityLogEvent
) {
  try {
    await env.LOG_QUEUE.send(event);
  } catch (err) {
    console.error("security log enqueue failed", {
      tenantId: event.tenantId,
      reason: event.reason,
      error: String(err),
    });
  }
}
