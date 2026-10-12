/**
 * @file Creates isolated temporary test configurations and output directories.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../../src/config/load.js";
import { resolveConfig, type ConfigOverrides } from "../../src/config/resolve.js";
import type { VisualGuardConfig } from "../../src/config/schema.js";

/**
 * A resolved config for tests, writing runs to a fresh temp directory.
 *
 * Create a resolved config with a fresh temporary output directory and repeatable capture
 * settings. Explicit overrides and an empty environment keep tests independent of developer
 * configuration.
 */
export function testConfig(config: VisualGuardConfig, overrides: ConfigOverrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "vg-run-"));
  const parsed = parseConfig({
    ...config,
    stabilize: { networkQuietMs: 100, freezeTime: "2026-01-01T00:00:00Z", ...config.stabilize },
  });
  return resolveConfig(parsed, { cwd, env: {}, overrides });
}
