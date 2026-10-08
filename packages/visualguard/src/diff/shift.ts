import pixelmatch from "pixelmatch";
import type { RGBAImage } from "./image.js";

export interface ShiftResult {
  /** First row (page coordinates) where content starts to be offset. */
  fromY: number;
  /** Positive: staging content moved down (something was inserted). Negative: moved up. */
  deltaY: number;
  /** Differences that remain after realigning, in staging coordinates (1 byte per pixel). */
  residualMask: Uint8Array;
  residualPixels: number;
  /** True when realigning removes most of the differences below the shifted band. */
  explainsBelow: boolean;
}

interface RowInfo {
  hash: Int32Array;
  /** Rows that are not a single flat colour; flat rows match at any offset, so they don't vote. */
  informative: Uint8Array;
}

function rowInfo(image: RGBAImage): RowInfo {
  const hash = new Int32Array(image.height);
  const informative = new Uint8Array(image.height);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y++) {
    let h = 0x811c9dc5 | 0;
    const start = y * rowBytes;
    const first =
      image.data[start]! | (image.data[start + 1]! << 8) | (image.data[start + 2]! << 16);
    let flat = true;
    for (let i = start; i < start + rowBytes; i += 4) {
      const pixel = image.data[i]! | (image.data[i + 1]! << 8) | (image.data[i + 2]! << 16);
      if (pixel !== first) flat = false;
      h = Math.imul(h ^ pixel, 0x01000193);
    }
    hash[y] = h;
    informative[y] = flat ? 0 : 1;
  }
  return { hash, informative };
}

/**
 * Detects a vertical layout shift (PLAN.md §8.1 step 6): when an element is inserted or removed,
 * everything below it moves, and a plain pixel diff marks the whole rest of the page as changed.
 * Rows are hashed; the offset that realigns the most informative rows wins, and the images are
 * diffed again with that offset to find what is left.
 */
export function detectShift(
  production: RGBAImage,
  staging: RGBAImage,
  options: { threshold: number; ignoreAntialiasing: boolean; maxShift?: number; minRows?: number },
  /** The plain pixel-diff mask, used to check that the shift explains the differences below it. */
  originalMask?: Uint8Array,
): ShiftResult | undefined {
  if (production.width !== staging.width || production.height !== staging.height) return undefined;
  const { width, height } = production;
  const maxShift = options.maxShift ?? Math.min(1_500, Math.floor(height / 2));
  const minRows = options.minRows ?? 12;
  const a = rowInfo(production);
  const b = rowInfo(staging);

  let firstDiff = 0;
  while (firstDiff < height && a.hash[firstDiff] === b.hash[firstDiff]) firstDiff++;
  if (firstDiff >= height) return undefined;

  // Vote for offsets: for each informative production row, where does the same row appear on staging?
  const rowsByHash = new Map<number, number[]>();
  for (let y = firstDiff; y < height; y++) {
    if (!b.informative[y]) continue;
    const list = rowsByHash.get(b.hash[y]!);
    if (list) {
      if (list.length < 8) list.push(y);
    } else {
      rowsByHash.set(b.hash[y]!, [y]);
    }
  }
  const votes = new Map<number, number>();
  let informativeRows = 0;
  for (let y = firstDiff; y < height; y++) {
    if (!a.informative[y]) continue;
    informativeRows++;
    for (const target of rowsByHash.get(a.hash[y]!) ?? []) {
      const delta = target - y;
      if (delta !== 0 && Math.abs(delta) <= maxShift) votes.set(delta, (votes.get(delta) ?? 0) + 1);
    }
  }
  let deltaY = 0;
  let best = 0;
  for (const [delta, count] of votes) {
    if (count > best || (count === best && Math.abs(delta) < Math.abs(deltaY))) {
      best = count;
      deltaY = delta;
    }
  }
  if (deltaY === 0 || best < Math.max(minRows, informativeRows * 0.15)) return undefined;

  // Production row y shows up on staging at y + deltaY once the shift has started.
  const aligned = (y: number) => {
    const target = y + deltaY;
    return target >= 0 && target < height && a.hash[y] === b.hash[target];
  };
  const keepsAligning = (start: number) => {
    let ok = 0;
    for (let y = start; y < height && ok < 8; y++) {
      if (!a.informative[y]) continue;
      if (!aligned(y)) return false;
      ok++;
    }
    return true;
  };
  let firstAligned = firstDiff;
  while (
    firstAligned < height &&
    !(a.informative[firstAligned] && aligned(firstAligned) && keepsAligning(firstAligned))
  ) {
    firstAligned++;
  }
  if (firstAligned >= height) return undefined;

  let fromY: number;
  if (deltaY > 0) {
    // Inserted content: extend upwards through rows (e.g. blank margins) that also line up.
    fromY = firstAligned;
    while (fromY > firstDiff && aligned(fromY - 1)) fromY--;
  } else {
    // Removed content: production rows [fromY, fromY - deltaY) are gone.
    fromY = Math.max(firstDiff, firstAligned + deltaY);
  }

  // A real shift moves everything below it: those rows must line up better at deltaY than in
  // place. Content that moved inside a fixed-height box (an alignment change) fails this check.
  let atDelta = 0;
  let inPlace = 0;
  for (let y = deltaY > 0 ? fromY : fromY - deltaY; y < height; y++) {
    if (!a.informative[y]) continue;
    if (aligned(y)) atDelta++;
    if (a.hash[y] === b.hash[y]) inPlace++;
  }
  if (atDelta <= inPlace) return undefined;

  // Residual differences: above fromY unshifted, below it realigned; in staging coordinates.
  const residualMask = new Uint8Array(width * height);
  let residualPixels = 0;
  const compareRows = (prodStart: number, stagingStart: number, rows: number) => {
    if (rows <= 0) return;
    const rowBytes = width * 4;
    const sliceA = production.data.subarray(prodStart * rowBytes, (prodStart + rows) * rowBytes);
    const sliceB = staging.data.subarray(stagingStart * rowBytes, (stagingStart + rows) * rowBytes);
    const output = new Uint8Array(rows * rowBytes);
    residualPixels += pixelmatch(sliceA, sliceB, output, width, rows, {
      threshold: options.threshold,
      includeAA: !options.ignoreAntialiasing,
      diffMask: true,
      diffColor: [255, 0, 0],
      aaColor: [255, 255, 0],
    });
    for (let p = 0; p < width * rows; p++) {
      const i = p * 4;
      if (output[i + 3]! > 0 && output[i] === 255 && output[i + 1] === 0)
        residualMask[stagingStart * width + p] = 1;
    }
  };

  compareRows(0, 0, fromY);
  if (deltaY > 0) {
    // Staging rows [fromY, fromY + deltaY) are new content; the rest lines up with production.
    compareRows(fromY, fromY + deltaY, height - fromY - deltaY);
  } else {
    // Production rows [fromY, fromY - deltaY) were removed.
    compareRows(fromY - deltaY, fromY, height - fromY + deltaY);
  }
  // Compare differences below the band before and after realigning (staging coordinates).
  const belowStart = (deltaY > 0 ? fromY + deltaY : fromY) * width;
  let before = 0;
  let after = 0;
  for (let p = belowStart; p < width * height; p++) {
    if (originalMask?.[p]) before++;
    if (residualMask[p]) after++;
  }
  const explainsBelow = originalMask ? before > 0 && after < before * 0.5 : true;
  return { fromY, deltaY, residualMask, residualPixels, explainsBelow };
}
