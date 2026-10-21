import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dashboard/**", "node_modules/**", ".wrangler/**", "dist/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "no-console": "error", // use shared/log.ts
    },
  },
  {
    rules: {
      eqeqeq: "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  { files: ["src/shared/log.ts"], rules: { "no-console": "off" } },
  // Tests assert on untyped JSON responses.
  { files: ["test/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  { files: ["scripts/**/*.mjs", "*.mjs"], languageOptions: { globals: globals.node } },
]);
