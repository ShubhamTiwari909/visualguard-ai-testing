import type { Box } from "../core/types.js";
import { pixelmatchEngine } from "./compare.js";
import { padBox, type RGBAImage } from "./image.js";
import { extractRegions } from "./regions.js";

export interface NoiseOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
  /** Skip the noise map when it would cover more than this share of the page. */
  maxRatio: number;
  /** Grows each noisy area so anti-aliased edges around it are covered too. */
  padding?: number;
}

export interface NoiseMap {
  /** Areas that differ between two loads of the same page. */
  boxes: Box[];
  /** Share of the page the boxes cover. */
  ratio: number;
  /** Why the map isn't used, when it isn't. */
  skipped?: string;
}

/**
 * Compares two captures of the same page: whatever differs between them changes on
 * every load (carousels, timestamps, ads, random content) and can't be blamed on a deploy.
 */
export function noiseMap(
  first: RGBAImage,
  again: RGBAImage,
  options: NoiseOptions,
  /** Element boxes ([x, y, width, height]) from the first capture's DOM snapshot. */
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

function coveredPixels(boxes: readonly Box[], width: number, height: number): number {
  const covered = new Uint8Array(width * height);
  fillBoxes(covered, boxes, width, height);
  let count = 0;
  for (const value of covered) count += value;
  return count;
}

function fillBoxes(target: Uint8Array, boxes: readonly Box[], width: number, height: number): void {
  for (const box of boxes) {
    const x1 = Math.min(width, box.x + box.width);
    const y1 = Math.min(height, box.y + box.height);
    for (let y = Math.max(0, box.y); y < y1; y++) {
      target.fill(1, y * width + Math.max(0, box.x), y * width + x1);
    }
  }
}

/** Clears `mask` inside `boxes`. Returns how many differing pixels were cleared. */
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
