import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startDashboard } from "../server/runtime.js";
import { scaffoldDashboard } from "../server/scaffold.js";

describe("standalone hosts", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  async function folder() {
    const root = await mkdtemp(join(tmpdir(), "vg-host-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    return root;
  }
  it("serves static UI, health, settings and rewritten serverless API paths", async () => {
    const root = await folder(),
      assets = join(root, "ui");
    await mkdir(assets);
    await writeFile(join(assets, "index.html"), "<html>Dashboard test</html>");
    const runtime = await startDashboard({
      port: 0,
      host: "127.0.0.1",
      dataDir: join(root, "data"),
      assetDir: assets,
      env: { VISUALGUARD_AUTH_MODE: "local" },
    });
    cleanups.push(runtime.close);
    expect((await fetch(`${runtime.url}/api/health`)).status).toBe(200);
    expect(await (await fetch(`${runtime.url}/settings`)).text()).toContain("Dashboard test");
    const operations = await fetch(`${runtime.url}/operations`, { redirect: "manual" });
    expect(operations.status).toBe(200);
    expect(await operations.text()).toContain("Dashboard test");
    expect(operations.headers.get("cache-control")).toBe("no-store");
    const head = await fetch(`${runtime.url}/operations`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const reviews = await fetch(`${runtime.url}/reviews`, { redirect: "manual" });
    expect(reviews.status).toBe(200);
    expect(await reviews.text()).toContain("Dashboard test");
    expect((await fetch(`${runtime.url}/baselines`)).status).toBe(200);
    const invitation = await fetch(`${runtime.url}/invite`, { redirect: "manual" });
    expect(invitation.status).toBe(200);
    expect(await invitation.text()).toContain("Dashboard test");
    expect(invitation.headers.get("referrer-policy")).toBe("no-referrer");
    expect(invitation.headers.get("cache-control")).toBe("no-store");
    const rewritten = await (await fetch(`${runtime.url}/api/dashboard?__vg_path=projects`)).json();
    expect(rewritten.projects).toEqual([]);
  });
  it("refuses public listeners without authentication", async () => {
    await expect(
      startDashboard({ host: "0.0.0.0", env: { VISUALGUARD_AUTH_MODE: "local" } }),
    ).rejects.toThrow("login");
  });
  it("generates Vercel and Cloud Run projects without a repository checkout", async () => {
    const root = await folder();
    const vercel = await scaffoldDashboard({
      target: "vercel",
      out: join(root, "vercel"),
      version: "2.1.0",
    });
    const config = JSON.parse(await readFile(join(vercel, "vercel.json"), "utf8"));
    expect(config.rewrites).toContainEqual({ source: "/invite", destination: "/index.html" });
    expect(config.headers).toContainEqual({
      source: "/invite",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ],
    });
    expect(await readFile(join(vercel, ".env.example"), "utf8")).toContain(
      "VISUALGUARD_USER_ADMISSION=invite",
    );
    expect(await readFile(join(vercel, ".env.example"), "utf8")).toContain(
      "MongoDB requires a replica set",
    );
    expect(config.outputDirectory).toBe("public");
    expect(config.rewrites[0].destination).toContain("__vg_path");
    expect(config.rewrites).toContainEqual({ source: "/baselines", destination: "/index.html" });
    expect(config.rewrites).toContainEqual({ source: "/reviews", destination: "/index.html" });
    expect(config.rewrites).toContainEqual({ source: "/operations", destination: "/index.html" });
    expect(await readFile(join(vercel, "api/dashboard.mjs"), "utf8")).toContain(
      'from "visualguard/dashboard"',
    );
    const cloud = await scaffoldDashboard({
      target: "cloud-run",
      out: join(root, "cloud"),
      version: "2.1.0",
    });
    expect(await readFile(join(cloud, "Dockerfile"), "utf8")).toContain("0.0.0.0");
    expect(await readFile(join(cloud, ".dockerignore"), "utf8")).toContain(".env");
    await expect(
      scaffoldDashboard({ target: "vercel", out: vercel, version: "2.1.0" }),
    ).rejects.toThrow("empty");
  });
});
