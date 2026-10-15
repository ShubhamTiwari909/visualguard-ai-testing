/** JavaScript/assets only: deliberately does not run declaration/type checking. */
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build as bundle } from "tsup";
import { build as buildUI } from "vite";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await bundle({
  entry: {
    index: `${packageRoot}/src/index.ts`,
    cli: `${packageRoot}/src/cli/main.ts`,
    dashboard: `${packageRoot}/src/dashboard.ts`,
    playwright: `${packageRoot}/src/playwright/index.ts`,
    "diff-worker": `${packageRoot}/src/diff/worker.ts`,
  },
  outDir: `${packageRoot}/dist`,
  format: ["esm"],
  target: "node22",
  platform: "node",
  config: false,
  dts: false,
  clean: false,
  splitting: true,
  sourcemap: true,
  removeNodeProtocol: false,
  external: ["playwright", "@playwright/test", "pg", "mongodb", "openid-client", "vite"],
  define: { __VISUALGUARD_VERSION__: JSON.stringify(pkg.version) },
});
await buildUI({ configFile: `${repo}/apps/platform/vite.config.ts`, logLevel: "warn" });
await buildUI({ configFile: `${packageRoot}/report-app/vite.config.ts`, logLevel: "warn" });
await rm(`${packageRoot}/dist/dashboard-app`, { recursive: true, force: true });
await mkdir(`${packageRoot}/dist/dashboard-app`, { recursive: true });
await cp(`${repo}/apps/platform/dist/client`, `${packageRoot}/dist/dashboard-app`, {
  recursive: true,
});
await cp(`${packageRoot}/src/dashboard-api.d.ts`, `${packageRoot}/dist/dashboard.d.ts`);
