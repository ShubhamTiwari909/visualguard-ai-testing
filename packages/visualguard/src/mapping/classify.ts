/**
 * @file Deterministic visual classifier: explains regions, finds removed
 * controls/readability/overlap problems and filters tiny noise.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { DomSnapshot } from "../capture/dom-snapshot.js";
import type { Box, Delta, DiffResult, Finding, RegionResult, Status } from "../core/types.js";
import { describeDeltas } from "./describe.js";
import { mapRegion, MAX_DELTAS } from "./deltas.js";
import { textContrast } from "./contrast.js";
import { area, DomIndex, intersection, shiftBox } from "./dom.js";
import { matchTrees, type TreeMatch } from "./match.js";

/**
 * Elements whose disappearance breaks a user flow.
 */
const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "form", "label"]);

/**
 * Differences this small, with no DOM change behind them, are treated as rendering noise.
 */
const NOISE_MAX_RATIO = 0.001;
const NOISE_MAX_REGION_AREA = 64 * 64;
/**
 * Sub-pixel position changes repaint anti-aliased edges across whole text blocks, so they get a
 * larger pixel budget than unexplained noise: two nudged paragraphs are about 1% of a phone
 * screen. Each region must also be small, or sparse and inside the moved elements.
 */
const SUBPIXEL_MAX_RATIO = 0.03;
/**
 * A changed region larger than NOISE_MAX_REGION_AREA still counts as sub-pixel noise when its
 * changed pixels are sparse, as repainted edges are (a nudged paragraph is a few percent), and
 * it stays within the moved elements. A real content change fills its area or reaches past them.
 */
const SUBPIXEL_MAX_DENSITY = 0.25;
const SUBPIXEL_EDGE_MARGIN = 2;
const SUBPIXEL_PROPERTIES = /^(transform|translate|left|top|right|bottom|inset|margin|padding)/;
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

export interface ClassifyInput {
  diff: DiffResult;
  regions: RegionResult[];
  production?: DomSnapshot;
  staging?: DomSnapshot;
}

export interface ClassifyOutput {
  /**
   * Status from the visual comparison alone; health findings are applied on top.
   */
  status: Extract<Status, "pass" | "review" | "regression">;
  findings: Finding[];
  regions: RegionResult[];
}

/**
 * Create a structured finding attributed to deterministic heuristics. Parentheses around the
 * object let an arrow function return it directly instead of opening a function block.
 */
const finding = (severity: Finding["severity"], message: string): Finding => ({
  severity,
  message,
  source: "heuristic",
});

/**
 * Explains a job's differences without AI (PLAN.md §9 and §10.4): maps every region to DOM
 * deltas, describes it, detects removed controls, new overlaps and layout shifts, and filters
 * rendering noise.
 *
 * Explain changed regions using matched DOM snapshots and deterministic heuristics. Identify
 * layout, presence, overlap and readability evidence before choosing pass/review/regression.
 */
