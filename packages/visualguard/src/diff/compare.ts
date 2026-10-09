/**
 * @file Pixelmatch engine adapter plus rendering of the visual difference image.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import pixelmatch from "pixelmatch";
import type { Box } from "../core/types.js";
import { createImage, type RGBAImage } from "./image.js";

export interface CompareOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
}

export interface CompareResult {
  diffPixels: number;
  /**
   * One byte per pixel, 1 where the images differ.
   */
  mask: Uint8Array;
}

/**
 * Pluggable diff engine (PLAN.md §5.6).
 */
export interface DiffEngine {
  name: string;
  compare(a: RGBAImage, b: RGBAImage, options: CompareOptions): CompareResult;
}

const DIFF_COLOR: [number, number, number] = [255, 0, 0];
const AA_COLOR: [number, number, number] = [255, 255, 0];

export const pixelmatchEngine: DiffEngine = {
  name: "pixelmatch",
  /**
   * Compare equal-sized RGBA images using the configured pixel/color threshold and anti-alias
   * policy. Return a changed-pixel count and a one-byte-per-pixel mask used by later region
   * extraction.
   */
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

/**
 * A dimmed greyscale copy of `base` with differing pixels drawn in red. A layout-shift `band`
 * (inserted or removed content) is tinted orange, and `ignored` areas (they change on every
 * load) blue.
 *
 * Create a dimmed grayscale screenshot with red changes, an orange shift band and blue ignored
 * areas. The mask indexes pixels, while image bytes use four-channel offsets.
 */
export function renderDiffImage(
  base: RGBAImage,
  mask: Uint8Array,
  band?: Box,
  ignored?: readonly Box[],
): RGBAImage {
  const out = createImage(base.width, base.height);
  const bandStart = band ? band.y * base.width : -1;
  const bandEnd = band ? (band.y + band.height) * base.width : -1;
  for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
    if (p >= bandStart && p < bandEnd && !mask[p]) {
      const grey = 0.299 * base.data[i]! + 0.587 * base.data[i + 1]! + 0.114 * base.data[i + 2]!;
      out.data[i] = 255;
      out.data[i + 1] = 140 + grey * 0.35;
      out.data[i + 2] = grey * 0.3;
      out.data[i + 3] = 255;
      continue;
    }
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
  for (const box of ignored ?? []) {
    const x1 = Math.min(base.width, box.x + box.width);
    const y1 = Math.min(base.height, box.y + box.height);
    for (let y = Math.max(0, box.y); y < y1; y++) {
      for (let x = Math.max(0, box.x); x < x1; x++) {
        const i = (y * base.width + x) * 4;
        out.data[i] = out.data[i]! * 0.6 + 59 * 0.4;
        out.data[i + 1] = out.data[i + 1]! * 0.6 + 130 * 0.4;
        out.data[i + 2] = out.data[i + 2]! * 0.6 + 246 * 0.4;
      }
    }
  }
  return out;
}
