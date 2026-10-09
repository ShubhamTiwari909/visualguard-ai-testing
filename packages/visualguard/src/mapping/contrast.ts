/**
 * @file Parses colours and computes effective backgrounds and text contrast ratios for
 * readability findings.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { DomIndex } from "./dom.js";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * Parse the supported computed rgb/rgba color syntax into numeric channels and alpha. Return
 * undefined for unknown syntax so contrast checks do not invent a color.
 */
export function parseColor(value: string | undefined): RGBA | undefined {
  const match = value?.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
  if (!match) return undefined;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

/**
 * Convert RGB channels to linear-light values and combine them with perceptual weights. This
 * estimates brightness for the contrast-ratio calculation.
 */
function luminance({ r, g, b }: RGBA): number {
  /**
   * Normalize one 0–255 channel and apply the sRGB-to-linear transfer curve. The low-value
   * branch avoids applying the power curve where the linear segment is required.
   */
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two opaque colours (1–21).
 *
 * Calculate the light-to-dark relative-luminance ratio for two opaque colors. Sort luminances
 * first so the result does not depend on argument order.
 */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Blends a translucent colour over an opaque one.
 *
 * Composite a translucent foreground over an opaque background. Return an opaque result because
 * the bottom layer already provides full coverage.
 */
function over(top: RGBA, bottom: RGBA): RGBA {
  /**
   * Blend one color channel using the foreground alpha and the remaining background weight. The
   * same calculation is applied to red, green and blue.
   */
  const blend = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b), a: 1 };
}

/**
 * The colour behind an element: the nearest ancestor background, blended down to white.
 * Undefined when a background image is involved (the real colour is unknown).
 *
 * Walk element/ancestor backgrounds, then composite known layers over white. Return undefined
 * for background images because their pixel colors cannot be inferred from a CSS color value.
 */
export function effectiveBackground(dom: DomIndex, index: number): RGBA | undefined {
  const layers: RGBA[] = [];
  for (let current = index; current >= 0; current = dom.node(current).p) {
    const style = dom.style(current);
    if (style["background-image"] && style["background-image"] !== "none") return undefined;
    const color = parseColor(style["background-color"]);
    if (color && color.a > 0) {
      layers.push(color);
      if (color.a >= 1) break;
    }
  }
  return layers.reduceRight<RGBA>((below, layer) => over(layer, below), {
    r: 255,
    g: 255,
    b: 255,
    a: 1,
  });
}

/**
 * Contrast of an element's text against what's behind it.
 *
 * Composite the text color over its effective background and measure their contrast. Return
 * undefined when either color cannot be determined reliably.
 */
export function textContrast(dom: DomIndex, index: number): number | undefined {
  const background = effectiveBackground(dom, index);
  const color = parseColor(dom.style(index).color);
  if (!background || !color) return undefined;
  return contrastRatio(over(color, background), background);
}
