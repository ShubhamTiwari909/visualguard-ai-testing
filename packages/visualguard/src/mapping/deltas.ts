import type { Box, Delta, ElementMatch, Env, StyleDelta } from "../core/types.js";
import { area, intersection, shiftBox, type DomIndex } from "./dom.js";
import type { TreeMatch } from "./match.js";

export interface MappingContext {
  production: DomIndex;
  staging: DomIndex;
  match: TreeMatch;
  shift?: { fromY: number; deltaY: number };
}

export interface RegionMapping {
  elements: ElementMatch[];
  deltas: Delta[];
}

/** Inherited properties: a change on a parent shows up on every descendant. */
const INHERITED = new Set([
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "white-space",
  "visibility",
]);

/**
 * Values that usually follow from other changes (text, padding, children) rather than being the
 * cause. Computed grid tracks are always resolved to pixels, so they change with their content.
 */
const DERIVED = new Set(["width", "height", "grid-template-columns", "grid-template-rows"]);

/** Properties that position or space things; their changes explain moved children. */
export const LAYOUT_PROPERTIES = new Set([
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "float",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-self",
  "align-content",
  "justify-content",
  "justify-items",
  "grid-template-columns",
  "grid-template-rows",
  "row-gap",
  "column-gap",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "transform",
  "z-index",
]);

const MAX_DELTAS = 16;
const MOVE_TOLERANCE = 1;

function styleDeltas(
  context: MappingContext,
  a: number,
  b: number,
  hasTextChange: boolean,
): StyleDelta[] {
  const before = context.production.style(a);
  const after = context.staging.style(b);
  const selector = context.staging.node(b).sel;
  const deltas: StyleDelta[] = [];
  for (const property of Object.keys(after)) {
    if (before[property] === after[property] || before[property] === undefined) continue;
    deltas.push({
      kind: "style",
      selector,
      property,
      production: before[property]!,
      staging: after[property]!,
    });
  }

  // An inherited change is reported once, on the element where it starts.
  const parentA = context.production.node(a).p;
  const parentB = context.staging.node(b).p;
  const parentMatched = parentA >= 0 && context.match.forward.get(parentA) === parentB;
  const filtered = deltas.filter((delta) => {
    if (!INHERITED.has(delta.property) || !parentMatched) return true;
    const pa = context.production.style(parentA)[delta.property];
    const pb = context.staging.style(parentB)[delta.property];
    return !(pa === delta.production && pb === delta.staging);
  });

  // Derived sizes are kept only when they are the whole story, and only on leaf elements:
  // a container's size changes whenever anything inside it does.
  const authored = filtered.filter((delta) => !DERIVED.has(delta.property));
  if (authored.length > 0 || hasTextChange || !context.staging.isLeaf(b)) return authored;
  return filtered.filter((delta) => delta.property === "width" || delta.property === "height");
}

function moved(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) > MOVE_TOLERANCE ||
    Math.abs(a.y - b.y) > MOVE_TOLERANCE ||
    Math.abs(a.width - b.width) > MOVE_TOLERANCE ||
    Math.abs(a.height - b.height) > MOVE_TOLERANCE
  );
}

/** Nodes worth inspecting for a region: they overlap it and are not page-sized containers. */
function candidates(dom: DomIndex, region: Box, adjust: (box: Box) => Box): number[] {
  const regionArea = Math.max(1, area(region));
  const result: number[] = [];
  for (const node of dom.nodes) {
    const box = adjust(dom.box(node.i));
    const overlap = intersection(box, region);
    if (overlap === 0) continue;
    const boxArea = Math.max(1, area(box));
    if (boxArea <= regionArea * 25 || overlap / boxArea >= 0.5 || dom.isLeaf(node.i))
      result.push(node.i);
  }
  return result;
}

const DELTA_PRIORITY: Record<Delta["kind"], number> = { presence: 0, text: 1, style: 2, box: 3 };

function stylePriority(delta: Delta): number {
  if (delta.kind !== "style") return 0;
  return LAYOUT_PROPERTIES.has(delta.property) ? 0 : DERIVED.has(delta.property) ? 2 : 1;
}

/**
 * Maps one changed region to the elements under it and what changed about them (PLAN.md §9.2):
 * added/removed elements, text, computed styles and position/size.
 */
