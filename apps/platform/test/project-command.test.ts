import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDashboardProject } from "../server/project-command.js";
import { openPlatform } from "../server/config.js";

describe("dashboard project creation command", () => {
  let root: string, env: NodeJS.ProcessEnv;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-project-command-"));
    env = { VISUALGUARD_PLATFORM_DATA_DIR: root };
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it("creates an empty local project without a running server and does not rename it on repeat", async () => {
    const created = await createDashboardProject({ id: "storefront", name: "Storefront Web", env });
    expect(created.created).toBe(true);
    expect(created.project.runCount).toBe(0);
    const repeated = await createDashboardProject({
      id: "storefront",
      name: "Different name",
      env,
    });
    expect(repeated).toEqual({ created: false, project: created.project });
    const platform = await openPlatform(env);
    try {
      expect(await platform.repository.projects()).toEqual([created.project]);
    } finally {
      await platform.close();
    }
  });
  it("rejects invalid IDs, invalid names, reserved IDs and unsafe remote origins", async () => {
    await expect(createDashboardProject({ id: "Storefront Web", env })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      createDashboardProject({ id: "storefront", name: " ", env }),
    ).rejects.toMatchObject({ status: 400 });
    await createDashboardProject({ id: "removed", env });
    const platform = await openPlatform(env);
    try {
      await platform.repository.deleteProject("removed", 0);
    } finally {
      await platform.close();
    }
    await expect(createDashboardProject({ id: "removed", env })).rejects.toMatchObject({
      status: 409,
    });
    for (const server of [
      "",
      "http://remote.example.test",
      "https://admin:secret@example.test",
      "https://example.test/dashboard",
    ])
      await expect(createDashboardProject({ id: "storefront", server, env })).rejects.toMatchObject(
        { status: 400 },
      );
  });
  it("reuses a renamed public ID without creating a second project", async () => {
    await createDashboardProject({ id: "stable-key", name: "Before rename", env });
    const platform = await openPlatform(env);
    try {
      await platform.repository.updateProject("stable-key", "After rename", "new-public-id", 0);
    } finally {
      await platform.close();
    }
    const result = await createDashboardProject({
      id: "new-public-id",
      name: "Must not replace",
      env,
    });
    expect(result.created).toBe(false);
    expect(result.project.id).toBe("stable-key");
    expect(result.project.publicId).toBe("new-public-id");
    expect(result.project.name).toBe("After rename");
  });
});
