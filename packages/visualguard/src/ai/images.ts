/**
 * @file Prepares/resizes/composites PNG images for provider image limits and request payloads.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { createImage, encodePNG, readPNG, type RGBAImage } from "../diff/image.js";

/**
 * Box-filter downscale so the longest side is at most `maxSide` (never upscales).
 *
 * Reduce an RGBA image by averaging source pixels for each output pixel. Four consecutive bytes
 * store red, green, blue and alpha; averaging avoids choosing a single noisy source pixel.
 */
export function downscale(image: RGBAImage, maxSide: number): RGBAImage {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale >= 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const out = createImage(width, height);
  const stepX = image.width / width;
  const stepY = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * stepY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * stepY));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * stepX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * stepX));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * image.width + sx) * 4;
          r += image.data[i]!;
          g += image.data[i + 1]!;
          b += image.data[i + 2]!;
          a += image.data[i + 3]!;
          count++;
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = r / count;
      out.data[o + 1] = g / count;
      out.data[o + 2] = b / count;
      out.data[o + 3] = a / count;
    }
  }
  return out;
}

/**
 * Places images side by side on white with a gap, top-aligned.
 *
 * Copy images into one white RGBA canvas with gaps between them. Each row is copied at an x
 * offset, leaving shorter images top-aligned.
 */
export function sideBySide(images: RGBAImage[], gap = 16): RGBAImage {
  const width = images.reduce((sum, image) => sum + image.width, 0) + gap * (images.length - 1);
  const height = Math.max(...images.map((image) => image.height));
  const out = createImage(width, height, [255, 255, 255, 255]);
  let offset = 0;
  for (const image of images) {
    for (let y = 0; y < image.height; y++) {
      out.data.set(
        image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
        (y * width + offset) * 4,
      );
    }
    offset += image.width + gap;
  }
  return out;
}

/**
 * Reads a PNG and returns a smaller PNG buffer for sending to a model.
 *
 * Read an image file, reduce its longest side if necessary and encode it back to PNG bytes.
 * Smaller model inputs reduce payload size without enlarging small screenshots.
 */
export function preparedPNG(path: string, maxSide: number): Buffer {
  return encodePNG(downscale(readPNG(path), maxSide));
}

/**
 * Combine several screenshot files into one side-by-side PNG and then resize it. This gives
 * providers with limited image inputs one image containing the comparison.
 */
export function compositePNG(paths: string[], maxSide: number): Buffer {
  return encodePNG(downscale(sideBySide(paths.map((path) => readPNG(path))), maxSide));
}
