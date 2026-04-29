import type { Env } from "../types/env";
import type { SecurityLogEvent } from "../types/security";

export async function pushToQueue(
  env: Env,
  event: SecurityLogEvent
) {
  await env.LOG_QUEUE.send(event);
}
