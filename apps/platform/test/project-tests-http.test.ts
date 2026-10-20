import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createApi } from "../server/http.js";
import type { User } from "../server/auth.js";
import { policyPlatform } from "./fixtures/policy-platform.js";
const config = {
  baseURL: { production: "https://reference.test", staging: "https://candidate.test" },
  routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } },
  ai: { provider: "none" },
};

for (const mode of ["local", "login"] as const)
  describe(`${mode} project test APIs`, () => {
    let p: Awaited<ReturnType<typeof policyPlatform>>,
      server: Server,
      base: string,
      cookie: string,
      csrf: string;
    const request = async (
      path: string,
      method = "GET",
      data?: unknown,
      bearer?: string,
      noCsrf = false,
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(bearer
            ? { Authorization: `Bearer ${bearer}` }
            : { Cookie: cookie, ...(!noCsrf ? { "x-visualguard-platform-token": csrf } : {}) }),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { response, value: await response.json() };
    };
    beforeEach(async () => {
      p = await policyPlatform();
      cookie = "";
      csrf = "";
      server = createServer();
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const api = createApi(p.repository, p.store, {
        state: p.state,
        env: {
          ...p.env,
          VISUALGUARD_AUTH_MODE: mode,
          VISUALGUARD_PUBLIC_URL: mode === "login" ? base : "",
        },
      });
      await api.ready;
      server.on("request", (req, res) => {
        void api(req, res);
      });
      if (mode === "login") {
        const login = await request("/api/auth/login", "POST", {
          email: p.env.VISUALGUARD_ADMIN_EMAIL,
          password: p.env.VISUALGUARD_ADMIN_PASSWORD,
        });
        cookie = login.response.headers.get("set-cookie")!.split(";")[0]!;
      }
      csrf = (await request("/api/session")).value.token;
    });
    afterEach(async () => {
      server?.closeAllConnections();
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
      await p?.dispose();
    });
    it("requires CSRF on configuration edits and validates payloads", async () => {
      const path = "/api/projects/storefront/test-config";
      expect((await request(path)).value).toBeNull();
      expect(
        (await request(path, "PUT", { expectedVersion: 0, config }, undefined, true)).response
          .status,
      ).toBe(403);
      expect((await request(path, "PUT", { expectedVersion: 0, config })).value).toMatchObject({
        version: 1,
        config,
      });
      expect(
        (await request(path, "PUT", { expectedVersion: 1, config: { ...config, hooks: {} } }))
          .response.status,
      ).toBe(400);
      expect((await request(path)).response.headers.get("cache-control")).toBe("no-store");
    });
    it("lets only dedicated runner credentials claim work, and revocation stops polling", async () => {
      const normal = (
        await request("/api/projects/storefront/tokens", "POST", { name: "Upload only", days: 1 })
      ).value;
      expect(
        (await request("/api/projects/storefront/test-runner/claim", "POST", {}, normal.token))
          .response.status,
      ).toBe(403);
      const key = (
        await request("/api/projects/storefront/test-runner-key", "POST", {
          name: "Runner",
          days: 1,
        })
      ).value;
      expect(key.token).toMatch(/^vg_runner_/);
      expect((await request("/api/projects", "GET", undefined, key.token)).response.status).toBe(
        403,
      );
      expect(
        (
          await request(
            "/api/projects/storefront/test-execution",
            "POST",
            { id: randomUUID(), configVersion: 1 },
            key.token,
          )
        ).response.status,
      ).toBe(403);
      expect(
        (await request("/api/projects/storefront/test-runner/claim", "POST", {}, key.token)).value,
      ).toBeNull();
      expect(
        (
          await request(
            "/api/projects/storefront/test-config",
            "PUT",
            { expectedVersion: 0, config },
            key.token,
          )
        ).response.status,
      ).toBe(403);
      expect(
        (await request("/api/projects/other/test-runner/claim", "POST", {}, key.token)).response
          .status,
      ).toBe(403);
      await request(`/api/projects/storefront/tokens/${key.id}`, "DELETE", {});
      expect(
        (await request("/api/projects/storefront/test-runner/claim", "POST", {}, key.token))
          .response.status,
      ).toBe(401);
    });
    if (mode === "login")
      it("invalidates runner credentials when their owner is disabled", async () => {
        const key = (
          await request("/api/projects/storefront/test-runner-key", "POST", {
            name: "Runner",
            days: 1,
          })
        ).value;
        const token = (await p.state.get<{ ownerId: string }>("tokens", key.id))!;
        const user = (await p.state.get<User>("users", token.value.ownerId))!;
        await p.state.replace("users", { ...user, value: { ...user.value, disabled: true } });
        expect(
          (await request("/api/projects/storefront/test-runner/claim", "POST", {}, key.token))
            .response.status,
        ).toBe(401);
      });
    it("queues a config snapshot and completes failure without exposing private leases", async () => {
      await request("/api/projects/storefront/test-config", "PUT", { expectedVersion: 0, config });
      const key = (
        await request("/api/projects/storefront/test-runner-key", "POST", {
          name: "Runner",
          days: 1,
        })
      ).value;
      await request("/api/projects/storefront/test-runner/claim", "POST", {}, key.token);
      const id = randomUUID();
      expect(
        (await request("/api/projects/storefront/test-execution", "POST", { id, configVersion: 1 }))
          .response.status,
      ).toBe(202);
      const job = (
        await request("/api/projects/storefront/test-runner/claim", "POST", {}, key.token)
      ).value;
      expect(job).toMatchObject({ id, configVersion: 1, config, status: "running" });
      const status = (await request("/api/projects/storefront/test-execution")).value;
      expect(status.runnerOnline).toBe(true);
      expect(JSON.stringify(status)).not.toContain(job.lease);
      expect(
        (
          await request(
            "/api/projects/storefront/test-runner/heartbeat",
            "POST",
            {
              id,
              lease: job.lease,
              progress: {
                stage: "comparing",
                completedJobs: 0,
                totalJobs: 1,
                route: "/",
                viewport: "desktop",
              },
            },
            key.token,
          )
        ).response.status,
      ).toBe(200);
      expect(
        (await request("/api/projects/storefront/test-execution")).value.execution.progress,
      ).toMatchObject({ stage: "comparing", completedJobs: 0, totalJobs: 1 });
      expect(
        (
          await request(
            "/api/projects/storefront/test-runner/complete",
            "POST",
            { id, lease: job.lease, failed: true },
            key.token,
          )
        ).value.status,
      ).toBe("failed");
    });
  });
