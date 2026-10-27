/**
 * @file Generates the binary fixture assets used by the stabilization fixture pages: a small
 * block-glyph TrueType font and a short WebM clip.
 *
 * This is a repository-support script run by Node.js, outside the published package API. It
 * writes identical copies into fixtures/site/production and fixtures/site/staging. The font is
 * built from scratch, so it carries no third-party license. The clip needs ffmpeg with libvpx.
 *
 *   node scripts/make-fixture-assets.mjs
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SITE = resolve(import.meta.dirname, "../fixtures/site");
const FIRST = 0x20;
const LAST = 0x7e;
const UNITS = 1000;

/**
 * Advance width for a character code. Widths differ from common fallback fonts on purpose, so a
 * capture taken before the font loads has a visibly different layout.
 */
const advance = (code) => (code === 0x20 ? 400 : 560 + (code % 4) * 90);

/**
 * One rectangular contour from (x0, y0) to (x1, y1), as on-curve points in TrueType order.
 */
const rect = (x0, y0, x1, y1) => [
  [x0, y0],
  [x0, y1],
  [x1, y1],
  [x1, y0],
];

/**
 * A simple glyph: lowercase letters are short blocks, other printable characters tall ones,
 * each with a hollow centre so text stays readable as shapes.
 */
function glyphContours(code) {
  if (code === 0x20) return [];
  const width = advance(code);
  const top = code >= 0x61 && code <= 0x7a ? 500 : 700;
  return [rect(60, 0, width - 60, top), rect(140, 80, width - 140, top - 80).reverse()];
}

/**
 * Encode one simple glyph with 16-bit coordinate deltas and on-curve flags only.
 */
function encodeGlyph(contours) {
  if (contours.length === 0) return Buffer.alloc(0);
  const points = contours.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const parts = [];
  const header = Buffer.alloc(10);
  header.writeInt16BE(contours.length, 0);
  header.writeInt16BE(Math.min(...xs), 2);
  header.writeInt16BE(Math.min(...ys), 4);
  header.writeInt16BE(Math.max(...xs), 6);
  header.writeInt16BE(Math.max(...ys), 8);
  parts.push(header);
  const ends = Buffer.alloc(contours.length * 2);
  let end = -1;
  contours.forEach((contour, index) => ends.writeUInt16BE((end += contour.length), index * 2));
  parts.push(ends, Buffer.from([0, 0])); // no instructions
  parts.push(Buffer.alloc(points.length, 0x01));
  const coords = Buffer.alloc(points.length * 4);
  let previousX = 0;
  let previousY = 0;
  points.forEach(([x, y], index) => {
    coords.writeInt16BE(x - previousX, index * 2);
    coords.writeInt16BE(y - previousY, points.length * 2 + index * 2);
    previousX = x;
    previousY = y;
  });
  parts.push(coords);
  const glyph = Buffer.concat(parts);
  return Buffer.concat([glyph, Buffer.alloc((4 - (glyph.length % 4)) % 4)]);
}

/**
 * Build a minimal TrueType font: .notdef plus every printable ASCII character.
 */
