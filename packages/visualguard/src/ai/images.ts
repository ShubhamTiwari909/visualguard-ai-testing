import { createImage, encodePNG, readPNG, type RGBAImage } from "../diff/image.js";

/** Box-filter downscale so the longest side is at most `maxSide` (never upscales). */
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

/** Places images side by side on white with a gap, top-aligned. */
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

/** Reads a PNG and returns a smaller PNG buffer for sending to a model. */
export function preparedPNG(path: string, maxSide: number): Buffer {
  return encodePNG(downscale(readPNG(path), maxSide));
}

export function compositePNG(paths: string[], maxSide: number): Buffer {
  return encodePNG(downscale(sideBySide(paths.map((path) => readPNG(path))), maxSide));
}
