/**
 * @file Turns DOM deltas into concise explanations such as changed colour, spacing, text or
 * alignment.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Delta, StyleDelta } from "../core/types.js";
import { LAYOUT_PROPERTIES } from "./deltas.js";

/**
 * Clamp/round RGB channels and encode each as two hexadecimal digits. padStart preserves
 * leading zeros so the final value is always a complete hex color.
 */
const toHex = (channels: number[]) =>
  `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/**
 * Linear-light sRGB (0–1) → gamma-encoded 0–255.
 *
 * Convert one linear-light channel back to sRGB on the 0–255 scale. Use the linear segment for
 * dark values and the power curve for brighter values.
 */
const encode = (linear: number) =>
  255 *
  (linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(Math.max(0, linear), 1 / 2.4) - 0.055);

/**
 * OKLab → sRGB (Björn Ottosson's matrices).
 *
 * Convert OKLab coordinates into linear RGB using the defined matrices, then encode channels as
 * sRGB. Cubing reverses OKLab's intermediate cube-root transform.
 */
function oklabToRGB(l: number, a: number, b: number): number[] {
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ].map(encode);
}

/**
 * CIE Lab (D50, as CSS uses it) → sRGB via XYZ and Bradford adaptation to D65.
 *
 * Convert CSS CIE Lab through XYZ, adapt D50 to D65 and then produce sRGB channels. The
 * intermediate white-point adaptation is needed because the two color spaces use different
 * reference whites.
 */
function labToRGB(l: number, a: number, b: number): number[] {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  /**
   * Reverse the piecewise Lab intermediate transform for one channel. Use a cubic branch or a
   * linear branch according to its threshold.
   */
  const inverse = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const [x, y, z] = [
    0.96422 * inverse(fx),
    1 * (l > 8 ? fy ** 3 : l / (24389 / 27)),
    0.82521 * inverse(fz),
  ] as const;
  const [x65, y65, z65] = [
    0.9554734527 * x - 0.0230985369 * y + 0.0632593086 * z,
    -0.0283697594 * x + 1.009995458 * y + 0.021041399 * z,
    0.0123140017 * x - 0.0205076964 * y + 1.3303659366 * z,
  ];
  return [
    3.2409699419 * x65 - 1.5373831776 * y65 - 0.4986107603 * z65,
    -0.9692436363 * x65 + 1.8759675015 * y65 + 0.0415550574 * z65,
    0.0556300797 * x65 - 0.2039769589 * y65 + 1.0569715142 * z65,
  ].map(encode);
}

/**
 * Parse a color component, converting percentage notation into a fraction. parseFloat accepts
 * the numeric prefix while the suffix determines scaling.
 */
const number = (value: string) =>
  value.endsWith("%") ? Number.parseFloat(value) / 100 : Number.parseFloat(value);

/**
 * Makes computed CSS values readable: rgb()/lab()/oklch()/oklab() colours become hex (with any
 * alpha kept), and long decimals are rounded. Other values pass through.
 *
 * Turn supported computed color formats into readable hex text and shorten long decimals.
 * Preserve opacity information and leave unrecognized CSS text available in the output.
 */
export function formatValue(value: string): string {
  return value
    .replace(/\b(oklch|oklab|lab)\(\s*([^)]+)\)/g, (match, space: string, body: string) => {
      const [channels, alpha] = body.split("/").map((part) => part.trim());
      const [p1, p2, p3] = (channels ?? "").split(/\s+/);
      if (p1 === undefined || p2 === undefined || p3 === undefined) return match;
      let rgb: number[];
      if (space === "lab")
        rgb = labToRGB(number(p1) * (p1.endsWith("%") ? 100 : 1), number(p2), number(p3));
      else if (space === "oklab") rgb = oklabToRGB(number(p1), number(p2), number(p3));
      else {
        const hue = (Number.parseFloat(p3) * Math.PI) / 180;
        rgb = oklabToRGB(number(p1), number(p2) * Math.cos(hue), number(p2) * Math.sin(hue));
      }
      if (rgb.some((channel) => Number.isNaN(channel))) return match;
      return alpha && number(alpha) !== 1 ? `${toHex(rgb)} @ ${alpha}` : toHex(rgb);
    })
    .replace(
      /(\d+\.\d{2,})px/g,
      (_match, number: string) => `${Number(Number(number).toFixed(1))}px`,
    )
    .replace(
      /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/g,
      (_match, r: string, g: string, b: string, alpha: string | undefined) => {
        const hex = `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
        return alpha !== undefined && alpha !== "1" ? `${hex} @ ${alpha}` : hex;
      },
    );
}

