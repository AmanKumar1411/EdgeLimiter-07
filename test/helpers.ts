import { createExecutionContext, createMessageBatch, getQueueResult, waitOnExecutionContext } from "cloudflare:test";
import { env as baseEnv } from "cloudflare:workers";
import worker from "../src/index";
import type { Env } from "../src/shared/env";

export type TestEnv = Env & { sent: unknown[] };

/*
 Test env: real local D1/KV/DO (Miniflare), a capturing queue so log
 processing is deterministic, and NO Workers AI unless a mock is given
 (the real binding is remote and billed).
*/
export function makeEnv(overrides: Partial<Env> = {}): TestEnv {
  const sent: unknown[] = [];
  const queue = {
    async send(message: unknown) {
      sent.push(message);
    },
    async sendBatch(messages: { body: unknown }[]) {
      for (const m of messages) sent.push(m.body);
    },
  } as unknown as Queue;

  return {
    ...(baseEnv as unknown as Env),
    LOG_QUEUE: queue,
    AI: undefined,
    ...overrides,
    sent,
  };
}

let uniq = 0;
export function unique(prefix: string) {
  uniq += 1;
  return `${prefix}-${Date.now().toString(36)}-${uniq}`;
}

function randomIp() {
  const n = () => Math.floor(Math.random() * 250) + 1;
  return `10.${n()}.${n()}.${n()}`;
}

export async function call(
  env: Env,
  method: string,
  path: string,
  opts: {
    body?: unknown;
    apiKey?: string;
    ip?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "CF-Connecting-IP": opts.ip ?? randomIp(),
    ...opts.headers,
  };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;

  const request = new Request(`http://edge.test${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });

  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function json<T = any>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function register(
  env: Env,
  tenantId = unique("t"),
  email = `${unique("u")}@example.com`,
  adminKey?: string,
) {
  const res = await call(env, "POST", "/register", {
    body: { email, tenantId },
    apiKey: adminKey,
  });
  if (res.status !== 200) {
    throw new Error(`register failed ${res.status}: ${await res.text()}`);
  }
  const data = await json(res);
  return { tenantId, email, apiKey: data.apiKey as string };
}

export async function registerAdmin(env: Env) {
  const account = await register(env, unique("admin"));
  await env.DB.prepare(`UPDATE users SET role = 'super_admin' WHERE email = ?`).bind(account.email).run();
  return account;
}

export async function savePolicy(
  env: Env,
  apiKey: string,
  policy: {
    tenantId: string;
    route: string;
    limit: number;
    window: number;
    algorithm?: string;
  },
) {
  const res = await call(env, "POST", "/config", {
    apiKey,
    body: { algorithm: "sliding_window", ...policy },
  });
  if (res.status !== 200) {
    throw new Error(`config failed ${res.status}: ${await res.text()}`);
  }
}

export function check(env: Env, apiKey: string, tenantId: string, route: string, extra: Record<string, unknown> = {}) {
  return call(env, "POST", "/check", {
    apiKey,
    body: { tenantId, route, ...extra },
  });
}

/*
 Runs the real queue consumer over everything captured by makeEnv().
*/
export async function flushQueue(env: TestEnv) {
  const messages = env.sent.splice(0).map((body, i) => ({
    id: `msg-${Date.now()}-${i}`,
    timestamp: new Date(),
    attempts: 1,
    body,
  }));
  if (!messages.length) return null;

  const batch = createMessageBatch("rate-limit-logs", messages);
  const ctx = createExecutionContext();
  await worker.queue(batch, env);
  return getQueueResult(batch, ctx);
}