export function classifyJob(input: ClassifyInput): ClassifyOutput {
  const { diff } = input;
  const findings: Finding[] = [];
  let regions = input.regions;
  let match: TreeMatch | undefined;
  let production: DomIndex | undefined;
  let staging: DomIndex | undefined;

  if (input.production && input.staging) {
    production = new DomIndex(input.production);
    staging = new DomIndex(input.staging);
    match = matchTrees(production, staging);
    const context = { production, staging, match, shift: diff.shift };
    regions = regions.map((region) => {
      const mapping = mapRegion(context, region.box);
      const heuristic =
        region.kind === "shift"
          ? describeShift(diff.shift!, describeDeltas(mapping.deltas))
          : describeDeltas(mapping.deltas);
      return { ...region, elements: mapping.elements, deltas: mapping.deltas, heuristic };
    });
  }

  const hasDeltas = regions.some((region) => region.deltas.length > 0);
  const subpixelOnly = hasDeltas && onlySubpixelMoves(regions);
  if (
    match &&
    (!hasDeltas || subpixelOnly) &&
    !diff.shift &&
    !diff.sizeMismatch &&
    diff.diffRatio <= (subpixelOnly ? SUBPIXEL_MAX_RATIO : NOISE_MAX_RATIO) &&
    regions.every(
      (region) =>
        area(region.box) <= NOISE_MAX_REGION_AREA ||
        (subpixelOnly && withinSubpixelMoves(region, staging)),
    )
  ) {
    const count = `${regions.length} tiny difference${regions.length === 1 ? "" : "s"}`;
    return {
      status: "pass",
      regions: regions.map((region) => ({
        ...region,
        heuristic: subpixelOnly
          ? "Rendering noise (sub-pixel position change)"
          : "Rendering noise (no DOM change)",
      })),
      findings: [
        finding(
          "info",
          subpixelOnly
            ? `${count} from a position change under 1px: treated as rendering noise`
            : `${count} with no DOM change: treated as rendering noise`,
        ),
      ],
    };
  }

  let status: ClassifyOutput["status"] = "review";

  if (production && staging && match) {
    // Removed or hidden controls.
    for (const region of regions) {
      for (const delta of region.deltas) {
        if (delta.kind !== "presence" || delta.presentIn !== "production") continue;
        const node = production.nodes.find(
          (candidate) => candidate.sel === delta.selector && !match!.forward.has(candidate.i),
        );
        if (node && INTERACTIVE.has(node.tag)) {
          findings.push(finding("regression", `${production.label(node.i)} is missing on staging`));
          status = "regression";
        }
      }
    }
    // Text that became hard to read, or got cut off.
    for (const message of readabilityProblems(production, staging, match, regions)) {
      findings.push(finding("regression", message));
      status = "regression";
    }
    // New overlaps between elements that changed and their neighbours.
    for (const message of newOverlaps(production, staging, match, regions, diff.shift)) {
      findings.push(finding("regression", message));
      status = "regression";
    }
  }

  if (diff.shift) {
    const band = regions.find((region) => region.kind === "shift");
    findings.push(finding("review", band?.heuristic ?? describeShift(diff.shift, undefined)));
  }

  const described = regions.find((region) => region.heuristic && region.kind !== "shift");
  if (described?.heuristic && !findings.some((item) => item.message === described.heuristic)) {
    findings.push(finding("review", described.heuristic));
  }
  if (match && !hasDeltas && !diff.shift) {
    findings.push(
      finding(
        "review",
        "Pixels changed with no DOM change: image, canvas, video or font rendering",
      ),
    );
  }

  // Regions without a DOM explanation still get a label.
  regions = regions.map((region) =>
    region.heuristic
      ? region
      : { ...region, heuristic: match ? "Pixels changed with no DOM change" : undefined },
  );
  return { status, findings, regions };
}

/**
 * How far a delta moves something, in CSS pixels, when moving is all it does: a 2D transform
 * translation, or a position/spacing length that differs only in px values. Undefined for any
 * other change, which is never treated as noise.
 */
export function subpixelShift(delta: Delta): number | undefined {
  if (delta.kind !== "style" || !SUBPIXEL_PROPERTIES.test(delta.property)) return undefined;
  if (delta.property === "transform") {
    const before = transformMatrix(delta.production);
    const after = transformMatrix(delta.staging);
    if (!before || !after) return undefined;
    if (!before.slice(0, 4).every((value, index) => Math.abs(value - after[index]!) < 1e-3))
      return undefined;
    return Math.hypot(before[4]! - after[4]!, before[5]! - after[5]!);
  }
  return pixelDistance(delta.production, delta.staging);
}

/**
 * True when a delta on its own moves something by more than zero and less than one CSS pixel.
 */
export function isSubpixelDelta(delta: Delta): boolean {
  const shift = subpixelShift(delta);
  return shift !== undefined && shift > 0 && shift < 1;
}

/**
 * True when every changed region is explained only by sub-pixel moves. Each region needs at
 * least one delta (an unexplained region is not covered), its delta list must be complete (a
 * truncated list could hide another change), and all moves of one element must add up to less
 * than one pixel, so `left` and `margin-left` cannot each move it 0.9px.
 */
