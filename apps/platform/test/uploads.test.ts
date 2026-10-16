import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { SqlStateStore } from "../server/state.js";
import { SqlArtifactStore, sha256 } from "../server/artifacts.js";
import { createApi } from "../server/http.js";
import { AuthService } from "../server/auth.js";
import { uploadRun } from "../server/upload-client.js";
import type { RunManifest } from "../../../packages/visualguard/src/core/types.js";

describe("F06 resumable publishing", () => {
  let root: string,
    db: Database,
    repository: Repository,
    state: SqlStateStore,
    store: SqlArtifactStore;
  let server: Server,
    base: string,
    token: string,
    tokenId: string,
    auth: AuthService,
    actor: Parameters<AuthService["mintToken"]>[0];
  let env: NodeJS.ProcessEnv;
  const metadata = { environment: "ci", branch: "feature/example", pullRequest: 42 };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-upload-"));
    db = await openDatabase({ sqlitePath: join(root, "db.sqlite") });
    repository = new Repository(db);
    state = new SqlStateStore(db);
    store = new SqlArtifactStore(db);
    await repository.createProject("storefront", "Storefront");
    await repository.createProject("other", "Other");
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    base = `http://127.0.0.1:${address.port}`;
    env = {
      VISUALGUARD_AUTH_MODE: "login",
      VISUALGUARD_PUBLIC_URL: base,
      VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
      VISUALGUARD_ADMIN_PASSWORD: "upload-test-long-password",
      VERCEL: "1",
    };
    auth = new AuthService(state, env);
    await auth.ready;
    const admin = (await auth.users())[0]!;
    actor = { id: admin.id, name: admin.name, email: admin.email, admin: true, csrf: "" };
    const credential = await auth.mintToken(actor, "storefront", "CI", 1);
    token = credential.token;
    tokenId = credential.id;
    const api = createApi(repository, store, { state, env });
    server.on("request", (request, response) => {
      void api(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      });
    });
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  async function fixture() {
    const runDir = join(root, "run");
    await mkdir(join(runDir, "jobs/home"), { recursive: true });
    const png = Buffer.concat([
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
        "base64",
      ),
      Buffer.alloc(3 * 1024 * 1024 + 5, 42),
    ]);
    await writeFile(join(runDir, "jobs/home/reference.png"), png);
    await writeFile(join(runDir, "jobs/home/candidate.png"), png);
    const capture = {
      image: "jobs/home/reference.png",
      size: { width: 1, height: 1 },
      durationMs: 1,
      attempts: 1,
      health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
    };
    const manifest: RunManifest = {
      schemaVersion: 1,
      id: "ci-run",
      number: 1,
      startedAt: "2026-10-15T10:00:00.000Z",
      durationMs: 10,
      mode: "compare",
      tool: { version: "2.0.0", node: process.versions.node },
      config: {
        baseURL: {},
        viewports: { desktop: { width: 1, height: 1 } },
        ai: { provider: "none" },
        failOn: "review",
      },
      summary: { pass: 1, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [
        {
          id: "home",
          route: "/",
          name: "Home",
          viewport: "desktop",
          status: "pass",
          durationMs: 10,
          urls: { production: "https://example.test", staging: "https://staging.test" },
          captures: {
            production: capture,
            staging: { ...capture, image: "jobs/home/candidate.png" },
          },
          regions: [],
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(join(runDir, "manifest.json"), bytes);
    return { runDir, manifest, bytes, png };
  }
  async function call(path: string, method: string, value?: unknown, binary = false) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": binary ? "application/octet-stream" : "application/json",
      },
      body:
        value === undefined
          ? undefined
          : binary
            ? (value as Buffer<ArrayBuffer>)
            : JSON.stringify(value),
    });
    return { status: response.status, value: await response.json() };
  }
  it("uploads large screenshots in bounded chunks and repeating the command is idempotent", async () => {
    const data = await fixture();
    const result = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    expect(result.status).toBe("pass");
    expect(result.url).toBe(`${base}/runs/${result.id}`);
    const repeated = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    expect(repeated.id).toBe(result.id);
    expect(repeated.duplicate).toBe(true);
    const detail = await repository.getRun(result.id);
    expect(detail.metadata.pullRequest).toBe(42);
    expect((await store.get(detail.artifacts[0]!.hash)).equals(data.png)).toBe(true);
    expect((await repository.runs({})).total).toBe(1);
    expect((await state.list("upload-chunks")).length).toBe(0);
  });
  it("publishes a new entry after deletion instead of returning a stale completed-upload URL", async () => {
    const data = await fixture();
    const original = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    await repository.deleteRun(original.id);
    const republished = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    expect(republished.id).not.toBe(original.id);
    expect((await repository.runs({ project: "storefront" })).total).toBe(1);
    const run = await repository.getRun(republished.id);
    expect((await store.get(run.artifacts[0]!.hash)).equals(data.png)).toBe(true);
  });
  it("recovers a completed file whose shared object was reclaimed before publication", async () => {
    const { bytes, manifest } = await fixture();
    const start = await call("/api/projects/storefront/uploads", "POST", {
      idempotencyKey: "b".repeat(64),
      manifestHash: sha256(bytes),
      manifestSize: bytes.length,
      engineRunId: manifest.id,
      metadata,
    });
    const id = start.value.id,
      descriptor = {
        path: "manifest.json",
        hash: sha256(bytes),
        size: bytes.length,
        mediaType: "application/json",
      };
    const file = await call(`/api/uploads/${id}/files`, "POST", descriptor);
    await call(`/api/uploads/${id}/files/${file.value.id}/chunks/0`, "PUT", bytes, true);
    expect((await call(`/api/uploads/${id}/files/${file.value.id}/complete`, "POST")).status).toBe(
      200,
    );
    await db.query("DELETE FROM vg_object_chunks WHERE hash=?", [descriptor.hash]);
    await db.query("DELETE FROM vg_objects WHERE hash=?", [descriptor.hash]);
    const registered = await call(`/api/uploads/${id}/files`, "POST", descriptor);
    expect(registered.status).toBe(200);
    expect(registered.value.complete).toBe(false);
    await call(`/api/uploads/${id}/files/${file.value.id}/chunks/0`, "PUT", bytes, true);
    expect((await call(`/api/uploads/${id}/files/${file.value.id}/complete`, "POST")).status).toBe(
      200,
    );
    expect((await store.get(descriptor.hash)).equals(bytes)).toBe(true);
  });
  it("never publishes partial evidence and detects tampered chunk content", async () => {
    const { bytes, manifest } = await fixture();
    const start = await call("/api/projects/storefront/uploads", "POST", {
      idempotencyKey: "a".repeat(64),
      manifestHash: sha256(bytes),
      manifestSize: bytes.length,
      engineRunId: manifest.id,
      metadata,
    });
    expect(start.status).toBe(200);
    const id = start.value.id;
    expect((await call(`/api/uploads/${id}/finalize`, "POST")).status).toBe(409);
    expect((await repository.runs({})).total).toBe(0);
    const file = await call(`/api/uploads/${id}/files`, "POST", {
      path: "manifest.json",
      hash: sha256(bytes),
      size: bytes.length,
      mediaType: "application/json",
    });
    expect(
      (
        await call(
          `/api/uploads/${id}/files/${file.value.id}/chunks/0`,
          "PUT",
          Buffer.alloc(bytes.length, 65),
          true,
        )
      ).status,
    ).toBe(200);
    expect((await call(`/api/uploads/${id}/files/${file.value.id}/complete`, "POST")).status).toBe(
      400,
    );
    expect((await repository.runs({})).total).toBe(0);
    expect(
      (await call(`/api/uploads/${id}/files/${file.value.id}/chunks/0`, "PUT", bytes, true)).status,
    ).toBe(409);
  });
  it("rejects wrong-project and revoked credentials", async () => {
    const data = await fixture();
    await expect(
      uploadRun({ server: base, project: "other", runDir: data.runDir, token, metadata }),
    ).rejects.toThrow("does not permit");
    await auth.revokeToken(actor, "storefront", tokenId);
    await expect(
      uploadRun({ server: base, project: "storefront", runDir: data.runDir, token, metadata }),
    ).rejects.toThrow("Sign in");
  });
  it("rejects changed screenshot bytes even if manifest paths and run ID are unchanged", async () => {
    const data = await fixture();
    const first = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    await writeFile(
      join(data.runDir, "jobs/home/candidate.png"),
      Buffer.concat([data.png, Buffer.from("changed")]),
    );
    await expect(
      uploadRun({ server: base, project: "storefront", runDir: data.runDir, token, metadata }),
    ).rejects.toThrow("different evidence");
    expect((await repository.runs({})).total).toBe(1);
    expect((await repository.getRun(first.id)).digest).toBeTruthy();
  });
  it("resumes persisted sessions after replacing the API instance", async () => {
    const data = await fixture();
    const abort = new AbortController();
    await expect(
      uploadRun({
        server: base,
        project: "storefront",
        runDir: data.runDir,
        token,
        metadata,
        signal: abort.signal,
        onProgress: () => abort.abort(),
      }),
    ).rejects.toThrow();
    expect((await repository.runs({})).total).toBe(0);
    const replacement = createApi(repository, store, { state, env });
    server.removeAllListeners("request");
    server.on("request", (request, response) => {
      void replacement(request, response);
    });
    const result = await uploadRun({
      server: base,
      project: "storefront",
      runDir: data.runDir,
      token,
      metadata,
    });
    expect(result.status).toBe("pass");
    expect((await repository.runs({})).total).toBe(1);
  });
});
