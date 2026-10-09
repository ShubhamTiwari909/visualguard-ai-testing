/**
 * @file Groups changed pixel cells into nearby/merged bounding regions and limits/sorts the
 * result.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Box } from "../core/types.js";

export interface RegionOptions {
  cellSize: number;
  mergeDistance: number;
  maxRegions: number;
  /**
   * A cell counts as changed when it has at least this many differing pixels.
   */
  minCellPixels?: number;
  /**
   * Regions with fewer differing pixels are dropped.
   */
  minRegionPixels?: number;
}

export interface Region {
  box: Box;
  diffPixels: number;
}

/**
 * Groups differing pixels into regions (PLAN.md §8.1 step 5): bucket the mask into a grid,
 * label 8-connected changed cells, merge nearby boxes, drop tiny ones, keep the largest.
 *
 * Group changed pixels into grid cells, join neighboring changed cells and produce bounded
 * rectangles. Filter tiny regions and keep the largest so reports and AI prompts stay
 * manageable.
 */
export function extractRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  options: RegionOptions,
): Region[] {
  const { cellSize } = options;
  const minCellPixels = options.minCellPixels ?? 1;
  const minRegionPixels = options.minRegionPixels ?? 4;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  // Per cell: number of differing pixels and their tight bounds.
  const counts = new Uint32Array(cols * rows);
  const cellMinX = new Int32Array(cols * rows).fill(width);
  const cellMinY = new Int32Array(cols * rows).fill(height);
  const cellMaxX = new Int32Array(cols * rows).fill(-1);
  const cellMaxY = new Int32Array(cols * rows).fill(-1);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    const cellRow = Math.floor(y / cellSize) * cols;
    for (let x = 0; x < width; x++) {
      if (!mask[rowOffset + x]) continue;
      const cell = cellRow + Math.floor(x / cellSize);
      counts[cell]!++;
      if (x < cellMinX[cell]!) cellMinX[cell] = x;
      if (x > cellMaxX[cell]!) cellMaxX[cell] = x;
      if (y < cellMinY[cell]!) cellMinY[cell] = y;
      if (y > cellMaxY[cell]!) cellMaxY[cell] = y;
    }
  }

  // Connected components over changed cells. Cells within `mergeDistance` of each other are
  // linked directly, so nearby changes merge in linear time instead of pairwise box merging.
  const reach = 1 + Math.ceil(options.mergeDistance / cellSize);
  const labels = new Int32Array(cols * rows).fill(-1);
  // Component bounds are in pixels (tight around the differing pixels).
  const components: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    pixels: number;
  }> = [];
  const stack: number[] = [];

  for (let start = 0; start < counts.length; start++) {
    if (counts[start]! < minCellPixels || labels[start] !== -1) continue;
    const label = components.length;
    const component = { minX: width, minY: height, maxX: -1, maxY: -1, pixels: 0 };
    components.push(component);
    labels[start] = label;
    stack.push(start);

    while (stack.length > 0) {
      const cell = stack.pop()!;
      const cx = cell % cols;
      const cy = (cell - cx) / cols;
      component.minX = Math.min(component.minX, cellMinX[cell]!);
      component.minY = Math.min(component.minY, cellMinY[cell]!);
      component.maxX = Math.max(component.maxX, cellMaxX[cell]!);
      component.maxY = Math.max(component.maxY, cellMaxY[cell]!);
      component.pixels += counts[cell]!;

      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = ny * cols + nx;
          if (labels[neighbour] !== -1 || counts[neighbour]! < minCellPixels) continue;
          labels[neighbour] = label;
          stack.push(neighbour);
        }
      }
    }
  }

  let regions: Region[] = components.map((c) => ({
    box: { x: c.minX, y: c.minY, width: c.maxX - c.minX + 1, height: c.maxY - c.minY + 1 },
    diffPixels: c.pixels,
  }));

  // Bounding boxes of separate components can still overlap or touch; merge those. Very noisy
  // diffs are trimmed to the largest components first so this stays cheap.
  regions = regions.sort((a, b) => b.diffPixels - a.diffPixels).slice(0, 200);
  regions = mergeNearby(regions, options.mergeDistance);
  return regions
    .filter((region) => region.diffPixels >= minRegionPixels)
    .sort((a, b) => b.diffPixels - a.diffPixels || a.box.y - b.box.y)
    .slice(0, options.maxRegions);
}

/**
 * Measure the largest horizontal/vertical separation between rectangles. Overlapping intervals
 * have a gap of zero on that axis.
 */
function gap(a: Box, b: Box): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.max(dx, dy);
}

/**
 * Return the smallest rectangle that encloses both inputs. This creates new geometry without
 * changing either input box.
 */
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Repeatedly merges regions closer than `distance` until nothing changes.
 *
 * Repeatedly combine regions within the allowed gap until no pair merges. Copy the input
 * regions first and restart after a merge because the enlarged rectangle may reach another
 * neighbor.
 */
export function mergeNearby(regions: Region[], distance: number): Region[] {
  const result = regions.map((region) => ({ ...region, box: { ...region.box } }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (gap(result[i]!.box, result[j]!.box) <= distance) {
          result[i] = {
            box: union(result[i]!.box, result[j]!.box),
            diffPixels: result[i]!.diffPixels + result[j]!.diffPixels,
          };
          result.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return result;
}
