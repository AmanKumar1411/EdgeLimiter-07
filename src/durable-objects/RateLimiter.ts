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

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
  algorithm: string;
  /*
   True only for the first blocked request after allowed traffic, so the
   Worker can write one audit entry per block streak instead of one per
   blocked request (which would turn an attack into D1 write load).
  */
  firstBlock: boolean;
};

// Extra time before idle state is deleted, to absorb clock skew.
const CLEANUP_GRACE_MS = 5_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export class RateLimiter {
  state: DurableObjectState;
  env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    let body: RateLimitRequest | ResetRequest;

    try {
      body = (await request.json()) as RateLimitRequest | ResetRequest;
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if ((body as ResetRequest).type === "reset") {
      return this.reset(body as ResetRequest);
    }

    const checkBody = body as RateLimitRequest;

    const limit = checkBody.limit ?? 5;
    const windowSeconds = checkBody.window ?? 60;
    const algorithm =
      checkBody.algorithm ?? "sliding_window";

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      !Number.isInteger(windowSeconds) ||
      windowSeconds < 1
    ) {
      return json(
        { error: "limit and window must be positive integers" },
        400
      );
    }

    const nowMs = Date.now();
    let result;

    switch (algorithm) {
      case "fixed_window":
        result = await this.fixedWindow(
          limit,
          windowSeconds,
          nowMs
        );
        break;

      case "token_bucket":
        result = await this.tokenBucket(
          limit,
          windowSeconds,
          nowMs
        );
        break;

      case "sliding_window":
      default:
        result = await this.slidingWindow(
          limit,
          windowSeconds,
          nowMs
        );
        break;
    }

    const firstBlock = await this.trackBlockStreak(result.allowed);
    await this.scheduleCleanup(windowSeconds, nowMs);

    const decision: RateLimitDecision = { ...result, firstBlock };
    return json(decision);
  }

  /*
    Reset Counter
  */
  async reset(body: ResetRequest) {
    const tenantId = body.tenantId?.trim();
    const route = body.route?.trim();

    if (!tenantId || !route) {
      return json(
        {
          error: "tenantId and route are required",
        },
        400
      );
    }

    // Each object holds exactly one tenant/route(/identifier) counter, so
    // clearing everything also removes keys written by older versions.
    await this.state.storage.deleteAlarm();
    await this.state.storage.deleteAll();

    return json({
      success: true,
      message: "Rate limit counter reset successfully",
    });
  }

  /*
    Idle cleanup: once a full window passes with no traffic the state is
    equivalent to empty (timestamps expired, fixed window rolled over,
    bucket refilled), so delete it instead of keeping it forever.
  */
  async alarm() {
    const windowSeconds =
      await this.state.storage.get<number>("windowSeconds");
    const lastActivity = await this.lastActivityMs();

    if (!windowSeconds || lastActivity === null) {
      await this.state.storage.deleteAll();
      return;
    }

    const expiresAt =
      lastActivity + windowSeconds * 1000 + CLEANUP_GRACE_MS;

    if (Date.now() >= expiresAt) {
      await this.state.storage.deleteAll();
    } else {
      await this.state.storage.setAlarm(expiresAt);
    }
  }

  async trackBlockStreak(allowed: boolean) {
    const blocking =
      (await this.state.storage.get<boolean>("blocking")) ?? false;

    if (allowed) {
      if (blocking) await this.state.storage.delete("blocking");
      return false;
    }

    if (blocking) return false;

    await this.state.storage.put("blocking", true);
    return true;
  }

  async scheduleCleanup(windowSeconds: number, nowMs: number) {
    const storedWindow =
      await this.state.storage.get<number>("windowSeconds");

    if (storedWindow !== windowSeconds) {
      await this.state.storage.put("windowSeconds", windowSeconds);
    }

    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(
        nowMs + windowSeconds * 1000 + CLEANUP_GRACE_MS
      );
    }
  }

  async lastActivityMs(): Promise<number | null> {
    const windowSeconds =
      (await this.state.storage.get<number>("windowSeconds")) ?? 0;
    const timestamps =
      await this.state.storage.get<number[]>("timestamps");
    const fixedWindow = await this.state.storage.get<number>("window");
    const lastRefill =
      await this.state.storage.get<number>("lastRefill");

    const candidates: number[] = [];

    if (timestamps?.length) {
      candidates.push((Math.max(...timestamps) + 1) * 1000);
    }
    if (fixedWindow !== undefined) {
      // End of the stored window (conservative upper bound).
      candidates.push((fixedWindow + 1) * windowSeconds * 1000);
    }
    if (lastRefill !== undefined) {
      candidates.push(lastRefill);
    }

    return candidates.length ? Math.max(...candidates) : null;
  }

  /*
    Sliding Window
  */
  async slidingWindow(
    limit: number,
    windowSeconds: number,
    nowMs: number = Date.now()
  ) {
    const now = Math.floor(nowMs / 1000);

    const stored: number[] =
      (await this.state.storage.get<number[]>(
        "timestamps"
      )) || [];

    const timestamps = stored.filter(
      (timestamp) =>
        now - timestamp < windowSeconds
    );

    let allowed = false;
    let retryAfter = 0;

    if (timestamps.length < limit) {
      timestamps.push(now);
      allowed = true;
    } else {
      // A slot frees up once enough entries expire to drop below `limit`.
      // That is timestamps[0] only when length === limit; after the limit is
      // lowered the array can hold more entries than the new limit.
      retryAfter =
        windowSeconds -
        (now - timestamps[timestamps.length - limit]);
    }

    // Blocked requests that pruned nothing leave state unchanged.
    if (allowed || timestamps.length !== stored.length) {
      await this.state.storage.put(
        "timestamps",
        timestamps
      );
    }

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
    windowSeconds: number,
    nowMs: number = Date.now()
  ) {
    const now = Math.floor(nowMs / 1000);
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
    }

    let allowed = false;

    if (count < limit) {
      count++;
      allowed = true;
    }

    // Atomic batch write: both window and count are committed together,
    // preventing stale count surviving a DO eviction at the window boundary.
    await this.state.storage.put({
      window: currentWindow,
      count,
    });

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfter: allowed ? 0 : (currentWindow + 1) * windowSeconds - now,
      algorithm: "fixed_window",
    };
  }

  /*
    Token Bucket
  */
  async tokenBucket(
    limit: number,
    windowSeconds: number,
    nowMs: number = Date.now()
  ) {
    const now = nowMs;

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

    const elapsed = Math.max(0, now - lastRefill);
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

    // Single batch write so tokens and lastRefill are committed together.
    await this.state.storage.put({
      tokens,
      lastRefill,
    });

    // Seconds until one full token is available. Only meaningful when
    // blocked; an allowed response must not carry Retry-After.
    const retryAfter =
      !allowed
        ? Math.ceil((1 - tokens) / refillRate / 1000)
        : 0;

    return {
      allowed,
      remaining: Math.floor(tokens),
      retryAfter,
      algorithm: "token_bucket",
    };
  }
}
