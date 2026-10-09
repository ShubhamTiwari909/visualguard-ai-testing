/**
 * @file Builds the report app once before Vitest suites that load the real HTML bundle.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { fileURLToPath } from "node:url";
import { build } from "vite";

/**
 * Builds the report app once so report tests run against the real bundle.
 *
 * Build the actual report UI once before Vitest suites execute. Report tests can then inspect
 * the same assets that the package renderer embeds.
 */
export default async function setup(): Promise<void> {
  await build({
    configFile: fileURLToPath(new URL("../report-app/vite.config.ts", import.meta.url)),
    logLevel: "warn",
  });
}
