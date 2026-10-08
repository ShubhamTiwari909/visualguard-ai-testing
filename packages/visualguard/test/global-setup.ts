import { fileURLToPath } from "node:url";
import { build } from "vite";

/** Builds the report app once so report tests run against the real bundle. */
export default async function setup(): Promise<void> {
  await build({
    configFile: fileURLToPath(new URL("../report-app/vite.config.ts", import.meta.url)),
    logLevel: "warn",
  });
}
