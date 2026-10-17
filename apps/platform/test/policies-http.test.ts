import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../server/http.js";
import { runPolicyCommand } from "../server/policy-command.js";
import { policyPlatform, revision } from "./fixtures/policy-platform.js";

describe("F07 policy HTTP permissions and scoped CI access", () => {
  let p: Awaited<ReturnType<typeof policyPlatform>>, server: Server, base: string;
  let admin: { cookie: string; token: string }, viewer: typeof admin;
  const request = async (path: string, data?: unknown, actor = admin, bearer?: string) => {
    const response = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : actor ? { Cookie: actor.cookie, "x-visualguard-platform-token": actor.token } : {}), "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { response, value: await response.json() };
  };
  const login = async (email: string) => {
    const { response } = await request("/api/auth/login", { email, password: p.env.VISUALGUARD_ADMIN_PASSWORD });
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const session = await request("/api/session", undefined, { cookie, token: "" });
    return { cookie, token: session.value.token as string };
  };
  beforeEach(async () => {
    p = await policyPlatform();
    server = createServer(); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const api = createApi(p.repository, p.store, { state: p.state, env: { ...p.env, VISUALGUARD_AUTH_MODE: "login", VISUALGUARD_PUBLIC_URL: base } });
    await api.ready; server.on("request", (req, res) => { void api(req, res); });
    admin = await login("admin@example.test");
    const user = (await request("/api/users", { name: "Viewer", email: "viewer@example.test", password: p.env.VISUALGUARD_ADMIN_PASSWORD })).value;
    await p.state.create("memberships", `${user.id}:storefront`, { userId: user.id, projectId: "storefront", role: "viewer" });
    viewer = await login("viewer@example.test");
  });
  afterEach(async () => { server?.closeAllConnections(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); await p?.dispose(); });
  it("requires sign in and CSRF, permits viewer assessment but restricts policy changes", async () => {
    const path = "/api/projects/storefront/policy";
    expect((await fetch(base + path)).status).toBe(401);
    expect((await request(path, p.mutation, viewer)).response.status).toBe(403);
    expect((await request(path, p.mutation, { ...admin, token: "" })).response.status).toBe(403);
    const saved = await request(path, p.mutation); expect(saved.response.status).toBe(201);
    expect(saved.value.current.version).toBe(1);
    const read = await request(path, undefined, viewer); expect(read.value.canEdit).toBe(false);
    expect(read.response.headers.get("cache-control")).toBe("no-store");
    expect((await request(path + "/assess", { revision }, viewer)).value.status).toBe("pending");
    expect((await request(path + "/reconcile", { pullRequest: 7 }, viewer)).response.status).toBe(403);
    expect((await request(path + "/assess", { revision: "fake" })).response.status).toBe(400);
  });
  it("limits upload credentials to their own project and allows remote command assessment", async () => {
    await request("/api/projects/storefront/policy", p.mutation);
    const token = (await request("/api/projects/storefront/tokens", { name: "Policy CI", days: 1 })).value.token;
    const path = "/api/projects/storefront/policy";
    expect((await request(path, undefined, undefined, token)).value.canEdit).toBe(false);
    expect((await request(path, { ...p.mutation, expectedVersion: 1 }, undefined, token)).response.status).toBe(403);
    expect((await request(path + "/assess", { revision }, undefined, token)).response.status).toBe(200);
    expect((await request("/api/projects/other/policy/assess", { revision }, undefined, token)).response.status).toBe(403);
    expect((await request("/api/runs", undefined, undefined, token)).response.status).toBe(403);
    expect((await runPolicyCommand({ action: "assess", project: "storefront", revision, server: base, env: { VISUALGUARD_UPLOAD_TOKEN: token } })).assessment?.status).toBe("pending");
  });
  it("checks webhook signatures before browser authentication and never trusts unsigned events", async () => {
    const response = await fetch(base + "/api/github/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-github-event": "pull_request" }, body: "{}" });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("signature");
  });
  it("removes policy and reconciliation records when a project is deleted", async () => {
    await request("/api/projects/storefront/policy", p.mutation);
    await p.state.create("policy-deliveries", "storefront:0000000007", { projectId: "storefront", pullRequest: 7 });
    await p.repository.deleteProject("storefront", 1);
    expect(await p.state.get("visual-policies", "storefront")).toBeUndefined();
    expect(await p.state.list("policy-deliveries", "storefront:")).toEqual([]);
  });
});
