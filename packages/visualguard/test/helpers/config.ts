import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../../src/config/load.js";
import { resolveConfig, type ConfigOverrides } from "../../src/config/resolve.js";
import type { VisualGuardConfig } from "../../src/config/schema.js";

/** A resolved config for tests, writing runs to a fresh temp directory. */
export function testConfig(config: VisualGuardConfig, overrides: ConfigOverrides = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "vg-run-"));
  const parsed = parseConfig({
    ...config,
    stabilize: { networkQuietMs: 100, freezeTime: "2026-01-01T00:00:00Z", ...config.stabilize },
  });
  return resolveConfig(parsed, { cwd, env: {}, overrides });
}
