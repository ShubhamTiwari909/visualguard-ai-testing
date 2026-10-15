import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPlatform } from "../server/config.js";
import { prepareTestBinding } from "../server/test-binding.js";

describe("test project binding", () => {
  let root: string, env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-binding-"));
    env = { VISUALGUARD_PLATFORM_DATA_DIR: root };
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });
  it("resolves IDs or unique names and creates a local project only for a valid new ID", async () => {
    const platform = await openPlatform(env);
    try {
      await platform.repository.createProject("storefront", "Storefront Web");
      await platform.repository.createProject("duplicate-a", "Duplicate");
      await platform.repository.createProject("duplicate-b", "Duplicate");
    } finally {
      await platform.close();
    }
    expect(
      (
        await prepareTestBinding({
          project: "Storefront Web",
          metadata: { environment: "ci" },
          env,
        })
      ).id,
    ).toBe("storefront");
    expect(
      (await prepareTestBinding({ project: "storefront", metadata: { environment: "ci" }, env }))
        .name,
    ).toBe("Storefront Web");
    await expect(
      prepareTestBinding({ project: "Duplicate", metadata: { environment: "ci" }, env }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      prepareTestBinding({ project: "Unknown Name", metadata: { environment: "ci" }, env }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await prepareTestBinding({ project: "new-project", metadata: { environment: "ci" }, env }))
        .id,
    ).toBe("new-project");
  });
  it("imports into the bound project and preserves engine-incomplete status", async () => {
    const binding = await prepareTestBinding({
      project: "local-app",
      metadata: { environment: "preview", branch: "feature/header" },
      env,
    });
    const dir = join(root, "saved-run");
    await mkdir(dir);
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "binding-run",
        number: 1,
        startedAt: "2026-10-15T10:00:00.000Z",
        durationMs: 0,
        mode: "compare",
        tool: { version: "2.0.0" },
        config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
        summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
        jobs: [],
      }),
    );
    const result = await binding.publish(dir);
    expect(result.status).toBe("incomplete");
    const platform = await openPlatform(env);
    try {
      const run = await platform.repository.getRun(result.id);
      expect(run.projectId).toBe("local-app");
      expect(run.metadata).toMatchObject({ environment: "preview", branch: "feature/header" });
    } finally {
      await platform.close();
    }
  });
  it("binds both public and original IDs to the same project after a rename", async () => {
    const platform = await openPlatform(env);
    try {
      await platform.repository.createProject("original", "Original name");
      await platform.repository.updateProject("original", "Friendly name", "friendly-id", 0);
    } finally { await platform.close(); }
    for (const project of ["original", "friendly-id", "Friendly name"]) {
      const binding = await prepareTestBinding({ project, metadata: { environment: "ci", runName: "Named smoke" }, env });
      expect(binding.id).toBe("original");
      expect(binding.publicId).toBe("friendly-id");
      expect(binding.name).toBe("Friendly name");
    }
  });
  it("uses scoped remote lookup and rejects unsafe URLs or missing remote credentials", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _options?: RequestInit) =>
        new Response(JSON.stringify({ id: "storefront", name: "Storefront Web" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const binding = await prepareTestBinding({
      project: "Storefront Web",
      server: "https://dashboard.example.test",
      metadata: { environment: "ci" },
      env: { VISUALGUARD_UPLOAD_TOKEN: "test-upload-token" },
    });
    expect(binding.id).toBe("storefront");
    expect(fetch.mock.calls[0]?.[0].toString()).toContain(
      "/api/publishing/project?project=Storefront+Web",
    );
    await expect(
      prepareTestBinding({
        project: "storefront",
        server: "http://remote.example.test",
        metadata: { environment: "ci" },
        env,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      prepareTestBinding({
        project: "storefront",
        server: "https://dashboard.example.test",
        metadata: { environment: "ci" },
        env,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