export function onlySubpixelMoves(regions: readonly RegionResult[]): boolean {
  const moves = new Map<string, { selector: string; shift: number }>();
  for (const region of regions) {
    if (region.deltas.length === 0 || region.deltas.length >= MAX_DELTAS) return false;
    for (const delta of region.deltas) {
      if (!isSubpixelDelta(delta)) return false;
      // The same delta can be reported by overlapping regions; count it once.
      const property = delta.kind === "style" ? delta.property : delta.kind;
      moves.set(`${delta.selector}\n${property}`, {
        selector: delta.selector,
        shift: subpixelShift(delta)!,
      });
    }
  }
  const perElement = new Map<string, number>();
  for (const { selector, shift } of moves.values())
    perElement.set(selector, (perElement.get(selector) ?? 0) + shift);
  return [...perElement.values()].every((total) => total < 1);
}

/**
 * True when a large region is sparse and lies inside the elements whose sub-pixel moves explain
 * it: the bounds of the staging elements named by its deltas that overlap it, plus a small
 * margin for anti-aliasing.
 */
export function withinSubpixelMoves(region: RegionResult, staging: DomIndex | undefined): boolean {
  if (!staging || region.diffPixels > area(region.box) * SUBPIXEL_MAX_DENSITY) return false;
  const selectors = new Set(region.deltas.map((delta) => delta.selector));
  let bounds: Box | undefined;
  for (const node of staging.nodes) {
    if (!selectors.has(node.sel)) continue;
    const box = staging.box(node.i);
    if (intersection(box, region.box) === 0) continue;
    bounds = bounds
      ? {
          x: Math.min(bounds.x, box.x),
          y: Math.min(bounds.y, box.y),
          width: Math.max(bounds.x + bounds.width, box.x + box.width) - Math.min(bounds.x, box.x),
          height:
            Math.max(bounds.y + bounds.height, box.y + box.height) - Math.min(bounds.y, box.y),
        }
      : box;
  }
  if (!bounds) return false;
  const margin = SUBPIXEL_EDGE_MARGIN;
  return (
    region.box.x >= bounds.x - margin &&
    region.box.y >= bounds.y - margin &&
    region.box.x + region.box.width <= bounds.x + bounds.width + margin &&
    region.box.y + region.box.height <= bounds.y + bounds.height + margin
  );
}

/**
 * Parse a computed 2D transform ("none" or "matrix(a, b, c, d, e, f)") into six numbers.
 * Other forms, such as matrix3d, return undefined so they are never treated as noise.
 */
function transformMatrix(value: string): number[] | undefined {
  if (value === "none") return IDENTITY_MATRIX;
  const match = /^matrix\(([^)]*)\)$/.exec(value.trim());
  const numbers = match?.[1]!.split(",").map(Number);
  return numbers?.length === 6 && numbers.every(Number.isFinite) ? numbers : undefined;
}

/**
 * Total px distance between two computed values that are identical apart from px lengths.
 * Undefined when any other part differs. "none" for `translate` counts as a zero offset.
 */
function pixelDistance(production: string, staging: string): number | undefined {
  const tokens = (value: string) => (value === "none" ? "0px" : value).trim().split(/\s+/);
  const before = tokens(production);
  const after = tokens(staging);
  const length = Math.max(before.length, after.length);
  let distance = 0;
  for (let index = 0; index < length; index++) {
    // Computed `translate` drops trailing zero components ("4px" means "4px 0px").
    const a = before[index] ?? "0px";
    const b = after[index] ?? "0px";
    if (a === b) continue;
    const pixelsA = /^(-?[\d.]+)px$/.exec(a);
    const pixelsB = /^(-?[\d.]+)px$/.exec(b);
    if (!pixelsA || !pixelsB) return undefined;
    distance += Math.abs(Number(pixelsA[1]) - Number(pixelsB[1]));
  }
  return distance;
}

/**
 * Describe the direction and distance of a detected vertical shift, optionally including its
 * suspected cause. Positive deltaY means content moved down in staging.
 */
