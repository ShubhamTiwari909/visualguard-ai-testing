import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/http.js";
import { openPlatform } from "../server/config.js";
import { pullApprovedBaseline } from "../server/baseline-command.js";
import { baselineRun } from "./fixtures/baseline-run.js";
import {
  assertBaselineCompatible,
  assertBaselineWritable,
  approvedBaselineReference,
} from "../../../packages/visualguard/src/core/provenance.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=",
  "base64",
);
describe("approved baseline HTTP and immutable local pull", () => {
  let platform: Awaited<ReturnType<typeof openPlatform>>,
    server: Server,
    root: string,
    base: string;
  let admin: { cookie: string; token: string }, viewer: typeof admin;
  let run: ReturnType<typeof baselineRun>;
  const password = "baseline-test-only-password";
  const request = async (path: string, data?: unknown, actor = admin, bearer?: string) => {
    const response = await fetch(`${base}${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(bearer
          ? { Authorization: `Bearer ${bearer}` }
          : actor
            ? { Cookie: actor.cookie, "x-visualguard-platform-token": actor.token }
            : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      response,
      value: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()),
    };
  };
  const login = async (email: string) => {
    const { response } = await request("/api/auth/login", { email, password }, undefined);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    return {
      cookie,
      token: (await request("/api/session", undefined, { cookie, token: "" })).value
        .token as string,
    };
  };
  const promote = (expectedVersion = 0) => ({
    expectedVersion,
    runId: run.id,
    evidenceDigest: run.digest,
    sourceRevision: run.metadata.commit,
    targetRevision: "b".repeat(40),
    landed: true,
    reason: "Change landed",
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-baseline-http-"));
    platform = await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: root });
    await platform.repository.createProject("storefront", "Storefront");
    run = baselineRun();
    for (const item of run.artifacts) {
      const bytes = item.path === "candidate.png" ? png : Buffer.concat([png, Buffer.from("old")]);
      item.hash = await platform.store.put(bytes);
      item.size = bytes.length;
    }
    run = (await platform.repository.insertRun(run)).run;
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const api = createApi(platform.repository, platform.store, {
      state: platform.state,
      env: {
        VISUALGUARD_AUTH_MODE: "login",
        VISUALGUARD_PUBLIC_URL: base,
        VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
        VISUALGUARD_ADMIN_PASSWORD: password,
      },
    });
    await api.ready;
    server.on("request", (req, res) => {
      void api(req, res);
    });
    admin = await login("admin@example.test");
    const user = (
      await request("/api/users", { name: "Viewer", email: "viewer@example.test", password })
    ).value;
    await platform.state.create("memberships", `${user.id}:storefront`, {
      userId: user.id,
      projectId: "storefront",
      role: "viewer",
    });
    viewer = await login("viewer@example.test");
    for (const job of run.manifest.jobs) {
      const view = (await request(`/api/runs/${run.id}/reviews?job=${job.id}`)).value;
      expect(
        (
          await request(`/api/runs/${run.id}/reviews`, {
            jobId: job.id,
            evidenceDigest: view.evidenceDigest,
            scopeDigest: view.scopeDigest,
            expectedVersion: view.version,
            event: { action: "approve_visual_change", reason: "Reviewed pixels" },
          })
        ).response.status,
      ).toBe(200);
    }
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await platform?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("enforces browser roles, CSRF, and scoped read-only upload credentials", async () => {
    const path = "/api/projects/storefront/baselines/main";
    expect((await fetch(base + path)).status).toBe(401);
    expect((await request(path + "/promote", promote(), viewer)).response.status).toBe(403);
    expect(
      (await request(path + "/promote", promote(), { ...admin, token: "" })).response.status,
    ).toBe(403);
    expect((await request(path + "/promote", promote())).response.status).toBe(201);
    const history = await request(path + "/history", undefined, viewer);
    expect(history.response.status).toBe(200);
    expect(history.value.canPromote).toBe(false);
    expect(history.response.headers.get("cache-control")).toBe("no-store");
    const token = (
      await request("/api/projects/storefront/tokens", { name: "CI baseline read", days: 1 })
    ).value.token;
    expect(typeof token).toBe("string");
    expect((await request(path, undefined, undefined, token)).response.status).toBe(200);
    expect((await request(path + "/promote", promote(), undefined, token)).response.status).toBe(
      403,
    );
    expect((await request("/api/runs", undefined, undefined, token)).response.status).toBe(403);
    expect(
      (await request("/api/projects/other/baselines/main", undefined, undefined, token)).response
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          `${path}/artifacts/${"f".repeat(64)}?version=1&chunk=0`,
          undefined,
          undefined,
          token,
        )
      ).response.status,
    ).toBe(404);
    const out = join(root, "remote-pinned");
    expect(
      await pullApprovedBaseline({
        project: "storefront",
        set: "main",
        out,
        server: base,
        env: { VISUALGUARD_UPLOAD_TOKEN: token },
      }),
    ).toMatchObject({ version: 1, checks: 2 });
    expect(await readFile(join(out, "checkout__desktop.png"))).toEqual(png);
    expect(approvedBaselineReference(join(out, "checkout__desktop.png"))).toMatchObject({
      projectId: "storefront",
      set: "main",
      version: 1,
      runId: run.id,
    });
    expect(
      (
        await request(path + "/restore", {
          expectedVersion: 1,
          version: 1,
          reason: "Restore immutable snapshot",
        })
      ).response.status,
    ).toBe(201);
    expect((await request(`${path}?version=1`)).value.version).toBe(1);
  });
  it("pulls without tokens or a server, refuses overwrites, verifies sidecars, and retains evidence", async () => {
    await request("/api/projects/storefront/baselines/main/promote", promote());
    const out = join(root, "local-pinned");
    const env = { VISUALGUARD_PLATFORM_DATA_DIR: root };
    await pullApprovedBaseline({ project: "storefront", set: "main", out, env });
    const path = join(out, "checkout__desktop.png");
    expect(() =>
      assertBaselineCompatible(path, run.manifest.jobs[0]!.renderingIdentity, "error"),
    ).not.toThrow();
    expect(() => assertBaselineWritable(path)).toThrow("cannot be updated");
    await expect(
      pullApprovedBaseline({ project: "storefront", set: "main", out, env }),
    ).rejects.toThrow("already exists");
    const dom = path.replace(/\.png$/, ".dom.json");
    await writeFile(dom, "{}");
    expect(() => approvedBaselineReference(path)).toThrow("Unexpected DOM");
    await rm(dom);
    await writeFile(path, "tampered");
    expect(() => approvedBaselineReference(path)).toThrow("checksum mismatch");
    await expect(platform.repository.deleteRun(run.id)).rejects.toThrow("retained");
    await expect(
      pullApprovedBaseline({ project: "storefront", set: "main", out: join(root, "retry"), env }),
    ).resolves.toMatchObject({ version: 1 });
  });
});
