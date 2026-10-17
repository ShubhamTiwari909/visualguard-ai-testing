import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStateStore } from "../server/auth.js";
import { pinBaselineRun, type BaselineRunGuard } from "../server/baseline-guards.js";
import { ProjectDirectory } from "../server/project-directory.js";
import type { EvidenceRepository } from "../server/storage-contracts.js";
import type { RunDetail } from "../shared/contracts.js";
import { PlatformError } from "../server/errors.js";
import { baselineRun } from "./fixtures/baseline-run.js";

function barrier() {
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, release };
}

describe("baseline source retention across deletion and portable restore", () => {
  let state: MemoryStateStore, repository: ProjectDirectory, runs: Map<string, RunDetail>;
  let evidence: EvidenceRepository, run: RunDetail;
  beforeEach(() => {
    state = new MemoryStateStore();
    run = baselineRun();
    runs = new Map([[run.id, structuredClone(run)]]);
    evidence = {
      async getRun(id: string) {
        const stored = runs.get(id);
        if (!stored) throw new PlatformError(404, "Run not found");
        return stored;
      },
      async insertRun(candidate: Omit<RunDetail, "id">, preserveId?: string) {
        const id = preserveId ?? run.id;
        const existing = runs.get(id);
        if (existing) return { run: existing, duplicate: true };
        const stored = { ...candidate, id };
        runs.set(id, stored);
        return { run: stored, duplicate: false };
      },
      async deleteRun(id: string) {
        if (!runs.delete(id)) throw new PlatformError(404, "Run not found");
        return { runs: 1, artifactsDeleted: 0, cleanupPending: false };
      },
    } as EvidenceRepository;
    repository = new ProjectDirectory(evidence, state);
  });
  it("refuses restore until metadata and artifact/review cleanup both finish", async () => {
    const removed = barrier(),
      finishCleanup = barrier();
    evidence.deleteRun = async (id) => {
      runs.delete(id);
      removed.release();
      await finishCleanup.reached;
      return { runs: 1, artifactsDeleted: 1, cleanupPending: false };
    };
    const deletion = repository.deleteRun(run.id);
    await removed.reached;
    try {
      await expect(repository.insertRun(run, run.id)).rejects.toMatchObject({ status: 409 });
      expect(runs.has(run.id)).toBe(false);
      expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.status).toBe(
        "deleting",
      );
    } finally {
      finishCleanup.release();
    }
    await deletion;
    expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.status).toBe(
      "deleted",
    );
    await repository.insertRun(run, run.id);
    await state.transaction!((store) => pinBaselineRun(store, run.id));
    await expect(repository.deleteRun(run.id)).rejects.toThrow("retained");
    expect(runs.has(run.id)).toBe(true);
  });
  it("keeps the guard closed after an uncertain deletion failure", async () => {
    evidence.deleteRun = async (id) => {
      runs.delete(id);
      throw new Error("Cleanup interrupted");
    };
    await expect(repository.deleteRun(run.id)).rejects.toThrow("interrupted");
    await expect(repository.insertRun(run, run.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      state.transaction!((store) => pinBaselineRun(store, run.id)),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("allows restoration after a confirmed missing-run response", async () => {
    runs.clear();
    await expect(repository.deleteRun(run.id)).rejects.toMatchObject({ status: 404 });
    await repository.insertRun(run, run.id);
    expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.status).toBe(
      "active",
    );
    await expect(repository.deleteRun(run.id)).resolves.toMatchObject({ runs: 1 });
  });
  it("does not treat a wrong-project 404 as permission to reuse an existing ID", async () => {
    evidence.deleteRun = async () => {
      throw new PlatformError(404, "Run not found in confirmed project");
    };
    await expect(repository.deleteRun(run.id, "wrong")).rejects.toMatchObject({ status: 404 });
    expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.status).toBe(
      "active",
    );
    await state.transaction!((store) => pinBaselineRun(store, run.id));
  });
  it("reopens an active run after a failed deletion confirmation", async () => {
    evidence.deleteRun = async () => {
      throw new PlatformError(409, "Wrong project confirmation");
    };
    await expect(repository.deleteRun(run.id, "wrong")).rejects.toMatchObject({ status: 409 });
    expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.status).toBe(
      "active",
    );
    await state.transaction!((store) => pinBaselineRun(store, run.id));
    expect((await state.get<BaselineRunGuard>("baseline-runs", run.id))?.value.pinned).toBe(true);
  });
});
