import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { RunManifest, Status } from "../../../packages/visualguard/src/core/types.js";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { FileArtifactStore, sha256 } from "../server/artifacts.js";
import { importRun } from "../server/ingest.js";
import { createApi } from "../server/http.js";
import { parseManifest } from "../server/validation.js";
import { reportManifest } from "../client/api.js";
import type { RunMetadata } from "../shared/contracts.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
  "base64",
);

function fixture(id = "run-1", status: Status = "pass"): RunManifest {
  const capture = {
    image: "jobs/home/reference.png",
    dom: "jobs/home/reference.dom.json",
    size: { width: 1440, height: 900 },
    durationMs: 12,
    attempts: 1,
    health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
  };
  return {
    schemaVersion: 1,
    id,
    number: Number(id.match(/\d+$/)?.[0] ?? 1),
    startedAt: "2026-10-15T10:00:00.000Z",
    durationMs: 100,
    mode: "compare",
    provenance: {
      group: "group-1",
      fingerprint: "config-1",
      sourceRevision: "abc123",
      expectedJobs: ["home-desktop"],
    },
    tool: { version: "2.0.0" },
    config: {
      baseURL: { production: "https://example.test", staging: "https://staging.test" },
      viewports: { desktop: { width: 1440, height: 900 } },
      ai: { provider: "none" },
      failOn: "regression",
    },
    summary: {
      pass: status === "pass" ? 1 : 0,
      accepted: status === "accepted" ? 1 : 0,
      regression: status === "regression" ? 1 : 0,
      review: status === "review" ? 1 : 0,
      error: status === "error" ? 1 : 0,
    },
    jobs: [
      {
        id: "home-desktop",
        name: "Homepage",
        route: "/",
        viewport: "desktop",
        status,
        durationMs: 100,
        urls: { production: "https://example.test", staging: "https://staging.test" },
        captures: {
          production: capture,
          staging: { ...capture, image: "jobs/home/candidate.png" },
        },
        diff: {
          width: 1440,
          height: 900,
          diffPixels: 0,
          diffRatio: 0,
          image: "jobs/home/diff.png",
        },
        regions: [],
        findings: [{ source: "heuristic", severity: "info", message: "Identical" }],
      },
    ],
  };
}

