import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApi } from "../server/http.js";
import { openPlatform } from "../server/config.js";
import { Operations } from "../server/operations.js";

describe("workspace operations HTTP access", () => {
  let platform: Awaited<ReturnType<typeof openPlatform>>, server: Server, base: string;
  let root: string, admin: { cookie: string; token: string }, member: typeof admin;
  const password = "operations-test-only-password";
  const request = async (path: string, actor?: typeof admin, data?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        ...(actor ? { Cookie: actor.cookie, "x-visualguard-platform-token": actor.token } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { response, value: await response.json() };
  };
  const login = async (email: string) => {
    const { response } = await request("/api/auth/login", undefined, { email, password });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const session = await request("/api/session", { cookie, token: "" });
    return { cookie, token: session.value.token as string };
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vg-operations-http-"));
    platform = await openPlatform({ VISUALGUARD_PLATFORM_DATA_DIR: root });
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No listener");
    base = `http://127.0.0.1:${address.port}`;
    const api = createApi(platform.repository, platform.store, {
      state: platform.state,
      env: {
        VISUALGUARD_AUTH_MODE: "login",
        VISUALGUARD_USER_ADMISSION: "invite",
        VISUALGUARD_PUBLIC_URL: base,
        VISUALGUARD_ADMIN_EMAIL: "admin@example.test",
        VISUALGUARD_ADMIN_PASSWORD: password,
      },
    });
    await api.ready;
    server.on("request", (req, res) => {
      void api(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end('{"error":"Not found"}');
        }
      });
    });
    admin = await login("admin@example.test");
    const created = await request("/api/users", admin, {
      name: "Member",
      email: "member@example.test",
      password,
    });
    expect(created.response.status).toBe(201);
    member = await login("member@example.test");
  });
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await platform?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("requires administrator browser access for audit and readiness", async () => {
    for (const path of ["/api/audit", "/api/operations"]) {
      expect((await request(path)).response.status).toBe(401);
      expect((await request(path, member)).response.status).toBe(403);
      const result = await request(path, admin);
      expect(result.response.status).toBe(200);
      expect(result.response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(result.value)).not.toContain(password);
      expect(JSON.stringify(result.value)).not.toContain("scrypt$");
    }
  });

  it("filters activity and rejects invalid date ranges and oversized cursors", async () => {
    const filtered = await request("/api/audit?action=user.created&person=admin", admin);
    expect(filtered.value.events).toHaveLength(1);
    expect(filtered.value.events[0].action).toBe("user.created");
    for (const query of [
      "since=invalid",
      "since=2026-10-17T00:00:00Z&until=2026-10-16T00:00:00Z",
      `after=${"x".repeat(201)}`,
    ])
      expect((await request(`/api/audit?${query}`, admin)).response.status).toBe(400);
  });

  it("never exposes a recovery mutation over HTTP", async () => {
    const before = await platform.state.list("users");
    for (const path of ["/api/operations/recover", "/api/auth/recover"])
      expect(
        (await request(path, admin, { password: "attempted-reset-password" })).response.status,
      ).toBe(404);
    expect(await platform.state.list("users")).toEqual(before);
  });

  it("rejects project upload credentials on both operational endpoints", async () => {
    await platform.repository.createProject("demo", "Demo");
    const token = await request("/api/projects/demo/tokens", admin, { name: "CI", days: 1 });
    expect(token.response.status).toBe(201);
    for (const path of ["/api/audit", "/api/operations"]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token.value.token}` },
      });
      expect(response.status).toBe(403);
    }
  });

  it("accepts only the recovered password and rejects pre-recovery sessions", async () => {
    const operations = new Operations(platform.state);
    const id = (await request("/api/session", admin)).value.user.id as string;
    const preview = await operations.previewRecovery(id);
    await operations.recover({
      userId: id,
      expectedVersion: preview.expectedVersion,
      confirm: id,
      backupAcknowledged: true,
      reason: "Local recovery acceptance check",
      password: "replacement-operations-password",
    });
    expect((await request("/api/operations", admin)).response.status).toBe(401);
    const oldLogin = await request("/api/auth/login", undefined, {
      email: "admin@example.test",
      password,
    });
    expect(oldLogin.response.status).toBe(401);
    const newLogin = await request("/api/auth/login", undefined, {
      email: "admin@example.test",
      password: "replacement-operations-password",
    });
    expect(newLogin.response.status).toBe(200);
  });
});
