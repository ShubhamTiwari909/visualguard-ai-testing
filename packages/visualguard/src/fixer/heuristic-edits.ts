import type { StyleDelta } from "../core/types.js";
import { countOccurrences, type Edit } from "./edits.js";
import type { SourceFile } from "./files.js";
import type { Clues } from "./locate.js";

/**
 * Fixes that need no AI: when a computed style changed and the source sets that property in an
 * obvious place, put production's value back. Handles CSS declarations and Tailwind utility
 * classes for common layout, spacing and colour properties. Anything ambiguous is left to the AI.
 */

const TAILWIND_KEYWORDS: Record<string, Record<string, string>> = {
  "align-items": {
    "flex-start": "items-start",
    start: "items-start",
    center: "items-center",
    "flex-end": "items-end",
    end: "items-end",
    baseline: "items-baseline",
    stretch: "items-stretch",
  },
  "justify-content": {
    "flex-start": "justify-start",
    start: "justify-start",
    center: "justify-center",
    "flex-end": "justify-end",
    end: "justify-end",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly",
  },
  "flex-direction": {
    row: "flex-row",
    column: "flex-col",
    "row-reverse": "flex-row-reverse",
    "column-reverse": "flex-col-reverse",
  },
  "text-align": {
    left: "text-left",
    center: "text-center",
    right: "text-right",
    justify: "text-justify",
    start: "text-start",
    end: "text-end",
  },
  "font-weight": {
    "300": "font-light",
    "400": "font-normal",
    "500": "font-medium",
    "600": "font-semibold",
    "700": "font-bold",
    "800": "font-extrabold",
  },
  display: {
    none: "hidden",
    block: "block",
    flex: "flex",
    grid: "grid",
    "inline-flex": "inline-flex",
    "inline-block": "inline-block",
  },
  "flex-wrap": { wrap: "flex-wrap", nowrap: "flex-nowrap" },
};

const SPACING_PREFIX: Record<string, string> = {
  "padding-top": "pt",
  "padding-right": "pr",
  "padding-bottom": "pb",
  "padding-left": "pl",
  "margin-top": "mt",
  "margin-right": "mr",
  "margin-bottom": "mb",
  "margin-left": "ml",
  "row-gap": "gap-y",
  "column-gap": "gap-x",
};

/** 24px → "6", 2px → "0.5", 0px → "0"; undefined when not on the Tailwind spacing scale. */
function spacingScale(value: string): string | undefined {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!match) return undefined;
  const units = Number(match[1]) / 4;
  if (units === 0) return "0";
  return Number.isInteger(units * 2) ? String(Math.abs(units)) : undefined;
}

function hex(value: string): string | undefined {
  const match = value.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)/);
  if (!match || (match[4] !== undefined && match[4] !== "1")) return undefined;
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}

