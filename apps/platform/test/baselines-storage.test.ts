import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactStore } from "../server/artifacts.js";
import { openPlatform } from "../server/config.js";
import { AuthService } from "../server/auth.js";
import { Baselines } from "../server/baselines.js";
import { Reviews } from "../server/reviews.js";
import type { StateStore, PlatformRepository } from "../server/storage-contracts.js";
import { baselineRun } from "./fixtures/baseline-run.js";
import { isolatedStorage } from "./fixtures/isolated-storage.js";

const owner = { id: "local-owner", name: "Local workspace", email: "", admin: true, csrf: "" };
for (const backend of ["sqlite", "postgres", "mongo"] as const) {
  const url =
    backend === "postgres"
      ? process.env.VISUALGUARD_TEST_DATABASE_URL
      : process.env.VISUALGUARD_TEST_MONGODB_URL;
  describe.skipIf(backend !== "sqlite" && !url)(
    `${backend} approved baseline transaction boundaries`,
    () => {
      let store: ArtifactStore;
      let root: string,
        state: StateStore,
        repository: PlatformRepository,
        close: () => Promise<void>,
        auth: AuthService;
      beforeAll(async () => {
        root = await mkdtemp(join(tmpdir(), "vg-baseline-storage-"));
        const storage =
          backend === "sqlite"
            ? await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: root })
            : await isolatedStorage(backend, url!);
        ({ state, repository, close, store } = storage);
        auth = new AuthService(state, { VISUALGUARD_AUTH_MODE: "local" });
        await auth.ready;
        await repository.createProject("storefront", "Storefront");
      });
      afterAll(async () => {
        await close?.();
        if (root) await rm(root, { recursive: true, force: true });
      });
      async function seed() {
        const candidate = baselineRun();
        for (const artifact of candidate.artifacts) {
          const bytes = Buffer.from(artifact.path);
          artifact.hash = await store.put(bytes);
          artifact.size = bytes.length;
        }
        const run = (await repository.insertRun(candidate)).run;
        const reviews = new Reviews(repository, state, auth);
        for (const job of run.manifest.jobs) {
          const view = await reviews.read(owner, run.id, job.id);
          if (view.status !== "approved")
            await reviews.append(owner, run.id, {
              jobId: job.id,
              evidenceDigest: view.evidenceDigest,
              scopeDigest: view.scopeDigest,
              expectedVersion: view.version,
              event: { action: "approve_visual_change", reason: "Storage review" },
            });
        }
        return {
          expectedVersion: 0,
          runId: run.id,
          evidenceDigest: run.digest,
          sourceRevision: run.metadata.commit!,
          targetRevision: "b".repeat(40),
          landed: true as const,
          reason: "Landed source",
        };
      }
      it("rolls back version, head, review fences and retention when the audit write fails", async () => {
        const input = await seed();
        const failedState = new Proxy(state, {
          get(target, property) {
            if (property === "transaction")
              return (work: (store: StateStore) => Promise<unknown>) =>
                target.transaction!((store) =>
                  work(
                    new Proxy(store, {
                      get(transaction, key) {
                        if (key === "create")
                          return <T>(
                            namespace: string,
                            id: string,
                            value: T,
                            expiresAt?: string,
                          ) =>
                            namespace === "audit"
                              ? Promise.resolve(false)
                              : transaction.create(namespace, id, value, expiresAt);
                        const value = Reflect.get(transaction, key);
                        return typeof value === "function" ? value.bind(transaction) : value;
                      },
                    }),
                  ),
                );
            const value = Reflect.get(target, property);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await expect(
          new Baselines(repository, failedState, auth).promote(
            owner,
            "storefront",
            "rollback",
            input,
          ),
        ).rejects.toMatchObject({ status: 409 });
        expect(await state.list("baseline-heads")).toHaveLength(0);
        expect(await state.list("baseline-versions")).toHaveLength(0);
        expect(
          (await state.get<{ pinned: boolean }>("baseline-runs", input.runId))?.value.pinned,
        ).toBe(false);
      });
      it("allows a portable restore of an unretained run to be deleted again", async () => {
        const candidate = baselineRun("33333333-3333-4333-8333-333333333333");
        const persistArtifacts = async () => {
          for (const artifact of candidate.artifacts) {
            const bytes = Buffer.from(artifact.path);
            artifact.hash = await store.put(bytes);
            artifact.size = bytes.length;
          }
        };
        await persistArtifacts();
        const run = (await repository.insertRun(candidate, candidate.id)).run;
        await repository.deleteRun(run.id);
        await persistArtifacts();
        await repository.insertRun(candidate, candidate.id);
        await expect(repository.deleteRun(run.id)).resolves.toMatchObject({ runs: 1 });
      });
      it("serializes competing heads and preserves retained source evidence", async () => {
        const input = await seed();
        const service = new Baselines(repository, state, auth);
        const results = await Promise.allSettled([
          service.promote(owner, "storefront", "main", input),
          service.promote(owner, "storefront", "main", input),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect((await service.version(owner, "storefront", "main")).version).toBe(1);
        await expect(repository.deleteRun(input.runId)).rejects.toThrow("retained");
        await service.restore(owner, "storefront", "main", {
          expectedVersion: 1,
          version: 1,
          reason: "Restore with lineage",
        });
        expect((await service.version(owner, "storefront", "main")).restoredFrom).toBe(1);
        expect((await service.version(owner, "storefront", "main", 1)).version).toBe(1);
      });
    },
  );
}
