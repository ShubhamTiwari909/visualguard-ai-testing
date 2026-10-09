/**
 * @file PNG decode/encode/file I/O and RGBA image creation, padding and crop helpers.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Box } from "../core/types.js";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Decode PNG bytes into width, height and a flat RGBA pixel buffer. File reading is separate so
 * callers can also decode in-memory screenshots.
 */
export function decodePNG(buffer: Buffer): RGBAImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

/**
 * Read a PNG from disk and decode it into the shared Image shape. Filesystem or decoding errors
 * propagate to the capture/diff caller.
 */
export function readPNG(path: string): RGBAImage {
  return decodePNG(readFileSync(path));
}

/**
 * Encode an RGBA Image into PNG bytes. Preserve the typed array's offset and length when
 * creating the Buffer view so unrelated backing-array bytes are excluded.
 */
export function encodePNG(image: RGBAImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}

/**
 * Encode the image and write the resulting bytes to the requested path. The caller is
 * responsible for preparing its destination directory.
 */
export function writePNG(path: string, image: RGBAImage): void {
  writeFileSync(path, encodePNG(image));
}

/**
 * Allocate four bytes per pixel and optionally fill every pixel with one RGBA color. A
 * Uint8Array stores channel values as bytes and is initially zero-filled.
 */
export function createImage(
  width: number,
  height: number,
  fill?: readonly [number, number, number, number],
): RGBAImage {
  const data = new Uint8Array(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

/**
 * Pads an image to `width` × `height` with an opaque sentinel colour. Transparent padding would
 * look identical to a white page once pixelmatch blends alpha, hiding height differences.
 */
export const PAD_COLOR = [255, 0, 255, 255] as const;

/**
 * Place an image at the top-left of a larger white canvas. Copy rows using the destination
 * width because row offsets differ after padding.
 */
export function padImage(image: RGBAImage, width: number, height: number): RGBAImage {
  if (image.width === width && image.height === height) return image;
  const padded = createImage(width, height, PAD_COLOR);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y++) {
    padded.data.set(image.data.subarray(y * rowBytes, y * rowBytes + rowBytes), y * width * 4);
  }
  return padded;
}

/**
 * Crops `box` (clamped to the image) out of `image`.
 *
 * Copy a clamped rectangular portion into a new image buffer. Convert each source row to its
 * pixel-byte offset rather than assuming the crop is contiguous across rows.
 */
export function cropImage(image: RGBAImage, box: Box): RGBAImage {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(1, Math.min(image.width - x, Math.ceil(box.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.ceil(box.height)));
  const out = createImage(width, height);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 4;
    out.data.set(image.data.subarray(start, start + width * 4), row * width * 4);
  }
  return out;
}

/**
 * Grows `box` by `padding` on every side, clamped to `width` × `height`.
 *
 * Expand a rectangle by a margin and clamp it within the image bounds. This keeps model/report
 * crops from reading outside the screenshot.
 */
export function padBox(box: Box, padding: number, width: number, height: number): Box {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  return {
    x,
    y,
    width: Math.min(width, box.x + box.width + padding) - x,
    height: Math.min(height, box.y + box.height + padding) - y,
  };
}
