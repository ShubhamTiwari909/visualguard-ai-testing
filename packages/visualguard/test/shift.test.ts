import { describe, expect, it } from "vitest";
import { detectShift } from "../src/diff/shift.js";
import { createImage, type RGBAImage } from "../src/diff/image.js";

/** A page of distinct text-like rows so every row hashes differently. */
function page(
  height: number,
  rows: Array<{ y: number; seed: number; length?: number }>,
  width = 200,
): RGBAImage {
  const image = createImage(width, height, [255, 255, 255, 255]);
  for (const { y, seed, length = 6 } of rows) {
    for (let r = 0; r < length; r++) {
      for (let x = 0; x < width; x++) {
        if ((x * (seed + r + 3)) % 7 < 3)
          image.data.set([20, 20, 20, 255], ((y + r) * width + x) * 4);
      }
    }
  }
  return image;
}

const options = { threshold: 0.1, ignoreAntialiasing: true };
const content = Array.from({ length: 20 }, (_, i) => ({ y: 100 + i * 20, seed: i }));

describe("detectShift", () => {
  it("finds content pushed down by an inserted band", () => {
    const production = page(600, content);
    const staging = page(600, [
      { y: 100, seed: 99, length: 30 },
      ...content.map((row) => ({ ...row, y: row.y + 40 })),
    ]);
    const shift = detectShift(production, staging, options);
    expect(shift).toMatchObject({ deltaY: 40, fromY: 100 });
    // The inserted band is reported as its own region, so nothing else is left over.
    expect(shift!.residualPixels).toBe(0);
    expect(shift!.explainsBelow).toBe(true);
  });

  it("finds content pulled up by a removed band", () => {
    const production = page(600, [
      { y: 60, seed: 50, length: 20 },
      ...content.map((row) => ({ ...row, y: row.y + 30 })),
    ]);
    const staging = page(600, content);
    expect(detectShift(production, staging, options)).toMatchObject({ deltaY: -30 });
  });

  it("returns nothing for identical images or a change that doesn't move the rest", () => {
    const production = page(600, content);
    expect(detectShift(production, page(600, content), options)).toBeUndefined();
    const edited = page(
      600,
      content.map((row, i) => (i === 3 ? { ...row, seed: 77 } : row)),
    );
    expect(detectShift(production, edited, options)).toBeUndefined();
  });
});