describe("F01 shared evidence history", () => {
  let root: string;
  let database: Database;
  let repository: Repository;
  let store: FileArtifactStore;
  let server: Server | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "visualguard-platform-"));
    database = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
    store = new FileArtifactStore(join(root, "objects"));
    repository = new Repository(database, store);
    await repository.createProject("storefront", "Storefront");
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
      server = undefined;
    }
    await database.close();
    await rm(root, { recursive: true, force: true });
  });

  async function writeRun(manifest = fixture()) {
    const dir = join(root, manifest.id);
    await mkdir(join(dir, "jobs/home"), { recursive: true });
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    for (const name of ["reference.png", "candidate.png", "diff.png"])
      await writeFile(join(dir, "jobs/home", name), PNG);
    await writeFile(
      join(dir, "jobs/home/reference.dom.json"),
      JSON.stringify({ elements: [{ text: "Evidence" }] }),
    );
    await writeFile(
      join(dir, "index.html"),
      "<script>throw new Error('uploaded HTML must never execute')</script>",
    );
    return dir;
  }
  async function ingest(manifest = fixture(), metadata: RunMetadata = { environment: "staging" }) {
    return importRun(repository, store, {
      projectId: "storefront",
      runDir: await writeRun(manifest),
      metadata,
    });
  }
  async function serve() {
    const api = createApi(repository, store);
    server = createServer((request, response) => {
      void api(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test listener");
    return `http://127.0.0.1:${address.port}`;
  }

  it("imports 20 representative runs with indexed history, correct counts and complete evidence", async () => {
    const statuses: Status[] = ["pass", "accepted", "review", "regression", "error"];
    for (let index = 1; index <= 20; index++)
      await ingest(fixture(`run-${index}`, statuses[index % statuses.length]!));
    const page = await repository.runs({ limit: 7 });
    expect(page.total).toBe(20);
    expect(page.runs).toHaveLength(7);
    expect(page.runs[0]).not.toHaveProperty("manifest");
    expect((await repository.projects())[0]?.runCount).toBe(20);
    expect((await repository.runs({ status: "regression" })).total).toBe(4);
    const detail = await repository.getRun(page.runs[0]!.id);
    expect(detail.artifacts).toHaveLength(4);
    expect(detail.artifacts.some((artifact) => artifact.path === "index.html")).toBe(false);
    for (const artifact of detail.artifacts)
      expect(sha256(await store.get(artifact.hash))).toBe(artifact.hash);
  });
  it("keeps an optional dashboard run name searchable without changing engine evidence", async () => {
    const manifest = fixture("named-run-1");
    const result = await ingest(manifest, { environment: "staging", runName: "Checkout release smoke" });
    expect(result.run.name).toBe("Checkout release smoke");
    expect(result.run.manifest).toEqual(manifest);
    expect((await repository.runs({ q: "release smoke" })).total).toBe(1);
    const repeated = await importRun(repository, store, { projectId: "storefront",
      runDir: join(root, manifest.id), metadata: { environment: "staging", runName: "Checkout release smoke" } });
    expect(repeated.duplicate).toBe(true);
    expect(repeated.run.name).toBe(result.run.name);
  });
  it("renames a run independently of its evidence and rejects stale edits", async () => {
    const original = (await ingest(fixture("rename-run-1"), { environment: "staging", runName: "Initial label" })).run;
    const renamed = await repository.renameRun(original.id, "  Release smoke  ", 0);
    expect(renamed.name).toBe("Release smoke");
    expect(renamed.nameVersion).toBe(1);
    expect(renamed.digest).toBe(original.digest);
    expect(renamed.manifest).toEqual(original.manifest);
    expect(renamed.metadata).toEqual(original.metadata);
    expect((await repository.runs({ q: "release smoke" })).total).toBe(1);
    expect((await repository.runs({ q: "initial label" })).total).toBe(0);
    await expect(repository.renameRun(original.id, "Stale change", 0)).rejects.toMatchObject({ status: 409 });
    const cleared = await repository.renameRun(original.id, "", 1);
    expect(cleared.name).toBeUndefined();
    expect(cleared.nameVersion).toBe(2);
    expect((await repository.getRun(original.id)).digest).toBe(original.digest);
  });

  it("deduplicates identical imports including concurrent attempts", async () => {
    const runDir = await writeRun();
    const input = { projectId: "storefront", runDir, metadata: { environment: "staging" } };
    const results = await Promise.all([
      importRun(repository, store, input),
      importRun(repository, store, input),
    ]);
    expect(results[0].run.id).toBe(results[1].run.id);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect((await repository.runs({})).total).toBe(1);
  });

  it("rejects changed evidence or metadata for an existing engine run ID", async () => {
    const original = await ingest();
    await expect(ingest(fixture(), { environment: "production" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(ingest(fixture("run-1", "regression"))).rejects.toMatchObject({ status: 409 });
    expect((await repository.getRun(original.run.id)).status).toBe("pass");
  });

  it("keeps the same engine run ID isolated across projects", async () => {
    const { run } = await ingest();
    await repository.createProject("admin", "Admin");
    await importRun(repository, store, {
      projectId: "admin",
      runDir: await writeRun(),
      metadata: { environment: "internal" },
    });
    expect((await repository.runs({ project: "storefront" })).runs[0]?.id).toBe(run.id);
    expect((await repository.runs({ project: "admin" })).total).toBe(1);
  });

  it("does not publish runs with missing artifacts", async () => {
    const runDir = await writeRun();
    await rm(join(runDir, "jobs/home/candidate.png"));
    await expect(
      importRun(repository, store, {
        projectId: "storefront",
        runDir,
        metadata: { environment: "staging" },
      }),
    ).rejects.toThrow();
    expect((await repository.runs({})).total).toBe(0);
  });

  it.each([
    "../outside.png",
    "/tmp/outside.png",
    "jobs\\outside.png",
    "https://example.test/leak.png",
  ])("rejects unsafe artifact path %s", async (path) => {
    const manifest = fixture();
    manifest.jobs[0]!.captures.staging!.image = path;
    await expect(ingest(manifest)).rejects.toMatchObject({ status: 400 });
    expect((await repository.runs({})).total).toBe(0);
  });

  it("rejects symlinks escaping the run directory", async () => {
    const runDir = await writeRun();
    const outside = join(root, "outside.png");
    await writeFile(outside, PNG);
    await rm(join(runDir, "jobs/home/candidate.png"));
    await symlink(outside, join(runDir, "jobs/home/candidate.png"));
    await expect(
      importRun(repository, store, {
        projectId: "storefront",
        runDir,
        metadata: { environment: "staging" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("detects stored object corruption instead of serving altered evidence", async () => {
    const { run } = await ingest();
    const hash = run.artifacts[0]!.hash;
    await writeFile(join(root, "objects", hash.slice(0, 2), hash), "altered");
    await expect(store.get(hash)).rejects.toThrow("checksum mismatch");
  });

  it.each(["engine", "missing", "shard", "empty", "capture"])(
    "marks %s partial coverage as incomplete",
    async (reason) => {
      const manifest = fixture();
      if (reason === "engine") manifest.incomplete = true;
      if (reason === "missing") manifest.provenance!.expectedJobs.push("checkout-mobile");
      if (reason === "shard") manifest.shard = { index: 1, total: 2 };
      if (reason === "empty") manifest.jobs = [];
      if (reason === "capture") delete manifest.jobs[0]!.captures.production;
      const { run } = await ingest(manifest);
      expect(run.status).toBe("incomplete");
      expect(run.complete).toBe(false);
      expect(run.completenessReasons.length).toBeGreaterThan(0);
    },
  );

  it("recomputes summary from actual checks rather than trusting a green supplied summary", async () => {
    const manifest = fixture("run-1", "regression");
    manifest.summary = { pass: 100, accepted: 0, review: 0, regression: 0, error: 0 };
    const { run } = await ingest(manifest);
    expect(run.status).toBe("regression");
    expect(run.summary.regression).toBe(1);
    expect(run.summary.pass).toBe(0);
    expect(run.manifest.summary).toEqual(manifest.summary);
  });

  it("rejects unknown versions, malformed evidence, and duplicate check IDs", async () => {
    expect(() => parseManifest({ ...fixture(), schemaVersion: 2 })).toThrow("Unsupported");
    const manifest = fixture();
    manifest.jobs.push(manifest.jobs[0]!);
    expect(() => parseManifest(manifest)).toThrow("duplicate job");
    const broken = fixture();
    (
      broken.jobs[0]!.captures.staging!.health as unknown as Record<string, unknown>
    ).failedRequests = null;
    await expect(ingest(broken)).rejects.toMatchObject({ status: 400 });
  });

  it("preserves future additive fields and evidence across database restarts", async () => {
    const manifest = { ...fixture(), futureEvidence: { preserved: true } };
    const { run } = await ingest(manifest);
    await database.close();
    database = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
    repository = new Repository(database, store);
    expect((await repository.getRun(run.id)).manifest).toEqual(manifest);
  });

  it("filters by exact metadata, literal search, UTC dates, and stable pagination", async () => {
    await importRun(repository, store, {
      projectId: "storefront",
      runDir: await writeRun(),
      metadata: {
        environment: "staging",
        branch: "feature/header",
        commit: "abc123",
        pullRequest: 42,
        deployment: "preview-42",
      },
    });
    expect(
      (
        await repository.runs({
          project: "storefront",
          branch: "feature/header",
          pullRequest: 42,
          deployment: "preview-42",
          commit: "abc123",
          environment: "staging",
          q: "homepage",
        })
      ).total,
    ).toBe(1);
    expect((await repository.runs({ q: "%" })).total).toBe(0);
    expect((await repository.runs({ q: "' OR 1=1 --" })).total).toBe(0);
    expect((await repository.runs({ offset: 10 })).total).toBe(1);
    expect((await repository.runs({ offset: 10 })).runs).toEqual([]);
  });

  it("reuses the viewer through copied artifact URLs without rewriting source evidence", async () => {
    const { run } = await ingest();
    const mapped = reportManifest(run);
    expect(mapped.jobs[0]!.captures.staging!.image).toBe(
      `/api/runs/${run.id}/artifacts/jobs/home/candidate.png`,
    );
    expect(run.manifest.jobs[0]!.captures.staging!.image).toBe("jobs/home/candidate.png");
    expect((await repository.getRun(run.id)).manifest).toEqual(run.manifest);
  });

  it("serves stable run, screenshot, DOM, and filtered history APIs", async () => {
    const { run } = await ingest();
    const base = await serve();
    expect((await (await fetch(`${base}/api/runs/${run.id}`)).json()).digest).toBe(run.digest);
    const image = await fetch(`${base}/api/runs/${run.id}/artifacts/jobs/home/candidate.png`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(PNG);
    const dom = await fetch(`${base}/api/runs/${run.id}/artifacts/jobs/home/reference.dom.json`);
    expect((await dom.json()).elements[0].text).toBe("Evidence");
    expect(
      (await (await fetch(`${base}/api/runs?from=2026-10-15&to=2026-10-15`)).json()).total,
    ).toBe(1);
    expect((await fetch(`${base}/api/runs/${run.id}/artifacts/index.html`)).status).toBe(404);
    expect((await fetch(`${base}/api/runs?limit=0`)).status).toBe(400);
    expect((await fetch(`${base}/api/runs?status=green`)).status).toBe(400);
    expect((await fetch(`${base}/api/runs?from=2026-10-16&to=2026-10-15`)).status).toBe(400);
    expect((await fetch(`${base}/api/runs/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
  });

  it("requires a local action token and rejects cross-origin mutations", async () => {
    const base = await serve();
    const payload = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "admin", name: "Admin" }),
    };
    expect((await fetch(`${base}/api/projects`, payload)).status).toBe(403);
    const { token } = await (await fetch(`${base}/api/session`)).json();
    expect(
      (
        await fetch(`${base}/api/projects`, {
          ...payload,
          headers: {
            ...payload.headers,
            "x-visualguard-platform-token": token,
            Origin: "https://untrusted.test",
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          ...payload,
          headers: { ...payload.headers, "x-visualguard-platform-token": token },
        })
      ).status,
    ).toBe(201);
    expect((await repository.projects()).map((project) => project.id)).toContain("admin");
    const before = await readFile(join(root, "metadata.sqlite"));
    expect(before.length).toBeGreaterThan(0);
  });
});
