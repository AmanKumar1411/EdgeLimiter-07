import type { Env } from "../types/env";

type RateLimitRequest = {
  limit?: number;
  window?: number;
  algorithm?: string;
};

type ResetRequest = {
  type: "reset";
  tenantId?: string;
  route?: string;
};

const RATE_LIMIT_STATE_KEYS = [
  "timestamps",
  "window",
  "count",
  "tokens",
  "lastRefill",
  "retryAfter",
  "blockedUntil",
];

export class RateLimiter {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const body =
      (await request.json()) as RateLimitRequest | ResetRequest;

    if ((body as ResetRequest).type === "reset") {
      return this.reset(body as ResetRequest);
    }

    const checkBody = body as RateLimitRequest;

    const limit = checkBody.limit ?? 5;
    const windowSeconds = checkBody.window ?? 60;
    const algorithm =
      checkBody.algorithm ?? "sliding_window";

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
    Reset Counter
  */
  async reset(body: ResetRequest) {
    const tenantId = body.tenantId?.trim();
    const route = body.route?.trim();

    if (!tenantId || !route) {
      return new Response(
        JSON.stringify({
          error: "tenantId and route are required",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    const rateLimitKey = `${tenantId}:${route}`;

    await this.state.storage.delete([
      ...RATE_LIMIT_STATE_KEYS,
      ...RATE_LIMIT_STATE_KEYS.map(
        (key) => `${rateLimitKey}:${key}`
      ),
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Rate limit counter reset successfully",
      }),
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
