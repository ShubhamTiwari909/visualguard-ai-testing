/**
 * @file Tests complete image comparisons, size padding, thresholds and written diff/region
 * artifacts.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeDiff, type DiffOptions } from "../src/diff/compute.js";
import { createImage, readPNG, writePNG, type RGBAImage } from "../src/diff/image.js";

const options: DiffOptions = {
  threshold: 0.1,
  ignoreAntialiasing: true,
  maxDiffPixels: 20,
  maxDiffRatio: 0,
  maxRegions: 10,
  regionCellSize: 16,
  regionMergeDistance: 32,
  regionPadding: 8,
  detectShift: true,
};

/**
 * Paint an opaque colored rectangle into the test image's RGBA buffer. Compute the row-major
 * byte offset as (y * width + x) * 4.
 */
function fillRect(
  image: RGBAImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * image.width + x) * 4;
      image.data.set([...rgb, 255], i);
    }
  }
}

/**
 * Write a supplied image pair to temporary PNG files and return a computeDiff input. This tests
 * the actual file-based pipeline while keeping the image content controlled.
 */
function setup(a: RGBAImage, b: RGBAImage) {
  const dir = mkdtempSync(join(tmpdir(), "vg-diff-"));
  writePNG(join(dir, "production.png"), a);
  writePNG(join(dir, "staging.png"), b);
  return {
    dir,
    productionPath: join(dir, "production.png"),
    stagingPath: join(dir, "staging.png"),
    outDir: dir,
    options,
  };
}

describe("computeDiff", () => {
  it("passes identical images without writing artifacts", () => {
    const image = createImage(200, 100, [255, 255, 255, 255]);
    const input = setup(image, image);
    const result = computeDiff(input);
    expect(result).toMatchObject({ passed: true, diffPixels: 0, regions: [] });
    expect(existsSync(join(input.dir, "diff.png"))).toBe(false);
  });

  it("finds a changed area and writes the diff image and region crops", () => {
    const a = createImage(300, 200, [255, 255, 255, 255]);
    const b = createImage(300, 200, [255, 255, 255, 255]);
    fillRect(a, 100, 50, 40, 30, [37, 99, 235]);
    fillRect(b, 100, 50, 40, 30, [124, 58, 237]);
    const input = setup(a, b);
    const result = computeDiff(input);

    expect(result.passed).toBe(false);
    expect(result.diffPixels).toBe(1200);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.box).toEqual({ x: 100, y: 50, width: 40, height: 30 });
    expect(readPNG(result.image!).width).toBe(300);
    expect(readPNG(result.regions[0]!.crops.staging).width).toBe(56);
  });

  it("pads mismatched heights so the extra content counts as a difference", () => {
    const a = createImage(100, 100, [255, 255, 255, 255]);
    const b = createImage(100, 140, [255, 255, 255, 255]);
    const result = computeDiff(setup(a, b));
    expect(result.sizeMismatch).toEqual({
      production: { width: 100, height: 100 },
      staging: { width: 100, height: 140 },
    });
    expect(result.diffPixels).toBe(100 * 40);
    expect(result.passed).toBe(false);
  });

  it("tolerates up to maxDiffPixels", () => {
    const a = createImage(100, 100, [255, 255, 255, 255]);
    const b = createImage(100, 100, [255, 255, 255, 255]);
    fillRect(b, 0, 0, 4, 4, [0, 0, 0]);
    expect(computeDiff(setup(a, b)).passed).toBe(true);
    expect(computeDiff({ ...setup(a, b), options: { ...options, maxDiffPixels: 0 } }).passed).toBe(
      false,
    );
  });
});
