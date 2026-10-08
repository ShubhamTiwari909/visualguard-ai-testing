import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadEnvFiles, parseConfig } from "../src/config/load.js";
import { resolveConfig } from "../src/config/resolve.js";
import { buildJobs } from "../src/core/jobs.js";
import { expandRoutes } from "../src/config/urls.js";

describe("parseConfig", () => {
  it("fills defaults", () => {
    const config = parseConfig({});
    expect(config.viewports).toEqual({ desktop: { width: 1440, height: 900 } });
    expect(config.diff.threshold).toBe(0.1);
    expect(config.stabilize.retries).toBe(2);
    expect(config.output.dir).toBe(".visualguard");
    expect(config.browser.name).toBe("chromium");
  });

  it("explains invalid values with hints", () => {
    expect(() => parseConfig({ diff: { threshold: 20 } }, "visualguard.config.ts")).toThrow(
      /diff\.threshold[\s\S]*Hint: threshold is per-pixel colour tolerance/,
    );
    expect(() => parseConfig({ routes: ["https://example.com/pricing"] })).toThrow(
      /routes must be paths/,
    );
    expect(() => parseConfig({ baseURL: { production: "example.com" } })).toThrow(/http\(s\) URL/);
  });

  it("rejects literal API keys", () => {
    expect(() => parseConfig({ ai: { key: "AIzaSyD-1234567890abcdefghijklmnopqrstu" } })).toThrow(
      /looks like an API key/,
    );
  });
});

describe("resolveConfig precedence: flags → env → config", () => {
  const config = parseConfig({
    baseURL: {
      production: "https://config.example.com",
      staging: "https://staging.config.example.com",
    },
    viewports: { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } },
  });

  it("uses the config file by default", () => {
    const resolved = resolveConfig(config, { cwd: "/tmp/project", env: {} });
    expect(resolved.baseURL.staging).toBe("https://staging.config.example.com");
    expect(resolved.outputDir).toBe("/tmp/project/.visualguard");
  });

  it("env vars beat the config file", () => {
    const resolved = resolveConfig(config, {
      cwd: "/tmp",
      env: { VISUALGUARD_STAGING_URL: "https://pr-42.vercel.app" },
    });
    expect(resolved.baseURL.staging).toBe("https://pr-42.vercel.app");
    expect(resolved.baseURL.production).toBe("https://config.example.com");
  });

  it("flags beat env vars", () => {
    const resolved = resolveConfig(config, {
      cwd: "/tmp",
      env: { VISUALGUARD_STAGING_URL: "https://pr-42.vercel.app" },
      overrides: { staging: "http://localhost:3000" },
    });
    expect(resolved.baseURL.staging).toBe("http://localhost:3000");
  });

  it("--route replaces routes and --viewport filters viewports", () => {
    const resolved = resolveConfig(config, {
      cwd: "/tmp",
      env: {},
      overrides: { routes: ["/pricing", "/checkout"], viewports: ["mobile"] },
    });
    expect(resolved.routes).toEqual(["/pricing", "/checkout"]);
    expect(Object.keys(resolved.viewports)).toEqual(["mobile"]);
    expect(() =>
      resolveConfig(config, { cwd: "/tmp", env: {}, overrides: { viewports: ["tablet"] } }),
    ).toThrow(/Unknown viewport: tablet/);
    expect(() =>
      resolveConfig(config, { cwd: "/tmp", env: {}, overrides: { routes: ["pricing"] } }),
    ).toThrow(/must be a path/);
  });

  it("builds one job per route × viewport with joined URLs", () => {
    const resolved = resolveConfig(config, { cwd: "/tmp", env: {} });
    const jobs = buildJobs(
      resolved,
      expandRoutes(["/", { path: "/pricing", staging: "/plans" }]).routes,
    );
    expect(jobs.map((job) => job.id)).toEqual([
      "index__desktop",
      "index__mobile",
      "pricing__desktop",
      "pricing__mobile",
    ]);
    expect(jobs[2]!.urls).toEqual({
      production: "https://config.example.com/pricing",
      staging: "https://staging.config.example.com/plans",
    });
  });
});

describe("loadConfig", () => {
  it("loads a TypeScript config that imports defineConfig from visualguard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-config-"));
    writeFileSync(
      join(dir, "visualguard.config.ts"),
      `import { defineConfig } from "visualguard";
       const routes: string[] = ["/", "/pricing"];
       export default defineConfig({ baseURL: { production: "https://example.com" }, routes });`,
    );
    const { config, configPath } = await loadConfig({ cwd: dir });
    expect(configPath).toBe(join(dir, "visualguard.config.ts"));
    expect(config.routes).toEqual(["/", "/pricing"]);
  });

  it("returns defaults when there is no config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-config-"));
    const { config, configPath } = await loadConfig({ cwd: dir });
    expect(configPath).toBeUndefined();
    expect(config.viewports.desktop).toBeDefined();
  });

  it("loads .env files without overriding existing variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-env-"));
    writeFileSync(join(dir, ".env"), "A=from-env\nB=from-env\n");
    writeFileSync(join(dir, ".env.local"), "B=from-local\nC=from-local\n");
    const env: NodeJS.ProcessEnv = { A: "from-shell" };
    loadEnvFiles(dir, env);
    expect(env).toEqual({ A: "from-shell", B: "from-local", C: "from-local" });
  });
});
