import type { Env } from "./types/env";

type RateLimitRequest = {
  limit?: number;
  window?: number;
};

export class RateLimiter {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const body =
      (await request.json()) as RateLimitRequest;

    const limit = body.limit ?? 5;
    const windowSeconds = body.window ?? 60;

    const now = Math.floor(Date.now() / 1000);

    let timestamps: number[] =
      (await this.state.storage.get("timestamps")) || [];

    // Remove expired timestamps
    timestamps = timestamps.filter(
      (timestamp) => now - timestamp < windowSeconds
    );

    let allowed = false;
    let retryAfter = 0;

    if (timestamps.length < limit) {
      timestamps.push(now);
      allowed = true;
    } else {
      retryAfter = windowSeconds - (now - timestamps[0]);
    }

    await this.state.storage.put("timestamps", timestamps);

    return new Response(
      JSON.stringify({
        allowed,
        remaining: Math.max(0, limit - timestamps.length),
        retryAfter
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}