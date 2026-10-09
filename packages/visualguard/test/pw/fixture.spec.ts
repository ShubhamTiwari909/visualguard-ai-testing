import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "visualguard/playwright";

const work = mkdtempSync(join(tmpdir(), "vg-pw-"));
const STAGING = "http://127.0.0.1:4211";

test.use({
  visualguardOptions: {
    config: {
      baseURL: { production: "http://127.0.0.1:4210", staging: STAGING },
      stabilize: { freezeTime: "2026-01-01T00:00:00Z", networkQuietMs: 100 },
      output: { dir: join(work, "out") },
    },
  },
});

test("an unchanged page passes", async ({ page, visualguard }) => {
  await page.goto(`${STAGING}/identical`);
  const result = await visualguard.check(page);
  expect(result.status).toBe("pass");
  expect(result.urls.production).toBe("http://127.0.0.1:4210/identical");
});

test("a broken image fails with its explanation", async ({ page, visualguard }) => {
  await page.goto(`${STAGING}/missing-image`);
  await expect(visualguard.check(page, { name: "product" })).rejects.toThrow(
    /"product" on \/missing-image is a regression[\s\S]*Broken image: \/product-v2\.svg/,
  );
});

test("a change marked review passes unless failOn is review", async ({ page, visualguard }) => {
  await page.goto(`${STAGING}/text-change`);
  const result = await visualguard.check(page);
  expect(result.status).toBe("review");
  expect(result.findings?.[0]?.message).toBe("Text changed: “Start free trial” → “Start trial”");
  await expect(visualguard.check(page, { name: "strict", failOn: "review" })).rejects.toThrow(
    /is a review/,
  );
});

test.describe("without a production URL", () => {
  test.use({
    visualguardOptions: {
      config: {
        baseURL: { staging: STAGING },
        stabilize: { freezeTime: "2026-01-01T00:00:00Z", networkQuietMs: 100 },
        output: { dir: join(work, "out") },
        baseline: { dir: join(work, "baselines"), missing: "create" },
      },
    },
  });

  test("saves a baseline, then compares against it", async ({ page, visualguard }) => {
    await page.goto(`${STAGING}/identical`);
    expect((await visualguard.check(page, { name: "first" })).captures.production).toBeUndefined();
    expect((await visualguard.check(page, { name: "first" })).captures.production?.source).toBe(
      "baseline",
    );
  });
});

test("replays a per-check reference state", async ({ page, visualguard }) => {
  await page.goto(`${STAGING}/identical`);
  await page.locator("h1").evaluate((node) => {
    node.textContent = "Scenario state";
  });
  const result = await visualguard.check(page, {
    referenceSetup: async (reference) => {
      await reference.locator("h1").evaluate((node) => {
        node.textContent = "Scenario state";
      });
    },
  });
  expect(result.status).toBe("pass");
});

test.describe("early event instrumentation", () => {
  test.use({
    visualguardOptions: {
      collectHealth: true,
      config: {
        baseURL: { production: "http://127.0.0.1:4210", staging: STAGING },
        stabilize: { networkQuietMs: 100 },
      },
    },
  });
  test("retains an error emitted before check", async ({ page, visualguard }) => {
    await page.goto(`${STAGING}/identical`);
    await page.evaluate(() => console.error("fixture-event-before-check"));
    const result = await visualguard.check(page);
    expect(result.captures.staging?.health.consoleErrors).toContain("fixture-event-before-check");
    expect(
      result.findings?.some((finding) => finding.message.includes("fixture-event-before-check")),
    ).toBe(true);
  });
});
