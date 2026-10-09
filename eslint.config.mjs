/**
 * @file Declares repository lint rules and environment globals; this config is consumed by
 * ESLint.
 *
 * This file is read by development/build tooling. Its exported object configures that tool; it
 * is not a visual-test run or an application page.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.visualguard/**",
      "fixtures/site/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
