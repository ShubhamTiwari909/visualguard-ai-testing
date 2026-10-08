import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDoctor } from "../src/cli/commands/doctor.js";
import { runInit } from "../src/cli/commands/init.js";
import { loadConfig } from "../src/config/load.js";
import { renderConfig } from "../src/setup/config-template.js";
import {
  addPackageScript,
  detectProject,
  ensureGitignore,
  setEnvVar,
} from "../src/setup/project.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

function nextProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "vg-init-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "app", dependencies: { next: "16.0.0", react: "19.0.0" } }, null, 2),
  );
  writeFileSync(join(dir, "pnpm-lock.yaml"), "");
  for (const file of ["app/page.tsx", "app/identical/page.tsx", "app/blog/[slug]/page.tsx"]) {
    mkdirSync(join(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), "export default () => null;\n");
  }
  return dir;
}

describe("project helpers", () => {
  it("detects Next.js and the package manager", () => {
    expect(detectProject(nextProject())).toMatchObject({
      framework: "nextjs",
      router: "app",
      packageManager: "pnpm",
    });
  });

  it("edits .gitignore, package.json scripts and env files idempotently", () => {
    const dir = nextProject();
    writeFileSync(join(dir, ".gitignore"), "node_modules");
    expect(ensureGitignore(dir, [".visualguard/", ".env.local"])).toEqual([
      ".visualguard/",
      ".env.local",
    ]);
    expect(ensureGitignore(dir, [".visualguard/", ".env.local"])).toEqual([]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
      "node_modules\n\n# VisualGuard\n.visualguard/\n.env.local\n",
    );

    expect(addPackageScript(dir, "visual", "visualguard test")).toBe(true);
    expect(addPackageScript(dir, "visual", "other")).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts).toEqual({
      visual: "visualguard test",
    });

    const env = join(dir, ".env.local");
    setEnvVar(env, "GEMINI_API_KEY", "one");
    setEnvVar(env, "OTHER", "x");
    setEnvVar(env, "GEMINI_API_KEY", "two");
    expect(readFileSync(env, "utf8")).toBe("GEMINI_API_KEY=two\nOTHER=x\n");
  });
});

describe("renderConfig", () => {
  it("renders a config that loads and validates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-render-"));
    writeFileSync(
      join(dir, "visualguard.config.ts"),
      renderConfig({
        production: "https://example.com",
        routes: ["/", "/pricing"],
        dynamicRoutes: ["/blog/[slug]", "/docs/[[...path]]"],
        viewports: ["desktop", "mobile"],
        ai: "gemini",
      }),
    );
    const { config } = await loadConfig({ cwd: dir });
    expect(config.baseURL).toEqual({ production: "https://example.com" });
    expect(config.routes).toEqual(["/", "/pricing"]);
    expect(config.viewports.mobile).toEqual({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
    });
    expect(config.ai.provider).toBe("gemini");
    const text = readFileSync(join(dir, "visualguard.config.ts"), "utf8");
    expect(text).toContain('// { path: "/blog/[slug]", params: [{ slug: "example" }] },');
    expect(text).toContain('// { path: "/docs/[[...path]]", params: [{ path: "example" }] },');
  });
});

describe("init --yes and doctor", () => {
  let production: FixtureServer;
  let staging: FixtureServer;
  beforeAll(async () => {
    production = await startFixtureServer("production");
    staging = await startFixtureServer("staging");
  });
  afterAll(async () => {
    await production.close();
    await staging.close();
  });

  it("writes a working config from file-system routes and the sitemap", async () => {
    const dir = nextProject();
    const result = await runInit(dir, {
      yes: true,
      production: production.url,
      staging: staging.url,
    });
    expect(result.answers.routes).toEqual(
      expect.arrayContaining(["/", "/identical", "/text-change"]),
    );
    expect(result.answers.dynamicRoutes).toEqual(["/blog/[slug]"]);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".visualguard/");

    const { config } = await loadConfig({ cwd: dir });
    expect(config.baseURL).toEqual({ production: production.url, staging: staging.url });
    expect(config.ai.provider).toBe("none");

    await expect(runInit(dir, { yes: true, production: production.url })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      runInit(dir, { yes: true, production: production.url, force: true }),
    ).resolves.toBeDefined();
  });

  it("doctor reports a ready setup", async () => {
    const dir = nextProject();
    await runInit(dir, { yes: true, production: production.url, staging: staging.url });
    const results = await runDoctor(dir);
    const byName = Object.fromEntries(results.map((result) => [result.name, result.status]));
    expect(byName).toMatchObject({
      "Node.js": "ok",
      Config: "ok",
      Playwright: "ok",
      Browser: "ok",
      "production URL": "ok",
      "staging URL": "ok",
      "AI provider": "ok",
      "Output directory": "ok",
      ".gitignore": "ok",
    });
  }, 60_000);

  it("doctor explains an invalid config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vg-doctor-"));
    writeFileSync(join(dir, "visualguard.config.ts"), "export default { diff: { threshold: 5 } };");
    const results = await runDoctor(dir);
    expect(results.find((result) => result.name === "Config")).toMatchObject({
      status: "fail",
      exitCode: 2,
    });
  });
});
