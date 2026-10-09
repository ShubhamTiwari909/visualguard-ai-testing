/**
 * @file Tests noise area snapping/limits and conservative handling of oversized DOM containers.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { computeDiff } from "../src/diff/compute.js";
import { createImage, writePNG, type RGBAImage } from "../src/diff/image.js";
import { snapToElement } from "../src/diff/noise.js";

/**
 * Generate a small white image with digit-like dark blocks representing a changing price.
 * Controlled shapes make repeated-capture noise masks predictable.
 */
function page(digits: string): RGBAImage {
  // A 400×200 white page with a "price" at x=100..196, y=50..74: one dark block per digit.
  const image = createImage(400, 200, [255, 255, 255, 255]);
  [...digits].forEach((digit, index) => {
    const shade = 20 * Number(digit);
    for (let y = 54; y < 70; y++) {
      for (let x = 104 + index * 12; x < 112 + index * 12; x++) {
        const i = (y * 400 + x) * 4;
        image.data[i] = shade;
        image.data[i + 1] = shade;
        image.data[i + 2] = shade;
      }
    }
  });
  return image;
}

describe("noise map", () => {
  const dir = mkdtempSync(join(tmpdir(), "vg-noise-"));
  /**
   * Save a synthetic image under the test's temporary directory and return its path. The diff
   * pipeline consumes files, so this bridges in-memory fixtures to its input.
   */
  const write = (name: string, image: RGBAImage) => {
    const path = join(dir, `${name}.png`);
    writePNG(path, image);
    return path;
  };
  const dom = join(dir, "production.dom.json");
  writeFileSync(
    dom,
    JSON.stringify({
      nodes: [
        { box: [0, 0, 400, 200] },
        { box: [100, 50, 96, 24] }, // the price element
      ],
    }),
  );
  const options = parseConfig({}).diff;

  it("covers the whole element, even where two loads happened to agree", () => {
    // Both production loads start with "4"; staging differs in the first digit only.
    const input = {
      productionPath: write("production", page("41234")),
      stagingPath: write("staging", page("91234")),
      outDir: join(dir, "out"),
      options,
    };
    const again = write("again", page("45678"));
    expect(computeDiff(input).passed).toBe(false);

    const withoutDom = computeDiff({ ...input, noise: { env: "production", againPath: again } });
    expect(withoutDom.passed).toBe(false);

    const withDom = computeDiff({
      ...input,
      noise: { env: "production", againPath: again, domPath: dom },
    });
    expect(withDom.passed).toBe(true);
    expect(withDom.noise!.boxes).toHaveLength(1);
    expect(withDom.noise!.ignoredPixels).toBeGreaterThan(0);
  });

  it("is not applied when most of the page changes between loads", () => {
    const noisy = createImage(400, 200, [0, 0, 0, 255]);
    const result = computeDiff({
      productionPath: write("p2", page("0")),
      stagingPath: write("s2", page("9")),
      outDir: join(dir, "out2"),
      options,
      noise: { env: "production", againPath: write("a2", noisy) },
    });
    expect(result.passed).toBe(false);
    expect(result.noise!.skipped).toMatch(/of the page changes between loads/);
  });

  it("leaves areas alone when the only enclosing element is much larger", () => {
    const box = { x: 10, y: 10, width: 10, height: 10 };
    expect(snapToElement(box, [[0, 0, 1000, 1000]])).toEqual(box);
    expect(snapToElement(box, [[5, 5, 40, 20]])).toEqual({ x: 5, y: 5, width: 40, height: 20 });
  });
});
