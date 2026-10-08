import type { DomSnapshot } from "../capture/dom-snapshot.js";
import type { DiffResult, Finding, RegionResult, Status } from "../core/types.js";
import { describeDeltas } from "./describe.js";
import { mapRegion } from "./deltas.js";
import { textContrast } from "./contrast.js";
import { area, DomIndex, intersection, shiftBox } from "./dom.js";
import { matchTrees, type TreeMatch } from "./match.js";

/** Elements whose disappearance breaks a user flow. */
const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "form", "label"]);

/** Differences this small, with no DOM change behind them, are treated as rendering noise. */
const NOISE_MAX_RATIO = 0.001;
const NOISE_MAX_REGION_AREA = 64 * 64;

export interface ClassifyInput {
  diff: DiffResult;
  regions: RegionResult[];
  production?: DomSnapshot;
  staging?: DomSnapshot;
}

export interface ClassifyOutput {
  /** Status from the visual comparison alone; health findings are applied on top. */
  status: Extract<Status, "pass" | "review" | "regression">;
  findings: Finding[];
  regions: RegionResult[];
}

const finding = (severity: Finding["severity"], message: string): Finding => ({
  severity,
  message,
  source: "heuristic",
});

/**
 * Explains a job's differences without AI (PLAN.md §9 and §10.4): maps every region to DOM
 * deltas, describes it, detects removed controls, new overlaps and layout shifts, and filters
 * rendering noise.
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
  if (
    match &&
    !hasDeltas &&
    !diff.shift &&
    !diff.sizeMismatch &&
    diff.diffRatio <= NOISE_MAX_RATIO &&
    regions.every((region) => area(region.box) <= NOISE_MAX_REGION_AREA)
  ) {
    return {
      status: "pass",
      regions: regions.map((region) => ({
        ...region,
        heuristic: "Rendering noise (no DOM change)",
      })),
      findings: [
        finding(
          "info",
          `${regions.length} tiny difference${regions.length === 1 ? "" : "s"} with no DOM change: treated as rendering noise`,
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

function describeShift(
  shift: { fromY: number; deltaY: number },
  cause: string | undefined,
): string {
  const direction = shift.deltaY > 0 ? "down" : "up";
  const base = `Content below y=${shift.fromY} moved ${Math.abs(shift.deltaY)}px ${direction}`;
  return cause ? `${cause}; ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
}

/**
 * Pairs of visible elements that overlap on staging but not on production, where at least one of
 * them changed. Ancestors and descendants are excluded (they overlap by definition).
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

/** Minimum contrast for text (WCAG AA for large text); below it, text is hard to read. */
const MIN_CONTRAST = 3;

/**
 * Text in the changed regions whose contrast dropped below 3:1, or that is newly cut off by an
 * overflow-hidden box.
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
