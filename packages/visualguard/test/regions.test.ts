import { describe, expect, it } from "vitest";
import { extractRegions, mergeNearby } from "../src/diff/regions.js";

function maskWith(
  width: number,
  height: number,
  boxes: Array<[number, number, number, number]>,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const [x0, y0, w, h] of boxes) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mask[y * width + x] = 1;
  }
  return mask;
}

const options = { cellSize: 16, mergeDistance: 32, maxRegions: 10 };

describe("extractRegions", () => {
  it("returns nothing for an empty mask", () => {
    expect(extractRegions(new Uint8Array(100 * 100), 100, 100, options)).toEqual([]);
  });

  it("finds separate regions and sorts the largest first", () => {
    const mask = maskWith(400, 400, [
      [10, 10, 20, 20],
      [300, 300, 50, 50],
    ]);
    const regions = extractRegions(mask, 400, 400, options);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.diffPixels).toBe(2500);
    expect(regions[0]!.box).toEqual({ x: 300, y: 300, width: 50, height: 50 });
    expect(regions[1]!.diffPixels).toBe(400);
  });

  it("merges changes closer than mergeDistance", () => {
    const mask = maskWith(400, 200, [
      [10, 10, 10, 10],
      [100, 10, 10, 10],
    ]);
    expect(extractRegions(mask, 400, 200, options)).toHaveLength(2);
    const merged = extractRegions(mask, 400, 200, { ...options, mergeDistance: 80 });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.box).toEqual({ x: 10, y: 10, width: 100, height: 10 });
  });

  it("caps the number of regions", () => {
    const boxes: Array<[number, number, number, number]> = [];
    for (let i = 0; i < 20; i++) boxes.push([(i % 5) * 200, Math.floor(i / 5) * 200, 8, 8]);
    const regions = extractRegions(maskWith(1000, 800, boxes), 1000, 800, {
      ...options,
      maxRegions: 5,
    });
    expect(regions).toHaveLength(5);
  });
});

describe("mergeNearby", () => {
  it("merges overlapping boxes transitively", () => {
    const merged = mergeNearby(
      [
        { box: { x: 0, y: 0, width: 10, height: 10 }, diffPixels: 1 },
        { box: { x: 15, y: 0, width: 10, height: 10 }, diffPixels: 1 },
        { box: { x: 30, y: 0, width: 10, height: 10 }, diffPixels: 1 },
      ],
      5,
    );
    expect(merged).toEqual([{ box: { x: 0, y: 0, width: 40, height: 10 }, diffPixels: 3 }]);
  });
});
