import type { Delta, StyleDelta } from "../core/types.js";
import { LAYOUT_PROPERTIES } from "./deltas.js";

/** rgb(37, 99, 235) → #2563eb; rgba with alpha keeps the alpha. Other values pass through. */
export function formatValue(value: string): string {
  return value
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

const quote = (text: string) => `“${text.length > 50 ? `${text.slice(0, 49)}…` : text}”`;

const SIDES = ["top", "right", "bottom", "left"];

/** Collapses padding-top/right/bottom/left (or margin) changes with the same values into one. */
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

/** A one-line, plain-language description of a region's most important change (PLAN.md §9.2). */
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