function describeShift(
  shift: { fromY: number; deltaY: number },
  cause: string | undefined,
): string {
  const direction = shift.deltaY > 0 ? "down" : "up";
  const base = `Content below y=${shift.fromY} moved ${Math.abs(shift.deltaY)}px ${direction}`;
  return cause ? `${cause}; ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
}

/**
 * Pairs of visible elements that overlap on staging but not on production, where at least one
 * of them changed. Ancestors and descendants are excluded (they overlap by definition).
 *
 * Find newly overlapping visible peers in changed areas after matching the snapshots. Exclude
 * ancestor/descendant pairs because their boxes naturally overlap.
 */
function newOverlaps(
  production: DomIndex,
  staging: DomIndex,
  match: TreeMatch,
  regions: RegionResult[],
  shift: { fromY: number; deltaY: number } | undefined,
): string[] {
  const changedSelectors = new Set(
    regions.flatMap((region) => region.deltas.map((delta) => delta.selector)),
  );
  /**
   * Check whether a box intersects at least one changed region. This local predicate restricts
   * overlap investigation to relevant screenshot areas.
   */
  const inRegions = (box: { x: number; y: number; width: number; height: number }) =>
    regions.some((region) => intersection(box, region.box) > 0);

  const content = staging.nodes.filter(
    (node) => staging.isContent(node.i) && inRegions(staging.box(node.i)),
  );
  const changed = content.filter((node) => changedSelectors.has(node.sel));
  const messages: string[] = [];
  const reported = new Set<string>();

  for (const a of changed) {
    for (const b of content) {
      if (a.i === b.i || staging.isAncestor(a.i, b.i) || staging.isAncestor(b.i, a.i)) continue;
      const boxA = staging.box(a.i);
      const boxB = staging.box(b.i);
      const overlap = intersection(boxA, boxB);
      if (overlap < Math.min(area(boxA), area(boxB)) * 0.2) continue;

      const prodA = match.backward.get(a.i);
      const prodB = match.backward.get(b.i);
      if (prodA === undefined || prodB === undefined) continue;
      const before = intersection(
        shiftBox(production.box(prodA), shift),
        shiftBox(production.box(prodB), shift),
      );
      if (before >= overlap * 0.5) continue;

      const key = [a.i, b.i].sort().join(":");
      if (reported.has(key)) continue;
      reported.add(key);
      messages.push(`${staging.label(a.i)} now overlaps ${staging.label(b.i)}`);
      if (messages.length >= 3) return messages;
    }
  }
  return messages;
}

/**
 * Minimum contrast for text (WCAG AA for large text); below it, text is hard to read.
 */
const MIN_CONTRAST = 3;

/**
 * Text in the changed regions whose contrast dropped below 3:1, or that is newly cut off by an
 * overflow-hidden box.
 *
 * Look for newly poor text contrast or newly clipped text in changed regions. Limit the
 * returned messages so one page cannot flood the report with repeated symptoms.
 */
function readabilityProblems(
  production: DomIndex,
  staging: DomIndex,
  match: TreeMatch,
  regions: RegionResult[],
): string[] {
  const messages: string[] = [];
  const seen = new Set<number>();
  for (const node of staging.nodes) {
    if (!node.text || seen.has(node.i)) continue;
    const box = staging.box(node.i);
    if (!regions.some((region) => intersection(box, region.box) > 0)) continue;
    const before = match.backward.get(node.i);
    if (before === undefined) continue;
    seen.add(node.i);

    if (node.clip && !production.node(before).clip) {
      messages.push(`Text is cut off in ${staging.label(node.i)}`);
    }
    const contrastAfter = textContrast(staging, node.i);
    const contrastBefore = textContrast(production, before);
    if (
      contrastAfter !== undefined &&
      contrastBefore !== undefined &&
      contrastAfter < MIN_CONTRAST &&
      contrastAfter < contrastBefore - 0.5
    ) {
      messages.push(
        `Low contrast: ${staging.label(node.i)} is ${contrastAfter.toFixed(1)}:1 (was ${contrastBefore.toFixed(1)}:1)`,
      );
    }
    if (messages.length >= 3) break;
  }
  return messages;
}