export function mapRegion(context: MappingContext, region: Box): RegionMapping {
  const { production, staging, match, shift } = context;
  const deltas: Delta[] = [];
  const seen = new Set<string>();
  const push = (delta: Delta) => {
    const key = JSON.stringify(delta);
    if (seen.has(key)) return;
    seen.add(key);
    deltas.push(delta);
  };

  const stagingNodes = candidates(staging, region, (box) => box);
  const productionNodes = candidates(production, region, (box) => shiftBox(box, shift));
  const inspected = new Set<number>();

  const inspectPair = (a: number, b: number) => {
    if (inspected.has(b)) return;
    inspected.add(b);
    const nodeA = production.node(a);
    const nodeB = staging.node(b);
    const textChanged = (nodeA.text ?? "") !== (nodeB.text ?? "");
    if (textChanged) {
      push({
        kind: "text",
        selector: nodeB.sel,
        production: nodeA.text ?? "",
        staging: nodeB.text ?? "",
      });
    }
    const styles = styleDeltas(context, a, b, textChanged);
    for (const delta of styles) push(delta);
    const boxA = shiftBox(production.box(a), shift);
    const boxB = staging.box(b);
    if (
      staging.isAtomic(b) &&
      nodeB.tag !== "body" &&
      moved(boxA, boxB) &&
      styles.length === 0 &&
      !textChanged
    ) {
      push({ kind: "box", selector: nodeB.sel, production: production.box(a), staging: boxB });
    }
    return styles.length > 0 || textChanged || moved(boxA, boxB);
  };

  for (const b of stagingNodes) {
    const a = match.backward.get(b);
    if (a === undefined) {
      // Report an added subtree once, at its root.
      const parent = staging.node(b).p;
      if (parent < 0 || match.backward.has(parent))
        push({ kind: "presence", selector: staging.node(b).sel, presentIn: "staging" });
      continue;
    }
    const changed = inspectPair(a, b);
    // A moved element is often explained by its container's layout: check a few ancestors.
    if (changed) {
      let ancestorB = staging.node(b).p;
      for (let depth = 0; depth < 3 && ancestorB > 0; depth++) {
        const ancestorA = match.backward.get(ancestorB);
        if (ancestorA !== undefined) {
          for (const delta of styleDeltas(context, ancestorA, ancestorB, false)) {
            if (LAYOUT_PROPERTIES.has(delta.property)) push(delta);
          }
        }
        ancestorB = staging.node(ancestorB).p;
      }
    }
  }

  for (const a of productionNodes) {
    const b = match.forward.get(a);
    if (b !== undefined) {
      // Content that moved away from this region on staging.
      inspectPair(a, b);
      continue;
    }
    const parent = production.node(a).p;
    if (parent < 0 || match.forward.has(parent))
      push({ kind: "presence", selector: production.node(a).sel, presentIn: "production" });
  }

  deltas.sort(
    (x, y) =>
      DELTA_PRIORITY[x.kind] - DELTA_PRIORITY[y.kind] || stylePriority(x) - stylePriority(y),
  );

  return {
    elements: regionElements(context, region, stagingNodes, productionNodes),
    deltas: deltas.slice(0, MAX_DELTAS),
  };
}

/** The elements that best describe a region: small, mostly inside it, and covering it. */
function regionElements(
  context: MappingContext,
  region: Box,
  stagingNodes: number[],
  productionNodes: number[],
): ElementMatch[] {
  const regionArea = Math.max(1, area(region));
  const scored: Array<{ env: Env; index: number; score: number }> = [];
  const score = (box: Box) => {
    const overlap = intersection(box, region);
    return (overlap / regionArea) * (overlap / Math.max(1, area(box)));
  };
  for (const index of stagingNodes)
    scored.push({ env: "staging", index, score: score(context.staging.box(index)) });
  for (const index of productionNodes) {
    if (!context.match.forward.has(index)) {
      scored.push({
        env: "production",
        index,
        score: score(shiftBox(context.production.box(index), context.shift)),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map(({ env, index }) => {
    const dom = env === "staging" ? context.staging : context.production;
    const node = dom.node(index);
    const counterpartIndex = env === "staging" ? context.match.backward.get(index) : undefined;
    return {
      selector: node.sel,
      tag: node.tag,
      text: node.text ?? node.name,
      component: node.comp,
      counterpart:
        counterpartIndex !== undefined ? context.production.node(counterpartIndex).sel : undefined,
      box: dom.box(index),
    };
  });
}
