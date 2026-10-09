import { afterAll, beforeAll, expect, it } from "vitest";
import { createRun } from "../src/core/run.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

let site: FixtureServer;
beforeAll(async () => {
  site = await startFixtureServer("production");
});
afterAll(async () => {
  await site?.close();
});
it("captures and compares an identical page in the selected smoke browser", async () => {
  const name = process.env.VG_SMOKE_BROWSER ?? "chromium";
  if (name !== "chromium" && name !== "firefox" && name !== "webkit")
    throw new Error("Unknown smoke browser");
  const config = testConfig({
    baseURL: { production: site.url, staging: site.url },
    routes: ["/identical"],
    browser: { name },
  });
  const { manifest } = await createRun(config, { ai: false }).start();
  expect(manifest.jobs[0]?.status).toBe("pass");
  expect(manifest.jobs[0]?.diff?.diffPixels).toBe(0);
}, 60_000);