/**
 * Wrap visible text in typographic quotes and shorten long strings. The ellipsis keeps a region
 * description to a manageable single-line label.
 */
const quote = (text: string) => `“${text.length > 50 ? `${text.slice(0, 49)}…` : text}”`;

const SIDES = ["top", "right", "bottom", "left"];

/**
 * Collapses padding-top/right/bottom/left (or margin) changes with the same values into one.
 *
 * Collapse compatible padding/margin side changes into a compact description. Track consumed
 * delta objects in a Set so the grouped and original entries are not both displayed.
 */
function groupSides(deltas: StyleDelta[]): StyleDelta[] {
  const result: StyleDelta[] = [];
  const used = new Set<StyleDelta>();
  for (const base of ["padding", "margin"]) {
    const sides = deltas.filter((delta) =>
      SIDES.some((side) => delta.property === `${base}-${side}`),
    );
    if (
      sides.length === 4 &&
      sides.every(
        (delta) => delta.production === sides[0]!.production && delta.staging === sides[0]!.staging,
      )
    ) {
      result.push({ ...sides[0]!, property: base });
      for (const delta of sides) used.add(delta);
    }
  }
  return [...result, ...deltas.filter((delta) => !used.has(delta))];
}

/**
 * Choose a plain-language label for one CSS property change and optional occurrence count.
 * Format the old/new values without changing the captured delta.
 */
function describeStyle(delta: StyleDelta, count: number): string {
  const subject = `${delta.selector}${count > 1 ? ` (×${count})` : ""}`;
  const change = `${delta.property} ${formatValue(delta.production)} → ${formatValue(delta.staging)}`;
  if (/^(align|justify|flex-direction|flex-wrap|float)/.test(delta.property))
    return `Alignment changed: ${change} on ${subject}`;
  if (/^(padding|margin|row-gap|column-gap)/.test(delta.property))
    return `Spacing changed: ${change} on ${subject}`;
  if (/color|background|border|box-shadow|opacity/.test(delta.property))
    return `Colour changed: ${change} on ${subject}`;
  if (/^(font|line-height|letter-spacing|text-|white-space)/.test(delta.property))
    return `Typography changed: ${change} on ${subject}`;
  if (/^(width|height|min-|max-)/.test(delta.property))
    return `Size changed: ${change} on ${subject}`;
  if (LAYOUT_PROPERTIES.has(delta.property)) return `Layout changed: ${change} on ${subject}`;
  return `Style changed: ${change} on ${subject}`;
}

/**
 * A one-line, plain-language description of a region's most important change (PLAN.md §9.2).
 *
 * Select a concise description of a region's most informative presence, text, style or movement
 * change. Return undefined when no supported delta explains it.
 */
export function describeDeltas(deltas: readonly Delta[]): string | undefined {
  const presence = deltas.find((delta) => delta.kind === "presence");
  if (presence?.kind === "presence") {
    return presence.presentIn === "staging"
      ? `New element: ${presence.selector}`
      : `Element removed or hidden: ${presence.selector}`;
  }

  const text = deltas.find((delta) => delta.kind === "text");
  if (text?.kind === "text") {
    if (!text.production) return `Text added to ${text.selector}: ${quote(text.staging)}`;
    if (!text.staging) return `Text removed from ${text.selector}: ${quote(text.production)}`;
    return `Text changed: ${quote(text.production)} → ${quote(text.staging)}`;
  }

  const styles = groupSides(deltas.filter((delta): delta is StyleDelta => delta.kind === "style"));
  if (styles.length > 0) {
    // The same change on several siblings (e.g. three cards) is described once.
    const first = styles[0]!;
    const count = styles.filter(
      (delta) =>
        delta.property === first.property &&
        delta.production === first.production &&
        delta.staging === first.staging,
    ).length;
    return describeStyle(first, count);
  }

  const box = deltas.find((delta) => delta.kind === "box");
  if (box?.kind === "box") {
    const dx = box.staging.x - box.production.x;
    const dy = box.staging.y - box.production.y;
    const resized =
      box.staging.width !== box.production.width || box.staging.height !== box.production.height;
    if (resized) {
      return `Resized: ${box.selector} ${box.production.width}×${box.production.height} → ${box.staging.width}×${box.staging.height}`;
    }
    const parts = [
      dy !== 0 ? `${Math.abs(dy)}px ${dy < 0 ? "up" : "down"}` : "",
      dx !== 0 ? `${Math.abs(dx)}px ${dx < 0 ? "left" : "right"}` : "",
    ].filter(Boolean);
    return `Moved ${parts.join(" and ")}: ${box.selector}`;
  }
  return undefined;
}
