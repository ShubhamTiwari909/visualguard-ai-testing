import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, type Database } from "../server/database.js";
import { Repository } from "../server/repository.js";
import { SqlStateStore } from "../server/state.js";
import { SqlArtifactStore, sha256 } from "../server/artifacts.js";
import { createApi } from "../server/http.js";
import { AuthService } from "../server/auth.js";
import { createDashboardProject } from "../server/project-command.js";
import { reviewRun } from "./fixtures/review-run.js";

describe("F02 organization access", () => {
  let root: string, db: Database, server: Server, base: string;
  let repository: Repository, state: SqlStateStore, store: SqlArtifactStore;
  const password = "test-only-password-long";
  let adminCookie: string, adminCsrf: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-auth-"));
    db = await openDatabase({ sqlitePath: join(root, "metadata.sqlite") });
    repository = new Repository(db);
    state = new SqlStateStore(db);
    store = new SqlArtifactStore(db);
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    base = `http://127.0.0.1:${address.port}`;
    const api = createApi(repository, store, {
      state,
      env: {
        VISUALGUARD_AUTH_MODE: "login",
        VISUALGUARD_PUBLIC_URL: base,
        VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
        VISUALGUARD_ADMIN_PASSWORD: password,
      },
    });
    server.on("request", (request, response) => {
      void api(request, response).then((handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      });
    });
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.test", password }),
    });
    expect(response.status).toBe(200);
    adminCookie = response.headers.get("set-cookie")!.split(";")[0]!;
    adminCsrf = (
      await (await fetch(`${base}/api/session`, { headers: { Cookie: adminCookie } })).json()
    ).token;
    await repository.createProject("private-a", "Private A");
    await repository.createProject("private-b", "Private B");
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await db?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const headers = (cookie: string, csrf?: string) => ({
    "Content-Type": "application/json",
    Cookie: cookie,
    ...(csrf ? { "x-visualguard-platform-token": csrf } : {}),
  });

  async function member() {
    const response = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ name: "Reviewer", email: "member@example.test", password }),
    });
    expect(response.status).toBe(201);
    const user = await response.json();
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "member@example.test", password }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const session = await (
      await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })
    ).json();
    return { user, cookie, csrf: session.token };
  }

  it("requires login and never leaks password hashes or bootstrap credentials", async () => {
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    const session = await (await fetch(`${base}/api/session`)).json();
    expect(session.user).toBeNull();
    expect(session.token).toBeUndefined();
    const users = await (
      await fetch(`${base}/api/users`, { headers: { Cookie: adminCookie } })
    ).text();
    expect(users).not.toContain("scrypt$");
    expect(users).not.toContain(password);
    expect(adminCookie).toMatch(/^vg_session=[a-f0-9]{64}$/);
    const handle = adminCookie.slice("vg_session=".length);
    const persisted = await state.list("sessions");
    expect(persisted.some((entry) => entry.id === sha256(handle))).toBe(true);
    expect(JSON.stringify(persisted)).not.toContain(handle);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          headers: { Cookie: `vg_session=${sha256(handle)}` },
        })
      ).status,
    ).toBe(401);
    const stored = await state.list<{ passwordHash: string }>("users");
    expect(stored[0]?.value.passwordHash).toMatch(/^scrypt\$/);
  });
  it("isolates reviews, requires reviewer role and CSRF, and excludes upload credentials", async () => {
    const person = await member();
    const input = reviewRun();
    input.projectId = "private-a";
    const { id: _id, ...document } = input;
    const { run } = await repository.insertRun(document);
    const endpoint = `${base}/api/runs/${run.id}/reviews`;
    const threadUrl = `${endpoint}?job=checkout__desktop`;
    expect((await fetch(threadUrl)).status).toBe(401);
    expect((await fetch(threadUrl, { headers: { Cookie: person.cookie } })).status).toBe(403);
    const setRole = async (role: string | null) => {
      const response = await fetch(`${base}/api/projects/private-a/members`, {
        method: "POST", headers: headers(adminCookie, adminCsrf),
        body: JSON.stringify({ userId: person.user.id, role }),
      });
      expect(response.status).toBe(200);
    };
    await setRole("viewer");
    const viewer = await (await fetch(threadUrl, { headers: { Cookie: person.cookie } })).json();
    expect(viewer.canReview).toBe(false);
    const payload = { jobId: viewer.jobId, evidenceDigest: viewer.evidenceDigest,
      scopeDigest: viewer.scopeDigest, expectedVersion: 0,
      event: { action: "comment", reason: "Check the checkout action" } };
    const post = (cookie: string, csrf?: string) => fetch(endpoint, {
      method: "POST", headers: headers(cookie, csrf), body: JSON.stringify(payload),
    });
    expect((await post(person.cookie, person.csrf)).status).toBe(403);
    await setRole("reviewer");
    expect((await post(person.cookie)).status).toBe(403);
    expect((await fetch(endpoint, { method: "POST", headers: { ...headers(person.cookie, person.csrf), Origin: "https://attacker.test" }, body: JSON.stringify(payload) })).status).toBe(403);
    const saved = await post(person.cookie, person.csrf);
    expect(saved.status).toBe(200);
    expect((await saved.json()).events[0].actor.id).toBe(person.user.id);
    expect((await post(person.cookie, person.csrf)).status).toBe(409);
    const people = await (await fetch(`${base}/api/projects/private-a/reviewers`, { headers: { Cookie: person.cookie } })).json();
    expect(people.reviewers.some((item: { id: string }) => item.id === person.user.id)).toBe(true);
    expect(JSON.stringify(people)).not.toContain("scrypt$");
    expect(JSON.stringify(people)).not.toContain("member@example.test");
    expect((await fetch(`${base}/api/reviews?project=private-b`, { headers: { Cookie: person.cookie } })).status).toBe(403);
    const token = await (await fetch(`${base}/api/projects/private-a/tokens`, {
      method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ name: "Reviews must be denied", days: 1 }),
    })).json();
    const upload = { Authorization: `Bearer ${token.token}` };
    expect((await fetch(threadUrl, { headers: upload })).status).toBe(403);
    expect((await fetch(endpoint, { method: "POST", headers: { ...upload, "Content-Type": "application/json" }, body: JSON.stringify(payload) })).status).toBe(403);
    await setRole(null);
    expect((await fetch(threadUrl, { headers: { Cookie: person.cookie } })).status).toBe(403);
  });
  it("creates a project from a temporary CLI administrator session and safely reuses existing IDs", async () => {
    const env = {
      VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
      VISUALGUARD_ADMIN_PASSWORD: password,
    };
    const before = (await state.list("sessions")).length;
    const created = await createDashboardProject({
      id: "cli-project",
      name: "CLI Project",
      server: base,
      env,
    });
    expect(created.created).toBe(true);
    expect(created.project.name).toBe("CLI Project");
    const repeated = await createDashboardProject({
      id: "cli-project",
      name: "Should not rename",
      server: base,
      env,
    });
    expect(repeated.created).toBe(false);
    expect(repeated.project.name).toBe("CLI Project");
    expect((await state.list("sessions")).length).toBe(before);
    const events = (
      await state.list<{ action: string; details: { projectId?: string } }>("audit")
    ).filter(
      (row) =>
        row.value.action === "project.created" && row.value.details.projectId === "cli-project",
    );
    expect(events).toHaveLength(1);
  });
  it("does not let project upload tokens create projects through the CLI", async () => {
    const credential = await (
      await fetch(`${base}/api/projects/private-a/tokens`, {
        method: "POST",
        headers: headers(adminCookie, adminCsrf),
        body: JSON.stringify({ name: "CI", days: 1 }),
      })
    ).json();
    await expect(
      createDashboardProject({
        id: "forbidden-project",
        server: base,
        env: { VISUALGUARD_UPLOAD_TOKEN: credential.token },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await repository.projects(["forbidden-project"])).toEqual([]);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${credential.token}`,
          },
          body: JSON.stringify({ id: "forbidden-project", name: "Forbidden" }),
        })
      ).status,
    ).toBe(403);
  });
  it("limits a member to explicitly assigned projects, including filters", async () => {
    const person = await member();
    expect(
      (await (await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })).json())
        .projects,
    ).toEqual([]);
    const assign = await fetch(`${base}/api/projects/private-a/members`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ userId: person.user.id, role: "viewer" }),
    });
    expect(assign.status).toBe(200);
    const list = await (
      await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })
    ).json();
    expect(list.projects.map((project: { id: string }) => project.id)).toEqual(["private-a"]);
    expect(
      (
        await fetch(`${base}/api/projects/private-b/members`, {
          headers: { Cookie: person.cookie },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          method: "POST",
          headers: headers(person.cookie, person.csrf),
          body: JSON.stringify({ id: "other", name: "Other" }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await (
          await fetch(`${base}/api/runs?project=private-b`, { headers: { Cookie: person.cookie } })
        ).json()
      ).total,
    ).toBe(0);
  });
  it("protects run details and artifact bytes from a member without project access", async () => {
    const person = await member();
    const hash = await store.put(Buffer.from('{"private":true}'));
    const manifest = {
      schemaVersion: 1,
      id: "private-run",
      number: 1,
      startedAt: "2026-10-15T10:00:00.000Z",
      durationMs: 0,
      mode: "compare",
      tool: { version: "2.0.0" },
      config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
      summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [],
    } as import("../../../packages/visualguard/src/core/types.js").RunManifest;
    const result = await repository.insertRun({
      envelopeVersion: 1,
      projectId: "private-b",
      engineRunId: manifest.id,
      number: 1,
      startedAt: manifest.startedAt,
      importedAt: manifest.startedAt,
      durationMs: 0,
      mode: "compare",
      status: "incomplete",
      complete: false,
      completenessReasons: ["No checks"],
      summary: manifest.summary,
      metadata: { environment: "private" },
      digest: "a".repeat(64),
      jobCount: 0,
      manifest,
      artifacts: [{ path: "private.json", hash, size: 16, mediaType: "application/json" }],
    });
    expect(
      (await fetch(`${base}/api/runs/${result.run.id}`, { headers: { Cookie: person.cookie } }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/runs/${result.run.id}/artifacts/private.json`, {
          headers: { Cookie: person.cookie },
        })
      ).status,
    ).toBe(403);
  });
  it("protects mutations, rejects cross-origin calls, and revokes logged-out sessions", async () => {
    expect(
      (await fetch(`${base}/api/auth/logout`, { method: "POST", headers: headers(adminCookie) }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: { ...headers(adminCookie, adminCsrf), Origin: "https://attacker.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/auth/logout`, {
          method: "POST",
          headers: headers(adminCookie, adminCsrf),
        })
      ).status,
    ).toBe(200);
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: adminCookie } })).status).toBe(
      401,
    );
  });
  it("invalidates existing sessions when an account is disabled", async () => {
    const person = await member();
    expect(
      (
        await fetch(`${base}/api/users/${person.user.id}`, {
          method: "PATCH",
          headers: headers(adminCookie, adminCsrf),
          body: JSON.stringify({ disabled: true, currentPassword: password, expectedVersion: (await state.get("users", person.user.id))!.version }),
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/api/projects`, { headers: { Cookie: person.cookie } })).status,
    ).toBe(401);
  });
  it("supports password rotation and revokes the previous browser session", async () => {
    const response = await fetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ current: password, password: "rotated-test-password-long" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: adminCookie } })).status).toBe(
      401,
    );
    const next = response.headers.get("set-cookie")!.split(";")[0]!;
    expect((await fetch(`${base}/api/projects`, { headers: { Cookie: next } })).status).toBe(200);
  });
  it("issues hashed project upload credentials and revokes them immediately", async () => {
    const response = await fetch(`${base}/api/projects/private-a/tokens`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ name: "CI", days: 1 }),
    });
    expect(response.status).toBe(201);
    const credential = await response.json();
    expect(credential.token).toMatch(/^vg_upload_/);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          headers: { Authorization: `Bearer ${credential.token}` },
        })
      ).status,
    ).toBe(403);
    expect(JSON.stringify(await state.list("tokens"))).not.toContain(credential.token);
    expect(
      (
        await fetch(`${base}/api/projects/private-a/tokens/${credential.id}`, {
          method: "DELETE",
          headers: headers(adminCookie, adminCsrf),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/projects`, {
          headers: { Authorization: `Bearer ${credential.token}` },
        })
      ).status,
    ).toBe(401);
  });
  it("edits project labels through aliases while preserving roles and upload tokens", async () => {
    const person = await member();
    const credential = await (await fetch(`${base}/api/projects/private-a/tokens`, {
      method: "POST", headers: headers(adminCookie, adminCsrf), body: JSON.stringify({ name: "Before rename", days: 1 }),
    })).json();
    const payload = { name: "Friendly project", publicId: "friendly-a", expectedVersion: 0 };
    const rename = (cookie: string, csrf?: string) => fetch(`${base}/api/projects/private-a`, {
      method: "PATCH", headers: headers(cookie, csrf), body: JSON.stringify(payload),
    });
    for (const role of ["viewer", "reviewer", "maintainer"]) {
      await fetch(`${base}/api/projects/private-a/members`, { method: "POST", headers: headers(adminCookie, adminCsrf),
        body: JSON.stringify({ userId: person.user.id, role }) });
      expect((await rename(person.cookie, person.csrf)).status).toBe(role === "maintainer" ? 200 : 403);
    }
    expect((await rename(person.cookie)).status).toBe(403);
    expect((await rename(person.cookie, person.csrf)).status).toBe(409);
    expect((await fetch(`${base}/api/projects/friendly-a/members`, { headers: { Cookie: person.cookie } })).status).toBe(200);
    const lookup = await fetch(`${base}/api/publishing/project?project=friendly-a`, { headers: { Authorization: `Bearer ${credential.token}` } });
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ id: "private-a", name: "Friendly project", publicId: "friendly-a" });
    expect((await fetch(`${base}/api/projects/friendly-a`, { method: "PATCH", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${credential.token}`,
    }, body: JSON.stringify({ ...payload, expectedVersion: 1 }) })).status).toBe(403);
    const cli = await createDashboardProject({ id: "friendly-a", name: "Ignored", server: base, env: {
      VISUALGUARD_ADMIN_EMAIL: "admin@example.test", VISUALGUARD_ADMIN_PASSWORD: password,
    } });
    expect(cli.created).toBe(false);
    expect(cli.project.id).toBe("private-a");
    expect(cli.project.name).toBe("Friendly project");
    expect((await repository.projects(["private-b"]))[0]?.name).toBe("Private B");
  });
  it("keeps session state across API instances", async () => {
    const auth = new AuthService(state, {
      VISUALGUARD_AUTH_MODE: "login",
      VISUALGUARD_PUBLIC_URL: base,
    });
    await auth.ready;
    const request = { headers: { cookie: adminCookie } } as Parameters<AuthService["actor"]>[0];
    expect((await auth.actor(request))?.admin).toBe(true);
  });
  it("does not allow local authentication on a publicly exposed origin", () => {
    expect(
      () =>
        new AuthService(state, {
          VISUALGUARD_AUTH_MODE: "local",
          VISUALGUARD_PUBLIC_URL: "https://dashboard.example.test",
        }),
    ).toThrow("cannot be exposed");
  });
  it("requires maintainer access, CSRF and exact confirmation to delete projects", async () => {
    const person = await member();
    await fetch(`${base}/api/projects/private-a/members`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ userId: person.user.id, role: "viewer" }),
    });
    const payload = JSON.stringify({ confirmation: "private-a", expectedRuns: 0 });
    expect(
      (
        await fetch(`${base}/api/projects/private-a`, {
          method: "DELETE",
          headers: headers(person.cookie, person.csrf),
          body: payload,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/projects/private-a`, {
          method: "DELETE",
          headers: headers(adminCookie),
          body: payload,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/projects/private-a`, {
          method: "DELETE",
          headers: headers(adminCookie, adminCsrf),
          body: JSON.stringify({ confirmation: "wrong-project", expectedRuns: 0 }),
        })
      ).status,
    ).toBe(400);
    await fetch(`${base}/api/projects/private-a/members`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ userId: person.user.id, role: "maintainer" }),
    });
    expect(
      (
        await fetch(`${base}/api/projects/private-a`, {
          method: "DELETE",
          headers: headers(person.cookie, person.csrf),
          body: payload,
        })
      ).status,
    ).toBe(200);
    expect(await repository.projects(["private-a"])).toEqual([]);
    expect(await repository.projects(["private-b"])).toHaveLength(1);
    const events = (await state.list<{ action: string }>("audit")).map((row) => row.value.action);
    expect(events).toContain("project.deleted");
  });
  it("denies upload credentials permission to delete projects", async () => {
    const minted = await fetch(`${base}/api/projects/private-a/tokens`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ name: "CI", days: 1 }),
    });
    const credential = await minted.json();
    const request = {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.token}` },
      body: JSON.stringify({ confirmation: "private-a", expectedRuns: 0 }),
    };
    expect((await fetch(`${base}/api/projects/private-a`, request)).status).toBe(403);
    expect(
      (
        await fetch(`${base}/api/projects/private-a`, {
          ...request,
          headers: headers(adminCookie, adminCsrf),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${base}/api/session`, {
          headers: { Authorization: `Bearer ${credential.token}` },
        }).then((response) => response.json())
      ).user,
    ).toBeNull();
    expect(await state.list("tokens")).toEqual([]);
  });
  it("resolves a publishing project without exposing other projects to an upload token", async () => {
    const response = await fetch(`${base}/api/projects/private-a/tokens`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ name: "Project binding", days: 1 }),
    });
    const credential = await response.json(),
      uploadHeaders = { Authorization: `Bearer ${credential.token}` };
    const allowed = await fetch(`${base}/api/publishing/project?project=Private+A`, {
      headers: uploadHeaders,
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ id: "private-a", name: "Private A" });
    expect(
      (await fetch(`${base}/api/publishing/project?project=private-b`, { headers: uploadHeaders }))
        .status,
    ).toBe(404);
    expect((await fetch(`${base}/api/projects`, { headers: uploadHeaders })).status).toBe(403);
    const person = await member();
    await fetch(`${base}/api/projects/private-a/members`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ userId: person.user.id, role: "viewer" }),
    });
    expect(
      (
        await fetch(`${base}/api/publishing/project?project=private-a`, {
          headers: { Cookie: person.cookie },
        })
      ).status,
    ).toBe(404);
    await fetch(`${base}/api/projects/private-a/members`, {
      method: "POST",
      headers: headers(adminCookie, adminCsrf),
      body: JSON.stringify({ userId: person.user.id, role: "maintainer" }),
    });
    expect(
      (
        await fetch(`${base}/api/publishing/project?project=private-a`, {
          headers: { Cookie: person.cookie },
        })
      ).status,
    ).toBe(200);
  });
  it("allows maintainers to delete a run while denying reviewers and preserving the project", async () => {
    const person = await member();
    const hash = await store.put(Buffer.from('{"deletable":true}'));
    const manifest = {
      schemaVersion: 1,
      id: "deletion-api",
      number: 1,
      startedAt: "2026-10-15T10:00:00.000Z",
      durationMs: 0,
      mode: "compare",
      tool: { version: "2.0.0" },
      config: { baseURL: {}, viewports: {}, ai: { provider: "none" }, failOn: "regression" },
      summary: { pass: 0, accepted: 0, review: 0, regression: 0, error: 0 },
      jobs: [],
    } as import("../shared/contracts.js").RunDetail["manifest"];
    const { run } = await repository.insertRun({
      envelopeVersion: 1,
      projectId: "private-a",
      engineRunId: manifest.id,
      number: 1,
      startedAt: manifest.startedAt,
      importedAt: manifest.startedAt,
      durationMs: 0,
      mode: "compare",
      status: "incomplete",
      complete: false,
      completenessReasons: ["No checks"],
      summary: manifest.summary,
      metadata: { environment: "deletion" },
      digest: "d".repeat(64),
      jobCount: 0,
      manifest,
      artifacts: [{ path: "evidence.json", hash, size: 18, mediaType: "application/json" }],
    });
    const role = async (role: string) =>
      fetch(`${base}/api/projects/private-a/members`, {
        method: "POST",
        headers: headers(adminCookie, adminCsrf),
        body: JSON.stringify({ userId: person.user.id, role }),
      });
    const remove = (confirmation = run.id) =>
      fetch(`${base}/api/runs/${run.id}`, {
        method: "DELETE",
        headers: headers(person.cookie, person.csrf),
        body: JSON.stringify({ confirmation }),
      });
    await role("reviewer");
    const rename = (csrf?: string, expectedVersion = 0, name = "Renamed run") => fetch(`${base}/api/runs/${run.id}`, {
      method: "PATCH", headers: headers(person.cookie, csrf),
      body: JSON.stringify({ name, expectedVersion }),
    });
    expect((await rename(person.csrf)).status).toBe(403);
    expect((await remove()).status).toBe(403);
    await role("maintainer");
    expect((await rename()).status).toBe(403);
    expect((await rename(person.csrf)).status).toBe(200);
    expect((await repository.getRun(run.id)).name).toBe("Renamed run");
    expect((await rename(person.csrf)).status).toBe(409);
    expect((await rename(person.csrf, 1, `  ${"n".repeat(120)}  `)).status).toBe(200);
    expect((await repository.getRun(run.id)).name).toBe("n".repeat(120));
    expect((await rename(person.csrf, 2, "n".repeat(121))).status).toBe(400);
    expect((await remove("wrong-run")).status).toBe(400);
    expect((await repository.getRun(run.id)).digest).toBe("d".repeat(64));
    expect((await remove()).status).toBe(200);
    expect(
      (await fetch(`${base}/api/runs/${run.id}`, { headers: { Cookie: adminCookie } })).status,
    ).toBe(404);
    expect((await repository.projects(["private-a"]))[0]?.runCount).toBe(0);
    await expect(store.get(hash)).rejects.toThrow("not found");
  });
});
