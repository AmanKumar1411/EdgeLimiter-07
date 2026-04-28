import type { Env } from "../types/env";

export async function pushToQueue(
  env: Env,
  apiKey: string,
  blocked: number
) {
  await env.LOG_QUEUE.send({
    apiKey,
    blocked,
  });
}