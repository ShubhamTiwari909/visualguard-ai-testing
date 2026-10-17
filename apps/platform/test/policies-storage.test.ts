import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openPlatform } from "../server/config.js";
import { AuthService } from "../server/auth.js";
import { Policies, type PolicyMutation } from "../server/policies.js";
import { isolatedStorage } from "./fixtures/isolated-storage.js";
import { owner } from "./fixtures/policy-platform.js";
import type { PlatformRepository, StateStore } from "../server/storage-contracts.js";

for (const backend of ["sqlite", "postgres", "mongo"] as const) {
  const url =
    backend === "postgres"
      ? process.env.VISUALGUARD_TEST_DATABASE_URL
      : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf(backend !== "sqlite" && !url)(`${backend} visual policy persistence`, () => {
    let storage: { repository: PlatformRepository; state: StateStore; close(): Promise<void> };
    let root: string, policies: Policies, auth: AuthService;
    const project = `policy-${randomUUID().slice(0, 8)}`;
    const mutation: PolicyMutation = {
      expectedVersion: 0,
      reason: "Initial policy",
      policy: {
        mode: "informative",
        baselineSet: "main",
        targetBranch: "main",
        environment: "staging",
        requiredChecks: [],
        requireApproval: true,
        maxAgeHours: 24,
        exceptions: [],
      },
    };
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "vg-policy-storage-"));
      storage =
        backend === "sqlite"
          ? await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: root })
          : await isolatedStorage(backend, url!);
      auth = new AuthService(storage.state, { VISUALGUARD_AUTH_MODE: "local" });
      await auth.ready;
      await storage.repository.createProject(project, "Policy project");
      policies = new Policies(storage.repository, storage.state, auth);
    });
    afterAll(async () => {
      await storage?.close();
      if (root) await rm(root, { recursive: true, force: true });
    });
    it("allows exactly one concurrent policy creation and preserves the original version", async () => {
      const attempts = await Promise.allSettled([
        policies.save(owner, project, mutation),
        policies.save(owner, project, mutation),
      ]);
      expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
      const history = await new Policies(storage.repository, storage.state, auth).history(
        owner,
        project,
      );
      expect(history.versions).toHaveLength(1);
      expect(history.current?.reason).toBe("Initial policy");
    });
    it("preserves policy versions and removes them on full project deletion", async () => {
      await policies.save(owner, project, {
        ...mutation,
        expectedVersion: 1,
        reason: "Second revision",
      });
      expect((await policies.history(owner, project)).versions.map((item) => item.version)).toEqual(
        [2, 1],
      );
      await storage.repository.deleteProject(project, 0);
      expect(await storage.state.get("visual-policies", project)).toBeUndefined();
    });
  });
}
