import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import type { Box } from "../core/types.js";

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePNG(buffer: Buffer): RGBAImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function readPNG(path: string): RGBAImage {
  return decodePNG(readFileSync(path));
}

export function encodePNG(image: RGBAImage): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
  return PNG.sync.write(png);
}

export function writePNG(path: string, image: RGBAImage): void {
  writeFileSync(path, encodePNG(image));
}

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

export function padImage(image: RGBAImage, width: number, height: number): RGBAImage {
  if (image.width === width && image.height === height) return image;
  const padded = createImage(width, height, PAD_COLOR);
  const rowBytes = image.width * 4;
  for (let y = 0; y < image.height; y++) {
    padded.data.set(image.data.subarray(y * rowBytes, y * rowBytes + rowBytes), y * width * 4);
  }
  return padded;
}

/** Crops `box` (clamped to the image) out of `image`. */
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

/** Grows `box` by `padding` on every side, clamped to `width` × `height`. */
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
