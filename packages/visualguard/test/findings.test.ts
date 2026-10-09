/**
 * @file Tests differential health findings, scan policy and severity escalation.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { describe, expect, it } from "vitest";
import { applyFindings, healthFindings } from "../src/core/findings.js";
import type { CaptureResult, HealthSignals } from "../src/core/types.js";

/**
 * Build the minimum capture shape with empty health defaults and chosen overrides. Tests can
 * compare a single health signal without running Playwright.
 */
const capture = (
  health: Partial<HealthSignals>,
  source: "live" | "baseline" = "live",
): CaptureResult => ({
  source,
  image: "x.png",
  size: { width: 1, height: 1 },
  durationMs: 0,
  attempts: 1,
  health: { consoleErrors: [], failedRequests: [], brokenImages: [], ...health },
});

describe("healthFindings", () => {
  it("flags problems that are new on staging as regressions", () => {
    const findings = healthFindings({
      production: capture({ status: 200 }),
      staging: capture({
        status: 500,
        brokenImages: ["https://x.test/a.png"],
        horizontalOverflow: { documentWidth: 480, viewportWidth: 390 },
        consoleErrors: ["boom"],
      }),
    });
    expect(findings.map((f) => [f.severity, f.message])).toEqual([
      ["regression", "HTTP 500 on staging (production: 200)"],
      ["regression", "Broken image: /a.png"],
      ["regression", "Horizontal overflow: page is 480px wide at a 390px viewport"],
      ["info", "1 new console error: boom"],
    ]);
  });

  it("ignores problems production already has", () => {
    const health = { status: 404, brokenImages: ["https://x.test/a.png"], consoleErrors: ["boom"] };
    const findings = healthFindings({ production: capture(health), staging: capture(health) });
    expect(findings.map((f) => f.severity)).toEqual(["info"]);
  });

  it("asks for review in scan mode (no live production to compare with)", () => {
    const findings = healthFindings({
      production: capture({}, "baseline"),
      staging: capture({ status: 404, brokenImages: ["https://x.test/a.png"] }),
    });
    expect(findings.map((f) => f.severity)).toEqual(["review", "review"]);
  });
});

describe("applyFindings", () => {
  it("only ever raises the status", () => {
    expect(applyFindings("pass", [{ severity: "info", message: "", source: "health" }])).toBe(
      "pass",
    );
    expect(applyFindings("pass", [{ severity: "review", message: "", source: "health" }])).toBe(
      "review",
    );
    expect(
      applyFindings("review", [{ severity: "regression", message: "", source: "health" }]),
    ).toBe("regression");
    expect(
      applyFindings("regression", [{ severity: "review", message: "", source: "health" }]),
    ).toBe("regression");
  });
});