function buildFont(family) {
  const codes = Array.from({ length: LAST - FIRST + 1 }, (_, index) => FIRST + index);
  const glyphs = [rect(50, 0, 450, 700), ...codes.map(glyphContours)].map((contours, index) =>
    index === 0 ? encodeGlyph([contours]) : encodeGlyph(contours),
  );
  const widths = [500, ...codes.map(advance)];
  const numGlyphs = glyphs.length;

  const glyf = Buffer.concat(glyphs);
  const loca = Buffer.alloc((numGlyphs + 1) * 4);
  let offset = 0;
  glyphs.forEach((glyph, index) => {
    loca.writeUInt32BE(offset, index * 4);
    offset += glyph.length;
  });
  loca.writeUInt32BE(offset, numGlyphs * 4);

  const hmtx = Buffer.alloc(numGlyphs * 4);
  widths.forEach((width, index) => {
    hmtx.writeUInt16BE(width, index * 4);
    hmtx.writeInt16BE(index === 0 || codes[index - 1] !== 0x20 ? 50 : 0, index * 4 + 2);
  });

  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x00010000, 0);
  head.writeUInt32BE(0x00010000, 4);
  head.writeUInt32BE(0x5f0f3cf5, 12);
  head.writeUInt16BE(0x000b, 16);
  head.writeUInt16BE(UNITS, 18);
  head.writeInt16BE(0, 36);
  head.writeInt16BE(0, 38);
  head.writeInt16BE(Math.max(...widths), 40);
  head.writeInt16BE(700, 42);
  head.writeUInt16BE(8, 46);
  head.writeInt16BE(2, 48);
  head.writeInt16BE(1, 50); // long loca offsets

  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x00010000, 0);
  hhea.writeInt16BE(800, 4);
  hhea.writeInt16BE(-200, 6);
  hhea.writeUInt16BE(Math.max(...widths), 10);
  hhea.writeInt16BE(1, 18);
  hhea.writeUInt16BE(numGlyphs, 34);

  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x00010000, 0);
  maxp.writeUInt16BE(numGlyphs, 4);
  maxp.writeUInt16BE(8, 6);
  maxp.writeUInt16BE(2, 8);
  maxp.writeUInt16BE(2, 14);

  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0);
  os2.writeInt16BE(Math.round(widths.reduce((sum, width) => sum + width, 0) / numGlyphs), 2);
  os2.writeUInt16BE(400, 4);
  os2.writeUInt16BE(5, 6);
  os2.writeUInt32BE(1, 42); // Basic Latin
  os2.write("VGFX", 58, "latin1");
  os2.writeUInt16BE(0x40, 62);
  os2.writeUInt16BE(FIRST, 64);
  os2.writeUInt16BE(LAST, 66);
  os2.writeInt16BE(800, 68);
  os2.writeInt16BE(-200, 70);
  os2.writeUInt16BE(800, 74);
  os2.writeUInt16BE(200, 76);
  os2.writeUInt32BE(1, 78);
  os2.writeInt16BE(500, 86);
  os2.writeInt16BE(700, 88);
  os2.writeUInt16BE(0x20, 92);
  os2.writeUInt16BE(1, 94);

  // cmap format 4 with one range of printable ASCII and the required 0xFFFF terminator.
  const segments = [
    { start: FIRST, end: LAST, delta: (1 - FIRST + 0x10000) % 0x10000 },
    { start: 0xffff, end: 0xffff, delta: 1 },
  ];
  const segX2 = segments.length * 2;
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segments.length));
  const subtable = Buffer.alloc(16 + segments.length * 8);
  subtable.writeUInt16BE(4, 0);
  subtable.writeUInt16BE(subtable.length, 2);
  subtable.writeUInt16BE(segX2, 6);
  subtable.writeUInt16BE(searchRange, 8);
  subtable.writeUInt16BE(Math.log2(searchRange / 2), 10);
  subtable.writeUInt16BE(segX2 - searchRange, 12);
  segments.forEach((segment, index) => {
    subtable.writeUInt16BE(segment.end, 14 + index * 2);
    subtable.writeUInt16BE(segment.start, 16 + segX2 + index * 2);
    subtable.writeUInt16BE(segment.delta, 16 + segX2 * 2 + index * 2);
  });
  const cmap = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 12]), subtable]);

  const strings = [
    [1, family],
    [2, "Regular"],
    [3, `${family} Regular`],
    [4, `${family} Regular`],
    [5, "Version 1.0"],
    [6, `${family.replace(/\s+/g, "")}-Regular`],
  ].map(([id, text]) => [id, Buffer.from(text, "utf16le").swap16()]);
  const records = Buffer.alloc(6 + strings.length * 12);
  records.writeUInt16BE(strings.length, 2);
  records.writeUInt16BE(records.length, 4);
  let stringOffset = 0;
  strings.forEach(([id, bytes], index) => {
    const base = 6 + index * 12;
    records.writeUInt16BE(3, base);
    records.writeUInt16BE(1, base + 2);
    records.writeUInt16BE(0x409, base + 4);
    records.writeUInt16BE(id, base + 6);
    records.writeUInt16BE(bytes.length, base + 8);
    records.writeUInt16BE(stringOffset, base + 10);
    stringOffset += bytes.length;
  });
  const name = Buffer.concat([records, ...strings.map(([, bytes]) => bytes)]);

  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0);

  return assemble({ "OS/2": os2, cmap, glyf, head, hhea, hmtx, loca, maxp, name, post });
}

/**
 * The sum of big-endian 32-bit words, padding the final word with zeros.
 */
function checksum(buffer) {
  const padded = Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);
  let sum = 0;
  for (let index = 0; index < padded.length; index += 4)
    sum = (sum + padded.readUInt32BE(index)) >>> 0;
  return sum;
}

/**
 * Write the sfnt table directory and tables, then set head.checkSumAdjustment.
 */
function assemble(tables) {
  const tags = Object.keys(tables).sort();
  const searchRange = 16 * 2 ** Math.floor(Math.log2(tags.length));
  const directory = Buffer.alloc(12 + tags.length * 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tags.length, 4);
  directory.writeUInt16BE(searchRange, 6);
  directory.writeUInt16BE(Math.log2(searchRange / 16), 8);
  directory.writeUInt16BE(tags.length * 16 - searchRange, 10);
  const bodies = [];
  let offset = directory.length;
  let headOffset = 0;
  tags.forEach((tag, index) => {
    const table = tables[tag];
    const base = 12 + index * 16;
    directory.write(tag.padEnd(4), base, "latin1");
    directory.writeUInt32BE(checksum(table), base + 4);
    directory.writeUInt32BE(offset, base + 8);
    directory.writeUInt32BE(table.length, base + 12);
    if (tag === "head") headOffset = offset;
    const padded = Buffer.concat([table, Buffer.alloc((4 - (table.length % 4)) % 4)]);
    bodies.push(padded);
    offset += padded.length;
  });
  const font = Buffer.concat([directory, ...bodies]);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}

const font = buildFont("VisualGuard Fixture");
const clip = join(SITE, "production", "clip.webm");
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=320x180:rate=10:duration=3",
  "-c:v",
  "libvpx",
  "-b:v",
  "60k",
  "-an",
  clip,
]);
for (const variant of ["production", "staging"]) {
  writeFileSync(join(SITE, variant, "fixture-font.ttf"), font);
  if (variant !== "production") copyFileSync(clip, join(SITE, variant, "clip.webm"));
}
console.log(`Wrote fixture-font.ttf (${font.length} bytes) and clip.webm`);
