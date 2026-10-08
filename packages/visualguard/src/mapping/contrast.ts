import type { DomIndex } from "./dom.js";

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

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

function luminance({ r, g, b }: RGBA): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours (1–21). */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Blends a translucent colour over an opaque one. */
function over(top: RGBA, bottom: RGBA): RGBA {
  const blend = (t: number, b: number) => t * top.a + b * (1 - top.a);
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b), a: 1 };
}

/**
 * The colour behind an element: the nearest ancestor background, blended down to white.
 * Undefined when a background image is involved (the real colour is unknown).
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

/** Contrast of an element's text against what's behind it. */
export function textContrast(dom: DomIndex, index: number): number | undefined {
  const background = effectiveBackground(dom, index);
  const color = parseColor(dom.style(index).color);
  if (!background || !color) return undefined;
  return contrastRatio(over(color, background), background);
}
