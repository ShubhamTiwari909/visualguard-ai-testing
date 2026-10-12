/**
 * @file Tests static/served report rendering, embedded-data safety, screenshot loading,
 * navigation and accessibility.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "../src/core/run.js";
import type { RunManifest } from "../src/core/types.js";
import { htmlReporter, renderReportHTML } from "../src/reporters/html.js";
import { startReportServer } from "../src/server/report-server.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

let production: FixtureServer;
let staging: FixtureServer;
let browser: Browser;
let runDir: string;
let manifest: RunManifest;

beforeAll(async () => {
  production = await startFixtureServer("production");
  staging = await startFixtureServer("staging");
  const config = testConfig({
    baseURL: { production: production.url, staging: staging.url },
    routes: ["/identical", "/alignment", "/missing-image", "/layout-shift"],
    viewports: {
      desktop: { width: 1280, height: 800 },
      mobile: { width: 390, height: 844, isMobile: true },
    },
  });
  ({ manifest, runDir } = await createRun(config, { reporters: [htmlReporter()] }).start());
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await production?.close();
  await staging?.close();
});

/**
 * Open a report in a fresh browser context, collect page errors and wait for the main heading.
 * Returning the page and errors lets each UI test inspect both rendering and script failures.
 */
async function openReport(url: string): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await page.goto(url);
  await page.getByRole("heading", { level: 1 }).waitFor();
  return { page, errors };
}

describe("renderReportHTML", () => {
  it("inlines the app, styles and escaped data", () => {
    const html = renderReportHTML({
      ...manifest,
      jobs: [{ ...manifest.jobs[0]!, name: "</script><b>x" }],
    });
    expect(html).not.toContain('src="./assets/app.js"');
    expect(html).not.toContain('href="./assets/style.css"');
    expect(html).toContain("<style>");
    expect(html).toContain("\\u003c/script>\\u003cb>x");
    expect(html.match(/<\/script>/g)!.length).toBe(2);
  });
});

describe("static report (file://)", () => {
  it("lists jobs, worst first, and shows screenshots", async () => {
    const { page, errors } = await openReport(pathToFileURL(join(runDir, "index.html")).href);
    const items = page.getByRole("navigation", { name: "Jobs" }).getByRole("button");
    await expect.poll(() => items.count()).toBe(8);
    expect(await items.first().textContent()).toContain("/missing-image");

    await expect.poll(() => page.locator("#job-title").textContent()).toBe("/missing-image");
    const images = page.locator("main img");
    await expect.poll(() => images.count()).toBeGreaterThan(1);
    const loaded = await images.evaluateAll((elements) =>
      elements.every(
        (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
      ),
    );
    expect(loaded).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("supports keyboard navigation, view modes and deep links", async () => {
    const { page } = await openReport(pathToFileURL(join(runDir, "index.html")).href);
    await page.keyboard.press("j");
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("missing-image__mobile");
    await page.keyboard.press("2");
    await expect
      .poll(() => page.getByRole("button", { name: "Slider" }).getAttribute("aria-pressed"))
      .toBe("true");
    expect(await page.evaluate(() => location.hash)).toContain("view=slider");
    await expect.poll(() => page.getByRole("slider").count()).toBe(1);

    await page.goto(
      pathToFileURL(join(runDir, "index.html")).href + "#/jobs/alignment__desktop?view=diff",
    );
    await page.reload();
    await expect.poll(() => page.locator("#job-title").textContent()).toBe("/alignment");
    await expect
      .poll(() => page.getByRole("button", { name: "Diff" }).getAttribute("aria-pressed"))
      .toBe("true");

    await page
      .getByRole("button", { name: /review/ })
      .first()
      .click();
    const items = page.getByRole("navigation", { name: "Jobs" }).getByRole("button");
    await expect.poll(() => items.count()).toBe(manifest.summary.review);
    await page.close();
  });

  it("has no serious accessibility violations in light and dark themes", async () => {
    const { page } = await openReport(pathToFileURL(join(runDir, "index.html")).href);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      // Let colour transitions finish so axe measures the final colours.
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations
        .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
        .map(
          (violation) =>
            `${theme}: ${violation.id} ${violation.nodes.map((node) => `${node.target.join(" ")} ${node.failureSummary}`).join("; ")}`,
        );
      expect(serious).toEqual([]);
    }
    await page.close();
  }, 60_000);
});

describe("served report", () => {
  it("serves the page with a token, screenshots and a token-protected API", async () => {
    const received: unknown[] = [];
    const server = await startReportServer({
      runDir,
      api: {
        /**
         * Record the received API body and return a successful test response. The comma
         * expression evaluates recording first, then returns the response object.
         */
        echo: (body) => (received.push(body), { ok: true }),
      },
    });
    try {
      const html = await (await fetch(server.url)).text();
      expect(html).toContain(server.token);

      const image = manifest.jobs[0]!.captures.staging!.image;
      const response = await fetch(new URL(image, server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");

      expect((await fetch(new URL("api/health", server.url))).status).toBe(200);
      expect(
        (await fetch(new URL("api/echo", server.url), { method: "POST", body: "{}" })).status,
      ).toBe(403);
      const ok = await fetch(new URL("api/echo", server.url), {
        method: "POST",
        headers: { "x-visualguard-token": server.token },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(ok.status).toBe(200);
      expect(received).toEqual([{ hello: "world" }]);
      expect((await fetch(new URL("../../etc/passwd", server.url))).status).toBe(404);

      const { page, errors } = await openReport(server.url);
      await expect.poll(() => page.locator("#job-title").textContent()).toBe("/missing-image");
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await server.close();
    }
  });

  it("writes index.html into the run directory", () => {
    expect(readFileSync(join(runDir, "index.html"), "utf8")).toContain("window.__VISUALGUARD__");
  });
});
