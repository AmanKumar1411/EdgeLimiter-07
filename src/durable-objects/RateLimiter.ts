import type { Env } from "../types/env";

type RateLimitRequest = {
  limit?: number;
  window?: number;
  algorithm?: string;
};

export class RateLimiter {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    /*
      RESET ENDPOINT
      DELETE /reset
    */
    if (
      request.method === "DELETE" &&
      request.url.endsWith("/reset")
    ) {
      await this.state.storage.deleteAll();

      return new Response(
        JSON.stringify({
          success: true,
          message: "Rate limit state reset",
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const body =
      (await request.json()) as RateLimitRequest;

    const limit = body.limit ?? 5;
    const windowSeconds = body.window ?? 60;
    const algorithm =
      body.algorithm ?? "sliding_window";

    let result;

    switch (algorithm) {
      case "fixed_window":
        result = await this.fixedWindow(
          limit,
          windowSeconds
        );
        break;

      case "token_bucket":
        result = await this.tokenBucket(
          limit,
          windowSeconds
        );
        break;

      case "sliding_window":
      default:
        result = await this.slidingWindow(
          limit,
          windowSeconds
        );
        break;
    }

    return new Response(
      JSON.stringify(result),
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }

  /*
    Sliding Window
  */
  async slidingWindow(
    limit: number,
    windowSeconds: number
  ) {
    const now = Math.floor(Date.now() / 1000);

    let timestamps: number[] =
      (await this.state.storage.get<number[]>(
        "timestamps"
      )) || [];

    timestamps = timestamps.filter(
      (timestamp) =>
        now - timestamp < windowSeconds
    );

    let allowed = false;
    let retryAfter = 0;

    if (timestamps.length < limit) {
      timestamps.push(now);
      allowed = true;
    } else {
      retryAfter =
        windowSeconds - (now - timestamps[0]);
    }

    await this.state.storage.put(
      "timestamps",
      timestamps
    );

    return {
      allowed,
      remaining: Math.max(
        0,
        limit - timestamps.length
      ),
      retryAfter,
      algorithm: "sliding_window",
    };
  }

  /*
    Fixed Window
  */
  async fixedWindow(
    limit: number,
    windowSeconds: number
  ) {
    const now = Math.floor(Date.now() / 1000);
    const currentWindow = Math.floor(
      now / windowSeconds
    );

    const storedWindow =
      (await this.state.storage.get<number>(
        "window"
      )) ?? currentWindow;

    let count =
      (await this.state.storage.get<number>(
        "count"
      )) ?? 0;

    if (storedWindow !== currentWindow) {
      count = 0;
      await this.state.storage.put(
        "window",
        currentWindow
      );
    }

    let allowed = false;

    if (count < limit) {
      count++;
      allowed = true;
    }

    await this.state.storage.put(
      "count",
      count
    );

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfter: windowSeconds,
      algorithm: "fixed_window",
    };
  }

  /*
    Token Bucket
  */
  async tokenBucket(
    limit: number,
    windowSeconds: number
  ) {
    const now = Date.now();

    let tokens =
      (await this.state.storage.get<number>(
        "tokens"
      )) ?? limit;

    let lastRefill =
      (await this.state.storage.get<number>(
        "lastRefill"
      )) ?? now;

    const refillRate =
      limit / (windowSeconds * 1000);

    const elapsed = now - lastRefill;
    const refill = elapsed * refillRate;

    tokens = Math.min(
      limit,
      tokens + refill
    );

    lastRefill = now;

    let allowed = false;

    if (tokens >= 1) {
      tokens -= 1;
      allowed = true;
    }

    await this.state.storage.put(
      "tokens",
      tokens
    );

    await this.state.storage.put(
      "lastRefill",
      lastRefill
    );

    return {
      allowed,
      remaining: Math.floor(tokens),
      retryAfter: tokens < 1 ? 1 : 0,
      algorithm: "token_bucket",
    };
  }
}