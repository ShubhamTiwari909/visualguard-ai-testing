import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/main.ts",
    "diff-worker": "src/diff/worker.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  splitting: true,
  // Playwright is an optional peer dependency, loaded lazily at runtime.
  external: ["playwright"],
  define: {
    __VISUALGUARD_VERSION__: JSON.stringify(pkg.version),
  },
});
