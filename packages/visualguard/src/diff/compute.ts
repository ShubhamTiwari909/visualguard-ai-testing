import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Box, Env, Size } from "../core/types.js";
import { pixelmatchEngine, renderDiffImage } from "./compare.js";
import { cropImage, padBox, padImage, readPNG, writePNG } from "./image.js";
import { extractRegions } from "./regions.js";

export interface DiffOptions {
  threshold: number;
  ignoreAntialiasing: boolean;
  maxDiffPixels: number;
  maxDiffRatio: number;
  maxRegions: number;
  regionCellSize: number;
  regionMergeDistance: number;
  regionPadding: number;
}

export interface DiffJobInput {
  productionPath: string;
  stagingPath: string;
  /** Job directory; `diff.png` and `regions/*.png` are written here. */
  outDir: string;
  options: DiffOptions;
}

export interface DiffJobRegion {
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
  regions: DiffJobRegion[];
  durationMs: number;
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
  const { diffPixels, mask } = pixelmatchEngine.compare(a, b, input.options);
  const diffRatio = diffPixels / (width * height);
  const passed = passesGate(diffPixels, diffRatio, input.options);

  const output: DiffJobOutput = {
    passed,
    width,
    height,
    sizeMismatch,
    diffPixels,
    diffRatio,
    regions: [],
    durationMs: 0,
  };

  // Passing jobs stop here: no artifacts, no mapping, no AI.
  if (passed) return { ...output, durationMs: Date.now() - started };

  mkdirSync(input.outDir, { recursive: true });
  const diffImage = renderDiffImage(b, mask);
  output.image = join(input.outDir, "diff.png");
  writePNG(output.image, diffImage);

  const regions = extractRegions(mask, width, height, {
    cellSize: input.options.regionCellSize,
    mergeDistance: input.options.regionMergeDistance,
    maxRegions: input.options.maxRegions,
  });

  if (regions.length > 0) mkdirSync(join(input.outDir, "regions"), { recursive: true });
  output.regions = regions.map((region, index) => {
    const cropBox = padBox(region.box, input.options.regionPadding, width, height);
    const crops = {
      production: join(input.outDir, "regions", `${index}.production.png`),
      staging: join(input.outDir, "regions", `${index}.staging.png`),
      diff: join(input.outDir, "regions", `${index}.diff.png`),
    };
    writePNG(crops.production, cropImage(a, cropBox));
    writePNG(crops.staging, cropImage(b, cropBox));
    writePNG(crops.diff, cropImage(diffImage, cropBox));
    return { box: region.box, diffPixels: region.diffPixels, crops };
  });

  return { ...output, durationMs: Date.now() - started };
}
