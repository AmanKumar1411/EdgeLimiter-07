import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.toml" },
        // Never reach real Cloudflare (Workers AI is billed even in dev);
        // AI is mocked per test.
        remoteBindings: false,
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          // Scratch database for migration tests (applied manually).
          d1Databases: {
            MIGRATION_DB: "migration-test-db",
            PROD_SHAPE_DB: "prod-shape-test-db",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
