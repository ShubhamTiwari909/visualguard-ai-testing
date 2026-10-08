import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRun } from "../src/core/run.js";
import type { JobResult, RunManifest } from "../src/core/types.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

/**
 * Phase 4 "done when": without AI, each fixture's explanation names the right element and
 * property (PLAN.md §19).
 */
let production: FixtureServer;
let staging: FixtureServer;
let manifest: RunManifest;

beforeAll(async () => {
  production = await startFixtureServer("production");
  staging = await startFixtureServer("staging");
  const config = testConfig({
    baseURL: { production: production.url, staging: staging.url },
    routes: [
      "/text-change",
      "/color-change",
      "/alignment",
      "/spacing",
      "/layout-shift",
      "/missing-image",
      "/overflow",
      "/overlap",
      "/hidden",
    ],
    viewports: {
      desktop: { width: 1440, height: 900 },
      mobile: { width: 390, height: 844, isMobile: true },
    },
  });
  ({ manifest } = await createRun(config).start());
}, 180_000);

afterAll(async () => {
  await production?.close();
  await staging?.close();
});

const job = (route: string, viewport = "desktop"): JobResult =>
  manifest.jobs.find((candidate) => candidate.route === route && candidate.viewport === viewport)!;
const messages = (route: string, viewport = "desktop") =>
  (job(route, viewport).findings ?? []).map((f) => f.message);

describe("explanations without AI", () => {
  it.each(["desktop", "mobile"])("text change (%s)", (viewport) => {
    expect(job("/text-change", viewport).status).toBe("review");
    expect(messages("/text-change", viewport)).toContain(
      "Text changed: “Start free trial” → “Start trial”",
    );
  });

  it("colour change names the property and colours", () => {
    expect(messages("/color-change")).toContain(
      'Colour changed: background-color #2563eb → #7c3aed on [data-testid="cta"]',
    );
  });

  it("alignment change names the container, not the moved children", () => {
    expect(job("/alignment").diff?.shift).toBeUndefined();
    expect(messages("/alignment")).toContain(
      "Alignment changed: align-items center → flex-start on main > div.checkout-summary > div.actions",
    );
  });

  it("spacing change groups padding sides", () => {
    expect(messages("/spacing")).toContain(
      "Spacing changed: padding 24px → 12px on main > div.grid > div.card",
    );
  });

  it("layout shift is one root cause with the new element", () => {
    const shifted = job("/layout-shift");
    expect(shifted.diff?.shift).toEqual({ fromY: 95, deltaY: 72 });
    expect(shifted.regions[0]!.kind).toBe("shift");
    expect(messages("/layout-shift")[0]).toMatch(
      /^New element: main > div\.banner; content below y=95 moved 72px down$/,
    );
  });

  it("broken image and hidden control are regressions", () => {
    expect(job("/missing-image").status).toBe("regression");
    expect(messages("/missing-image")).toContain("Broken image: /product-v2.svg");
    expect(job("/hidden").status).toBe("regression");
    expect(messages("/hidden")).toContain(
      '[data-testid="cta"] “Start free trial” is missing on staging',
    );
  });

  it("overflow is a regression on mobile only, with its cause", () => {
    expect(job("/overflow").status).toBe("pass");
    expect(job("/overflow", "mobile").status).toBe("regression");
    expect(messages("/overflow", "mobile")).toEqual(
      expect.arrayContaining([
        "Horizontal overflow: page is 512px wide at a 390px viewport",
        "Size changed: max-width 100% → none on main > div.promo",
      ]),
    );
  });

  it("new overlap is a regression", () => {
    expect(job("/overlap").status).toBe("regression");
    expect(messages("/overlap")).toContain(
      'main > span.badge “New” now overlaps [data-testid="hero"]',
    );
  });
});
