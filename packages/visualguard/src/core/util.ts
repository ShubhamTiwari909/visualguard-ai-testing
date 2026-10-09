/**
 * @file Small shared helpers for timeouts, durations, pluralization and PNG dimensions.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

/**
 * Return a Promise that resolves after the requested milliseconds. The timer yields control to
 * Node.js; it does not block the thread like a synchronous pause.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves to the promise's value, or `fallback` after `ms`. Never rejects on timeout.
 *
 * Race an operation against a timer that resolves to the fallback value and clear the timer
 * afterward. This does not cancel the original operation, and an early rejection from that
 * operation still propagates.
 */
export async function withTimeout<T, F>(
  promise: Promise<T>,
  ms: number,
  fallback: F,
): Promise<T | F> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Format milliseconds as ms, seconds or minutes for terminal/report labels. Stored timings
 * remain numbers; this helper only produces display text.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/**
 * Combine a count with the singular label only for exactly one item. The optional plural
 * supports irregular words; otherwise append s.
 */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Reads width and height from a PNG's IHDR chunk without decoding it.
 *
 * Read width/height from fixed offsets in the PNG IHDR header after a minimal header check.
 * Big-endian reads match the PNG byte format and avoid decoding all pixels.
 */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Not a PNG buffer");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
