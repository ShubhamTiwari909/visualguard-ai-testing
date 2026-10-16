import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { startDevDashboard } from "../server/dev.js";

it("serves the review inbox directly in the development dashboard", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "vg-dev-"));
  let runtime: Awaited<ReturnType<typeof startDevDashboard>> | undefined;
  try {
    const probe = createServer().listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    await new Promise<void>((resolve, reject) => {
      probe.close((error) => (error ? reject(error) : resolve()));
    });
    vi.stubEnv("VISUALGUARD_PLATFORM_PORT", String(address.port));
    vi.stubEnv("VISUALGUARD_PLATFORM_DATA_DIR", dataDir);
    vi.stubEnv("VISUALGUARD_SQLITE_FILE", "");
    vi.stubEnv("VISUALGUARD_AUTH_MODE", "local");
    vi.stubEnv("VISUALGUARD_DATABASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("K_SERVICE", "");
    runtime = await startDevDashboard();
    const response = await fetch(`${runtime.url}/reviews`, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
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
});
