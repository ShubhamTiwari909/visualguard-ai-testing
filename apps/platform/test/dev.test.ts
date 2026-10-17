import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { startDevDashboard } from "../server/dev.js";

it.each(["/reviews", "/invite", "/operations"])(
  "serves %s directly in the development dashboard",
  async (path) => {
    const dataDir = await mkdtemp(join(tmpdir(), "vg-dev-"));
    let runtime: Awaited<ReturnType<typeof startDevDashboard>> | undefined;
    try {
      vi.stubEnv("VISUALGUARD_PLATFORM_DATA_DIR", dataDir);
      vi.stubEnv("VISUALGUARD_SQLITE_FILE", "");
      vi.stubEnv("VISUALGUARD_AUTH_MODE", "local");
      vi.stubEnv("VISUALGUARD_PUBLIC_URL", "");
      vi.stubEnv("VISUALGUARD_DATABASE_URL", "");
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("K_SERVICE", "");
      runtime = await startDevDashboard({ port: 0 });
      const response = await fetch(`${runtime.url}${path}`, { redirect: "manual" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      if (path === "/invite") {
        expect(response.headers.get("referrer-policy")).toBe("no-referrer");
        expect(response.headers.get("cache-control")).toBe("no-store");
      }
      const html = await response.text();
      expect(html).toContain('<div id="root">');
      expect(html).toContain("/@vite/client");
    } finally {
      try {
        await runtime?.close();
      } finally {
        vi.unstubAllEnvs();
        await rm(dataDir, { recursive: true, force: true });
      }
    }
  },
);
