import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { SqlArtifactStore } from "../server/artifacts.js";
import { SqlStateStore } from "../server/state.js";
import { importRun } from "../server/ingest.js";
import { exportEvidence, restoreEvidence } from "../server/backup.js";

describe("portable evidence backups", () => {
  let root: string,
    source: Database,
    target: Database,
    a: Repository,
    b: Repository,
    objectsA: SqlArtifactStore,
    objectsB: SqlArtifactStore;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-backup-"));
    source = await openDatabase({ sqlitePath: join(root, "source.sqlite") });
    target = await openDatabase({ sqlitePath: join(root, "target.sqlite") });
    a = new Repository(source);
    b = new Repository(target);
    objectsA = new SqlArtifactStore(source);
    objectsB = new SqlArtifactStore(target);
    await a.createProject("demo", "Demo");
    await new SqlStateStore(source).create("sessions", "private-session", {
      secret: "DO-NOT-EXPORT-SESSION",
    });
    const dir = join(root, "run");
    await mkdir(join(dir, "jobs/home"), { recursive: true });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(dir, "jobs/home/image.png"), png);
    const capture = {
      image: "jobs/home/image.png",
      size: { width: 1, height: 1 },
      health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
      durationMs: 1,
      attempts: 1,
    };
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        id: "backup-run",
        number: 1,
        startedAt: "2026-10-15T10:00:00.000Z",
        durationMs: 1,
        mode: "compare",
        tool: { version: "2.0.0" },
        config: {
          baseURL: {},
          viewports: { desktop: { width: 1, height: 1 } },
          ai: { provider: "none" },
          failOn: "regression",
        },
        summary: { pass: 1, accepted: 0, review: 0, regression: 0, error: 0 },
        jobs: [
          {
            id: "home",
            route: "/",
            name: "Home",
            viewport: "desktop",
            status: "pass",
            durationMs: 1,
            urls: { production: "https://example.test", staging: "https://staging.test" },
            captures: { production: capture, staging: capture },
            regions: [],
          },
        ],
      }),
    );
    await importRun(a, objectsA, {
      projectId: "demo",
      runDir: dir,
      metadata: { environment: "backup" },
    });
  });
  afterEach(async () => {
    await source?.close();
    await target?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("restores metadata, screenshots, stable links and digests without exporting auth state", async () => {
    const path = join(root, "evidence.vgbackup.gz");
    expect((await exportEvidence(a, objectsA, path)).runs).toBe(1);
    const text = gunzipSync(await readFile(path)).toString();
    expect(text).not.toContain("DO-NOT-EXPORT-SESSION");
    expect(await restoreEvidence(b, objectsB, path)).toEqual({ runs: 1, objects: 1 });
    const original = (await a.runs({})).runs[0]!,
      restored = (await b.runs({})).runs[0]!;
    expect(restored.id).toBe(original.id);
    expect(restored.digest).toBe(original.digest);
    const detail = await b.getRun(restored.id);
    expect((await objectsB.get(detail.artifacts[0]!.hash)).length).toBeGreaterThan(0);
    expect((await new SqlStateStore(target).list("sessions")).length).toBe(0);
    await restoreEvidence(b, objectsB, path);
    expect((await b.runs({})).total).toBe(1);
  });
  it("rejects a corrupted object before publishing its run", async () => {
    const path = join(root, "evidence.gz");
    await exportEvidence(a, objectsA, path);
    const lines = gunzipSync(await readFile(path))
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const chunk = lines.find((line) => line.type === "object-chunk");
    chunk.data = Buffer.from("corrupt").toString("base64");
    await writeFile(path, gzipSync(lines.map((line) => JSON.stringify(line)).join("\n")));
    await expect(restoreEvidence(b, objectsB, path)).rejects.toThrow("incomplete");
    expect((await b.runs({})).total).toBe(0);
  });
  it("rejects a missing footer instead of reporting success", async () => {
    const path = join(root, "evidence.gz");
    await exportEvidence(a, objectsA, path);
    const lines = gunzipSync(await readFile(path))
      .toString()
      .trim()
      .split("\n");
    lines.pop();
    await writeFile(path, gzipSync(lines.join("\n")));
    await expect(restoreEvidence(b, objectsB, path)).rejects.toThrow("truncated");
  });
});
