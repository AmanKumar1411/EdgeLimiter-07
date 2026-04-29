export type Env = {
  RATE_LIMITER: DurableObjectNamespace;
  CONFIG_KV: KVNamespace;
  DB: D1Database;
  LOG_QUEUE: Queue;
  ANALYTICS: AnalyticsEngineDataset;
  AI: Ai;
};

export type Bindings = Env;