/** Ways a computed value may be written in a stylesheet. */
function sourceForms(value: string): string[] {
  const forms = new Set([value]);
  const asHex = hex(value);
  if (asHex) {
    forms.add(asHex);
    forms.add(asHex.toUpperCase());
    if (/^#(.)\1(.)\2(.)\3$/i.test(asHex)) forms.add(`#${asHex[1]}${asHex[3]}${asHex[5]}`);
  }
  return [...forms];
}

/** Converts production's computed value into the notation the source already uses. */
function inSameNotation(written: string, computed: string): string {
  if (written.startsWith("#")) {
    const asHex = hex(computed);
    if (asHex) return written === written.toUpperCase() ? asHex.toUpperCase() : asHex;
  }
  return computed;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Shorthands that set a computed longhand. */
const CSS_ALIASES: Record<string, string[]> = {
  "background-color": ["background-color", "background"],
  "border-top-color": ["border-top-color", "border-color", "border"],
};

/** `property: value` in CSS, scoped to rules whose selector mentions one of the element's classes. */
function cssEdit(delta: StyleDelta, files: SourceFile[], classTokens: string[]): Edit | undefined {
  const matches: Array<{
    file: SourceFile;
    declaration: string;
    written: string;
    selector: string;
  }> = [];
  const properties = CSS_ALIASES[delta.property] ?? [delta.property];
  for (const file of files) {
    for (const form of sourceForms(delta.staging)) {
      const names = properties.map(escapeRegExp).join("|");
      // (?<![\w-]) keeps "color" from matching inside "background-color".
      const pattern = new RegExp(
        `((?<![\\w-])(?:${names})\\s*:\\s*(?:[^;{}]*\\s)?)(${escapeRegExp(form)})(?![\\w-])([^;{}]*;?)`,
        "g",
      );
      for (const match of file.content.matchAll(pattern)) {
        const before = file.content.slice(0, match.index);
        const selector = before.slice(before.lastIndexOf("}") + 1, before.lastIndexOf("{")).trim();
        matches.push({ file, declaration: match[0], written: match[2]!, selector });
      }
    }
  }
  let scoped = matches;
  if (scoped.length > 1 && classTokens.length > 0) {
    scoped = matches.filter((match) =>
      classTokens.some((token) => match.selector.includes(`.${token}`)),
    );
  }
  if (scoped.length !== 1) return undefined;
  const [{ file, declaration, written }] = scoped as [(typeof matches)[number]];
  // Grow the search text to the whole line so it is unique in the file.
  const lineStart = file.content.lastIndexOf("\n", file.content.indexOf(declaration)) + 1;
  const lineEnd = file.content.indexOf(
    "\n",
    file.content.indexOf(declaration) + declaration.length,
  );
  const line = file.content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  if (countOccurrences(file.content, line) !== 1) return undefined;
  const restored = declaration.replace(written, inSameNotation(written, delta.production));
  return {
    file: file.path,
    search: line,
    replace: line.replace(declaration, restored),
    reason: `Restore ${delta.property}: ${delta.production} (staging has ${delta.staging})`,
  };
}

function tailwindToken(property: string, value: string): string | undefined {
  const keyword = TAILWIND_KEYWORDS[property]?.[value];
  if (keyword) return keyword;
  const prefix = SPACING_PREFIX[property];
  const scale = spacingScale(value);
  if (prefix && scale !== undefined) return `${value.startsWith("-") ? "-" : ""}${prefix}-${scale}`;
  return undefined;
}

/** Swaps a Tailwind class on the element's class list, found verbatim in the source. */
function tailwindEdit(
  deltas: StyleDelta[],
  files: SourceFile[],
  classList: string,
): Edit | undefined {
  const tokens = classList.split(/\s+/);
  let updated = [...tokens];
  const reasons: string[] = [];

  // Four equal padding/margin sides are usually one class (p-6), two equal sides px-/py-.
  const grouped = new Map<string, StyleDelta>();
  for (const delta of deltas) grouped.set(delta.property, delta);
  for (const base of ["padding", "margin"] as const) {
    const sides = ["top", "right", "bottom", "left"].map((side) => grouped.get(`${base}-${side}`));
    const short = base === "padding" ? "p" : "m";
    if (
      sides.every(
        (side) =>
          side && side.staging === sides[0]!.staging && side.production === sides[0]!.production,
      )
    ) {
      const from = spacingScale(sides[0]!.staging);
      const to = spacingScale(sides[0]!.production);
      const index = updated.indexOf(`${short}-${from}`);
      if (from !== undefined && to !== undefined && index >= 0) {
        updated[index] = `${short}-${to}`;
        reasons.push(`${base} ${sides[0]!.staging} → ${sides[0]!.production}`);
        for (const side of sides) grouped.delete(side!.property);
      }
    }
  }
  for (const delta of grouped.values()) {
    const from = tailwindToken(delta.property, delta.staging);
    const to = tailwindToken(delta.property, delta.production);
    if (!from || !to) continue;
    const index = updated.indexOf(from);
    if (index < 0) continue;
    updated[index] = to;
    reasons.push(`${delta.property} ${delta.staging} → ${delta.production}`);
  }
  if (reasons.length === 0) return undefined;
  updated = updated.filter(Boolean);

  const owners = files.filter((file) => countOccurrences(file.content, classList) === 1);
  if (owners.length !== 1) return undefined;
  return {
    file: owners[0]!.path,
    search: classList,
    replace: updated.join(" "),
    reason: `Restore ${reasons.join(", ")} (Tailwind classes)`,
  };
}

/** Four equal padding/margin sides become one `padding`/`margin` change (how CSS usually says it). */
function withShorthands(deltas: StyleDelta[]): StyleDelta[] {
  const result = [...deltas];
  for (const base of ["padding", "margin"]) {
    const sides = ["top", "right", "bottom", "left"].map((side) =>
      deltas.find((delta) => delta.property === `${base}-${side}`),
    );
    if (
      sides.every(
        (side) =>
          side && side.staging === sides[0]!.staging && side.production === sides[0]!.production,
      )
    ) {
      for (const side of sides) result.splice(result.indexOf(side!), 1);
      result.unshift({ ...sides[0]!, property: base });
    }
  }
  return result;
}

/**
 * When an element's class attribute changed, put production's classes back where the staging
 * class string is written verbatim. Small changes only, so unrelated elements aren't rewritten.
 */
function classListEdits(clues: Clues, files: SourceFile[]): Edit[] {
  const edits: Edit[] = [];
  for (const change of clues.classChanges) {
    const before = change.production.split(/\s+/);
    const after = change.staging.split(/\s+/);
    const removed = before.filter((token) => !after.includes(token));
    const added = after.filter((token) => !before.includes(token));
    if (removed.length + added.length === 0 || removed.length + added.length > 6) continue;
    const owners = files.filter((file) => countOccurrences(file.content, change.staging) === 1);
    if (owners.length !== 1) continue;
    if (edits.some((edit) => edit.file === owners[0]!.path && edit.search === change.staging))
      continue;
    edits.push({
      file: owners[0]!.path,
      search: change.staging,
      replace: change.production,
      reason: `Restore production's classes on ${change.selector} (${[...added.map((token) => `-${token}`), ...removed.map((token) => `+${token}`)].join(" ")})`,
    });
  }
  return edits;
}

/** Deterministic edits for the job's style changes, or [] when a model is needed. */
export function heuristicEdits(clues: Clues, files: SourceFile[]): Edit[] {
  const fromClasses = classListEdits(clues, files);
  if (fromClasses.length > 0) return fromClasses;
  if (clues.styles.length === 0) return [];
  const edits: Edit[] = [];
  const bySelector = new Map<string, StyleDelta[]>();
  for (const delta of clues.styles)
    bySelector.set(delta.selector, [...(bySelector.get(delta.selector) ?? []), delta]);

  for (const deltas of bySelector.values()) {
    let fixed = false;
    for (const classList of clues.classLists) {
      const edit = tailwindEdit(deltas, files, classList);
      if (edit) {
        edits.push(edit);
        fixed = true;
        break;
      }
    }
    if (fixed) continue;
    const classTokens = [
      ...new Set(clues.classLists.flatMap((classList) => classList.split(/\s+/))),
    ].filter(Boolean);
    for (const delta of withShorthands(deltas)) {
      const edit = cssEdit(delta, files, classTokens);
      if (
        edit &&
        !edits.some((existing) => existing.file === edit.file && existing.search === edit.search)
      )
        edits.push(edit);
    }
  }
  return edits;
}
