import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptJobs, applyAccepted, sameChange, type AcceptedFile } from "../src/core/accepted.js";
import type { JobResult } from "../src/core/types.js";
import { createImage, writePNG } from "../src/diff/image.js";

function jobWith(
  runDir: string,
  name: string,
  options: { shade?: number; extraDelta?: boolean; regionX?: number; diffPixels?: number } = {},
): JobResult {
  const production = createImage(400, 300, [255, 255, 255, 255]);
  const staging = createImage(400, 300, [255, 255, 255, 255]);
  // A slightly different shade stands in for anti-aliasing noise between renders.
  staging.data[0] = options.shade ?? 250;
  writePNG(join(runDir, `${name}.production.png`), production);
  writePNG(join(runDir, `${name}.staging.png`), staging);
  return {
    id: "home__desktop",
    route: "/",
    name: "/",
    viewport: "desktop",
    status: "review",
    baseStatus: "review",
    urls: { production: "https://a.test/", staging: "https://b.test/" },
    captures: {
      production: {
        image: `${name}.production.png`,
        size: { width: 400, height: 300 },
        durationMs: 1,
        attempts: 1,
        health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
      },
      staging: {
        image: `${name}.staging.png`,
        size: { width: 400, height: 300 },
        durationMs: 1,
        attempts: 1,
        health: { consoleErrors: [], failedRequests: [], brokenImages: [] },
      },
    },
    diff: { width: 400, height: 300, diffPixels: 1200, diffRatio: 0.01 },
    regions: [
      {
        id: 0,
        box: { x: options.regionX ?? 40, y: 40, width: 120, height: 40 },
        diffPixels: options.diffPixels ?? 1200,
        elements: [],
        deltas: [
          {
            kind: "style",
            selector: "a.btn",
            property: "background-color",
            production: "#2563eb",
            staging: "#7c3aed",
          },
          ...(options.extraDelta
            ? [
                {
                  kind: "style" as const,
                  selector: "a.btn",
                  property: "border-radius",
                  production: "8px",
                  staging: "0px",
                },
              ]
            : []),
        ],
      },
    ],
    durationMs: 1,
  };
}

describe("accepted changes", () => {
  const runDir = mkdtempSync(join(tmpdir(), "vg-accept-"));
  const accepted = jobWith(runDir, "accepted");
  const { file, added } = acceptJobs({ version: 1, accepted: [] }, [accepted], runDir);

  it("stores the change with the screenshot hash", () => {
    expect(added[0]!.change).toMatchObject({
      size: { width: 400, height: 300 },
      deltas: ["style a.btn background-color: #2563eb → #7c3aed"],
    });
  });

  it("matches identical screenshots exactly", () => {
    const same = applyAccepted(jobWith(runDir, "same"), runDir, file);
    expect(same.status).toBe("accepted");
    expect(same.acceptedBy?.match).toBe("exact");
  });

  it("matches the same change when a few pixels differ, unless exact matching is configured", () => {
    const rerender = jobWith(runDir, "rerender", { shade: 251, regionX: 44, diffPixels: 1290 });
    const similar = applyAccepted(rerender, runDir, file);
    expect(similar.status).toBe("accepted");
    expect(similar.acceptedBy?.match).toBe("similar");
    expect(applyAccepted(rerender, runDir, file, "exact").status).toBe("review");
  });

  it("flags a different change again", () => {
    const cases = [
      jobWith(runDir, "extra", { shade: 252, extraDelta: true }),
      jobWith(runDir, "moved", { shade: 253, regionX: 220 }),
      jobWith(runDir, "bigger", { shade: 254, diffPixels: 4000 }),
    ];
    for (const job of cases) expect(applyAccepted(job, runDir, file).status).toBe("review");
  });

  it("never hides a new health problem", () => {
    const job = jobWith(runDir, "broken", { shade: 249 });
    job.findings = [{ severity: "regression", message: "Broken image: /a.png", source: "health" }];
    job.status = "regression";
    expect(applyAccepted(job, runDir, file).status).toBe("regression");
  });

  it("keeps working with entries written before fingerprints existed", () => {
    const old: AcceptedFile = {
      version: 1,
      accepted: file.accepted.map(({ change: _change, ...entry }) => entry),
    };
    expect(applyAccepted(jobWith(runDir, "old-exact"), runDir, old).status).toBe("accepted");
    expect(applyAccepted(jobWith(runDir, "old-similar", { shade: 248 }), runDir, old).status).toBe(
      "review",
    );
  });

  it("compares layout shifts", () => {
    const base = { size: { width: 10, height: 10 }, regions: [], deltas: [] };
    expect(
      sameChange(
        { ...base, shift: { fromY: 100, deltaY: 40 } },
        { ...base, shift: { fromY: 104, deltaY: 40 } },
      ),
    ).toBe(true);
    expect(
      sameChange(
        { ...base, shift: { fromY: 100, deltaY: 40 } },
        { ...base, shift: { fromY: 100, deltaY: 48 } },
      ),
    ).toBe(false);
    expect(sameChange(base, { ...base, shift: { fromY: 100, deltaY: 40 } })).toBe(false);
  });
});
