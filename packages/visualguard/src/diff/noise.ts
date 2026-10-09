/**
 * @file Builds changing-area masks from repeat captures, aligns them to DOM boxes and clears
 * ignored pixels.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Box } from "../core/types.js";
import { pixelmatchEngine } from "./compare.js";
import { padBox, type RGBAImage } from "./image.js";
import { extractRegions } from "./regions.js";

export interface NoiseOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
  /**
   * Skip the noise map when it would cover more than this share of the page.
   */
  maxRatio: number;
  /**
   * Grows each noisy area so anti-aliased edges around it are covered too.
   */
  padding?: number;
}

export interface NoiseMap {
  /**
   * Areas that differ between two loads of the same page.
   */
  boxes: Box[];
  /**
   * Share of the page the boxes cover.
   */
  ratio: number;
  /**
   * Why the map isn't used, when it isn't.
   */
  skipped?: string;
}

/**
 * Compares two captures of the same page: whatever differs between them changes on every load
 * (carousels, timestamps, ads, random content) and can't be blamed on a deploy.
 *
 * Compare repeated captures of the same page to identify areas that vary independently of a
 * deployment. Bound the ignored coverage so a broadly unstable page cannot have all its
 * evidence hidden.
 */
export function noiseMap(
  first: RGBAImage,
  again: RGBAImage,
  options: NoiseOptions,
  /**
   * Element boxes ([x, y, width, height]) from the first capture's DOM snapshot.
   */
  elements: ReadonlyArray<readonly [number, number, number, number]> = [],
): NoiseMap {
  if (first.width !== again.width || first.height !== again.height) {
    return {
      boxes: [],
      ratio: 0,
      skipped: `the page size changes between loads (${first.width}×${first.height} vs ${again.width}×${again.height})`,
    };
  }
  const { width, height } = first;
  const { diffPixels, mask } = pixelmatchEngine.compare(first, again, options);
  if (diffPixels === 0) return { boxes: [], ratio: 0 };

  const padding = options.padding ?? 8;
  const boxes = extractRegions(mask, width, height, {
    cellSize: 16,
    mergeDistance: 16,
    maxRegions: 50,
    minRegionPixels: 1,
  }).map((region) => padBox(snapToElement(region.box, elements), padding, width, height));
  const ratio = coveredPixels(boxes, width, height) / (width * height);
  if (ratio > options.maxRatio) {
    return {
      boxes,
      ratio,
      skipped: `${Math.round(ratio * 100)}% of the page changes between loads, more than diff.noiseMapMaxRatio`,
    };
  }
  return { boxes, ratio };
}

/**
 * Grows a noisy area to the element it sits in. Two loads can agree on part of a random value
 * ("$412" and "$498" share "$4"), and a third load can differ exactly there; covering the whole
 * element (the price) catches that. Elements much larger than the area are left alone, so a
 * blinking cursor doesn't swallow its whole section.
 *
 * Expand a noisy rectangle to a nearby suitably sized element when available. This covers an
 * entire changing value while avoiding expansion to a huge ancestor section.
 */
export function snapToElement(
  box: Box,
  elements: ReadonlyArray<readonly [number, number, number, number]>,
): Box {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const area = box.width * box.height;
  let best: readonly [number, number, number, number] | undefined;
  for (const element of elements) {
    const [x, y, w, h] = element;
    if (w <= 0 || h <= 0 || cx < x || cx > x + w || cy < y || cy > y + h) continue;
    if (w * h > area * 6 + 4096) continue;
    if (!best || w * h < best[2] * best[3]) best = element;
  }
  if (!best) return box;
  const x = Math.floor(Math.min(box.x, best[0]));
  const y = Math.floor(Math.min(box.y, best[1]));
  return {
    x,
    y,
    width: Math.ceil(Math.max(box.x + box.width, best[0] + best[2])) - x,
    height: Math.ceil(Math.max(box.y + box.height, best[1] + best[3])) - y,
  };
}

/**
 * Count the union of rectangles by filling a temporary binary mask. Overlapping boxes write the
 * same 1 values, so their intersection is not counted twice.
 */
function coveredPixels(boxes: readonly Box[], width: number, height: number): number {
  const covered = new Uint8Array(width * height);
  fillBoxes(covered, boxes, width, height);
  let count = 0;
  for (const value of covered) count += value;
  return count;
}

/**
 * Set mask entries inside each clamped rectangle to 1. A row-major mask stores position x/y at
 * y * width + x.
 */
function fillBoxes(target: Uint8Array, boxes: readonly Box[], width: number, height: number): void {
  for (const box of boxes) {
    const x1 = Math.min(width, box.x + box.width);
    const y1 = Math.min(height, box.y + box.height);
    for (let y = Math.max(0, box.y); y < y1; y++) {
      target.fill(1, y * width + Math.max(0, box.x), y * width + x1);
    }
  }
}

/**
 * Clears `mask` inside `boxes`. Returns how many differing pixels were cleared.
 *
 * Remove changed-mask entries covered by ignored rectangles and return the number removed. Only
 * count an entry the first time it changes from 1 to 0.
 */
export function clearBoxes(
  mask: Uint8Array,
  boxes: readonly Box[],
  width: number,
  height: number,
): number {
  let cleared = 0;
  for (const box of boxes) {
    const x1 = Math.min(width, box.x + box.width);
    const y1 = Math.min(height, box.y + box.height);
    for (let y = Math.max(0, box.y); y < y1; y++) {
      for (let p = y * width + Math.max(0, box.x), end = y * width + x1; p < end; p++) {
        if (mask[p]) {
          mask[p] = 0;
          cleared++;
        }
      }
    }
  }
  return cleared;
}
