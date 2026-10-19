import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectTests, projectTestConfig } from "../server/project-tests.js";
import { openPlatform } from "../server/config.js";
import { owner, policyPlatform } from "./fixtures/policy-platform.js";

export const config = {
  baseURL: { production: "https://production.example.test", staging: "http://127.0.0.1:3000" },
  routes: ["/", "/pricing"],
  viewports: { desktop: { width: 1280, height: 800 } },
  ai: { provider: "none" as const },
};
describe("project-specific test configuration", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>, tests: ProjectTests;
  beforeEach(async () => {
    p = await policyPlatform();
    tests = new ProjectTests(p.repository, p.state, p.auth);
  });
  afterEach(async () => p.dispose());
  it("isolates projects and persists configuration across connections", async () => {
    await p.repository.createProject("other", "Other app");
    await tests.save(owner, "storefront", { expectedVersion: 0, config });
    await tests.save(owner, "other", { expectedVersion: 0, config: { ...config, baseURL: { ...config.baseURL, staging: "https://other.example.test" } } });
    const other = await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: p.root });
    try {
      const stored = new ProjectTests(other.repository, other.state, p.auth);
      expect((await stored.read(owner, "storefront"))?.config.baseURL.staging).toBe("http://127.0.0.1:3000");
      expect((await stored.read(owner, "other"))?.config.baseURL.staging).toBe("https://other.example.test");
    } finally { await other.close(); }
  });
  it("rejects stale edits and allows only one concurrent initial save", async () => {
    const results = await Promise.allSettled([
      tests.save(owner, "storefront", { expectedVersion: 0, config }),
      tests.save(owner, "storefront", { expectedVersion: 0, config }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(tests.save(owner, "storefront", { expectedVersion: 0, config })).rejects.toMatchObject({ status: 409 });
  });
  it("enforces project roles and keeps upload credentials out of configuration access", async () => {
    const viewer = { ...owner, id: "reader", admin: false };
    await p.state.create("memberships", "reader:storefront", { userId: "reader", projectId: "storefront", role: "viewer" });
    expect(await tests.read(viewer, "storefront")).toBeNull();
    await expect(tests.save(viewer, "storefront", { expectedVersion: 0, config })).rejects.toMatchObject({ status: 403 });
    await expect(tests.read(viewer, "other")).rejects.toMatchObject({ status: 403 });
    await expect(tests.read({ ...owner, credentialId: "upload" }, "storefront")).rejects.toMatchObject({ status: 403 });
  });
  it("rejects executable settings, secrets, non-HTTP URLs and unbounded capture input", () => {
    for (const invalid of [
      { ...config, hooks: { beforeCapture: "eval()" } },
      { ...config, baseURL: { ...config.baseURL, staging: "file:///etc/passwd" } },
      { ...config, baseURL: { ...config.baseURL, staging: "https://user:password@example.test" } },
      { ...config, ai: { provider: "gemini", apiKey: "secret" } },
      { ...config, routes: ["//other.example.test"] },
      { ...config, routes: Array(101).fill("/") },
      { ...config, viewports: { desktop: { width: 9000, height: 800 } } },
    ]) expect(projectTestConfig.safeParse(invalid).success).toBe(false);
  });
  it("removes configuration when its project is deleted", async () => {
    await tests.save(owner, "storefront", { expectedVersion: 0, config });
    await p.repository.deleteProject("storefront", (await p.repository.projects(["storefront"]))[0]!.runCount);
    expect(await p.state.get("project-test-configs", "storefront")).toBeUndefined();
    await expect(tests.save(owner, "storefront", { expectedVersion: 0, config })).rejects.toMatchObject({ status: 404 });
  });
});
