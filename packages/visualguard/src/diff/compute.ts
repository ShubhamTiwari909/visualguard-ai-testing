import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Box, Env, Size } from "../core/types.js";
import { pixelmatchEngine, renderDiffImage } from "./compare.js";
import { cropImage, padBox, padImage, readPNG, writePNG } from "./image.js";
import { clearBoxes, noiseMap } from "./noise.js";
import { extractRegions } from "./regions.js";
import { detectShift } from "./shift.js";

export interface DiffOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
  maxDiffPixels: number;
  maxDiffRatio: number;
  maxRegions: number;
  regionCellSize: number;
  regionMergeDistance: number;
  regionPadding: number;
  /** Look for a vertical layout shift and report the inserted/removed band separately. */
  detectShift: boolean;
  /** Skip the noise map when it covers more than this share of the page. */
  noiseMapMaxRatio?: number;
}

export interface DiffJobInput {
  productionPath: string;
  stagingPath: string;
  /** Job directory; `diff.png` and `regions/*.png` are written here. */
  outDir: string;
  options: DiffOptions;
  /**
   * A second capture of one side (`noise.env`). Areas that differ between the two captures change
   * on every load and are left out of the diff.
   */
  noise?: { env: Env; againPath: string; domPath?: string };
}

export interface DiffNoise {
  boxes: Box[];
  /** Differing pixels inside the boxes, left out of `diffPixels`. */
  ignoredPixels: number;
  skipped?: string;
}

export interface DiffJobRegion {
  /** "shift" for the inserted or removed band of a layout shift. */
  kind: "pixels" | "shift";
  box: Box;
  diffPixels: number;
  /** Absolute paths. */
  crops: Record<Env | "diff", string>;
}

export interface DiffJobOutput {
  passed: boolean;
  width: number;
  height: number;
  sizeMismatch?: Record<Env, Size>;
  diffPixels: number;
  diffRatio: number;
  /** Absolute path, only written when the job did not pass. */
  image?: string;
  shift?: { fromY: number; deltaY: number };
  noise?: DiffNoise;
  regions: DiffJobRegion[];
  durationMs: number;
}

function elementBoxes(domPath: string): Array<[number, number, number, number]> {
  try {
    const snapshot = JSON.parse(readFileSync(domPath, "utf8")) as {
      nodes: Array<{ box: [number, number, number, number] }>;
    };
    return snapshot.nodes.map((node) => node.box);
  } catch {
    return [];
  }
}

export function passesGate(diffPixels: number, diffRatio: number, options: DiffOptions): boolean {
  if (diffPixels <= options.maxDiffPixels) return true;
  return options.maxDiffRatio > 0 && diffRatio <= options.maxDiffRatio;
}

/** Diffs two screenshots on disk (PLAN.md §8.1). Pure apart from file I/O, so it runs in workers. */
export function computeDiff(input: DiffJobInput): DiffJobOutput {
  const started = Date.now();
  const production = readPNG(input.productionPath);
  const staging = readPNG(input.stagingPath);

  const width = Math.max(production.width, staging.width);
  const height = Math.max(production.height, staging.height);
  const sizeMismatch =
    production.width !== staging.width || production.height !== staging.height
      ? {
          production: { width: production.width, height: production.height },
          staging: { width: staging.width, height: staging.height },
        }
      : undefined;

  const a = padImage(production, width, height);
  const b = padImage(staging, width, height);
  const compared = pixelmatchEngine.compare(a, b, input.options);
  const { mask } = compared;
  let { diffPixels } = compared;

  let noise: DiffNoise | undefined;
  if (input.noise && diffPixels > 0) {
    const map = noiseMap(
      input.noise.env === "production" ? production : staging,
      readPNG(input.noise.againPath),
      { ...input.options, maxRatio: input.options.noiseMapMaxRatio ?? 0.25 },
      input.noise.domPath ? elementBoxes(input.noise.domPath) : [],
    );
    noise = { boxes: map.boxes, ignoredPixels: 0, skipped: map.skipped };
    if (!map.skipped && map.boxes.length > 0) {
      noise.ignoredPixels = clearBoxes(mask, map.boxes, width, height);
      diffPixels -= noise.ignoredPixels;
    }
  }
  const diffRatio = diffPixels / (width * height);
  const passed = passesGate(diffPixels, diffRatio, input.options);

  const output: DiffJobOutput = {
    passed,
    width,
    height,
    sizeMismatch,
    diffPixels,
    diffRatio,
    noise,
    regions: [],
    durationMs: 0,
  };

  // Passing jobs stop here: no artifacts, no mapping, no AI.
  if (passed) return { ...output, durationMs: Date.now() - started };

  mkdirSync(input.outDir, { recursive: true });

  // A layout shift explains most of a diff with one band; regions then come from what is left.
  let regionMask = mask;
  let band: Box | undefined;
  if (input.options.detectShift) {
    const shift = detectShift(a, b, input.options, mask);
    if (shift?.explainsBelow) {
      output.shift = { fromY: shift.fromY, deltaY: shift.deltaY };
      regionMask = shift.residualMask;
      band = {
        x: 0,
        y: shift.fromY,
        width,
        height: Math.min(Math.abs(shift.deltaY), height - shift.fromY),
      };
    }
  }

  const diffImage = renderDiffImage(
    b,
    regionMask,
    band,
    noise && !noise.skipped ? noise.boxes : undefined,
  );
  output.image = join(input.outDir, "diff.png");
  writePNG(output.image, diffImage);

  const pixelRegions = extractRegions(regionMask, width, height, {
    cellSize: input.options.regionCellSize,
    mergeDistance: input.options.regionMergeDistance,
    maxRegions: band ? input.options.maxRegions - 1 : input.options.maxRegions,
  });
  const regions: Array<{ kind: DiffJobRegion["kind"]; box: Box; diffPixels: number }> = [
    ...(band ? [{ kind: "shift" as const, box: band, diffPixels: band.width * band.height }] : []),
    ...pixelRegions.map((region) => ({ kind: "pixels" as const, ...region })),
  ];

  // Production crops come from where the content was before it moved.
  const productionBox = (box: Box): Box =>
    output.shift && box.y >= output.shift.fromY + Math.max(0, output.shift.deltaY)
      ? { ...box, y: Math.max(0, box.y - output.shift.deltaY) }
      : box;

  if (regions.length > 0) mkdirSync(join(input.outDir, "regions"), { recursive: true });
  output.regions = regions.map((region, index) => {
    const cropBox = padBox(region.box, input.options.regionPadding, width, height);
    const crops = {
      production: join(input.outDir, "regions", `${index}.production.png`),
      staging: join(input.outDir, "regions", `${index}.staging.png`),
      diff: join(input.outDir, "regions", `${index}.diff.png`),
    };
    writePNG(
      crops.production,
      cropImage(a, padBox(productionBox(region.box), input.options.regionPadding, width, height)),
    );
    writePNG(crops.staging, cropImage(b, cropBox));
    writePNG(crops.diff, cropImage(diffImage, cropBox));
    return { kind: region.kind, box: region.box, diffPixels: region.diffPixels, crops };
  });

  return { ...output, durationMs: Date.now() - started };
}
