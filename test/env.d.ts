import type { D1Migration } from "cloudflare:test";
import type { Env as WorkerEnv } from "../src/shared/env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
      MIGRATION_DB: D1Database;
      PROD_SHAPE_DB: D1Database;
    }
  }
}
