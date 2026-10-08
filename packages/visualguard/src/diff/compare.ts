import pixelmatch from "pixelmatch";
import { createImage, type RGBAImage } from "./image.js";

export interface CompareOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
}

export interface CompareResult {
  diffPixels: number;
  /** One byte per pixel, 1 where the images differ. */
  mask: Uint8Array;
}

/** Pluggable diff engine (PLAN.md §5.6). */
export interface DiffEngine {
  name: string;
  compare(a: RGBAImage, b: RGBAImage, options: CompareOptions): CompareResult;
}

const DIFF_COLOR: [number, number, number] = [255, 0, 0];
const AA_COLOR: [number, number, number] = [255, 255, 0];

export const pixelmatchEngine: DiffEngine = {
  name: "pixelmatch",
  compare(a, b, options) {
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error("compare() needs images of the same size; normalise them first");
    }
    const { width, height } = a;
    const output = new Uint8Array(width * height * 4);
    const diffPixels = pixelmatch(a.data, b.data, output, width, height, {
      threshold: options.threshold,
      includeAA: !options.ignoreAntialiasing,
      diffMask: true,
      diffColor: DIFF_COLOR,
      aaColor: AA_COLOR,
    });

    // pixelmatch draws differing pixels in DIFF_COLOR on a transparent background; anti-aliased
    // pixels (ignored) are drawn in AA_COLOR and are left out of the mask.
    const mask = new Uint8Array(width * height);
    if (diffPixels > 0) {
      for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
        if (output[i + 3]! > 0 && output[i] === 255 && output[i + 1] === 0 && output[i + 2] === 0) {
          mask[p] = 1;
        }
      }
    }
    return { diffPixels, mask };
  },
};

/** A dimmed greyscale copy of `base` with differing pixels drawn in red. */
export function renderDiffImage(base: RGBAImage, mask: Uint8Array): RGBAImage {
  const out = createImage(base.width, base.height);
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    if (mask[p]) {
      out.data[i] = 255;
      out.data[i + 1] = 0;
      out.data[i + 2] = 64;
    } else {
      const grey = 0.299 * base.data[i]! + 0.587 * base.data[i + 1]! + 0.114 * base.data[i + 2]!;
      const dimmed = 255 - (255 - grey) * 0.25;
      out.data[i] = dimmed;
      out.data[i + 1] = dimmed;
      out.data[i + 2] = dimmed;
    }
    out.data[i + 3] = 255;
  }
  return out;
}
