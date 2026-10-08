import { useState, type ReactNode } from "react";
import { canvasSize, envLabels, type JobResult, type RunManifest } from "./data";

export type CompareMode = "side" | "slider" | "onion" | "diff";

export const COMPARE_MODES: Array<{ value: CompareMode; label: string; shortcut: string }> = [
  { value: "side", label: "Side by side", shortcut: "1" },
  { value: "slider", label: "Slider", shortcut: "2" },
  { value: "onion", label: "Onion skin", shortcut: "3" },
  { value: "diff", label: "Diff", shortcut: "4" },
];

interface CompareProps {
  job: JobResult;
  manifest: RunManifest;
  mode: CompareMode;
  showRegions: boolean;
  actualSize: boolean;
  focusedRegion?: number;
}

/**
 * Lays images out on a canvas of the diff's size, so overlays positioned in percentages line up
 * with the screenshots at any zoom level, and a shorter screenshot keeps its real proportions.
 */
function Canvas({
  job,
  actualSize,
  children,
  label,
}: {
  job: JobResult;
  actualSize: boolean;
  children: ReactNode;
  label?: string;
}) {
  const canvas = canvasSize(job)!;
  return (
    <figure className="min-w-0">
      {label && (
        <figcaption className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </figcaption>
      )}
      <div className={actualSize ? "overflow-x-auto" : ""}>
        <div
          className="checkerboard relative overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-700"
          style={{
            aspectRatio: `${canvas.width} / ${canvas.height}`,
            width: actualSize ? canvas.width : "100%",
          }}
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

function Screenshot({
  job,
  src,
  size,
  alt,
}: {
  job: JobResult;
  src: string;
  size: { width: number };
  alt: string;
}) {
  const canvas = canvasSize(job)!;
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className="absolute top-0 left-0 block h-auto max-w-none select-none"
      style={{ width: `${(size.width / canvas.width) * 100}%` }}
    />
  );
}

function Regions({ job, focusedRegion }: { job: JobResult; focusedRegion?: number }) {
  const canvas = canvasSize(job)!;
  return (
    <>
      {job.regions.map((region) => (
        <div
          key={region.id}
          id={`region-box-${region.id}`}
          className={`pointer-events-none absolute rounded-sm border-2 border-rose-500 bg-rose-500/10 ${
            focusedRegion === region.id ? "region-flash" : ""
          }`}
          style={{
            left: `${(region.box.x / canvas.width) * 100}%`,
            top: `${(region.box.y / canvas.height) * 100}%`,
            width: `${(Math.max(region.box.width, 4) / canvas.width) * 100}%`,
            height: `${(Math.max(region.box.height, 4) / canvas.height) * 100}%`,
          }}
        >
          <span className="absolute -top-px -left-px rounded-br bg-rose-500 px-1 text-[10px] leading-4 font-bold text-white">
            {region.id + 1}
          </span>
        </div>
      ))}
    </>
  );
}

export function Compare({
  job,
  manifest,
  mode,
  showRegions,
  actualSize,
  focusedRegion,
}: CompareProps) {
  const [slider, setSlider] = useState(50);
  const [opacity, setOpacity] = useState(50);
  const labels = envLabels(manifest);
  const production = job.captures.production;
  const staging = job.captures.staging;

  if (!canvasSize(job)) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        No screenshots were captured for this job.
      </p>
    );
  }

  // Only one side (first scan of a page, or a capture error on one side).
  if (!production || !staging) {
    const capture = (staging ?? production)!;
    const label = staging ? labels.staging : labels.production;
    return (
      <Canvas job={job} actualSize={actualSize} label={label}>
        <Screenshot
          job={job}
          src={capture.image}
          size={capture.size}
          alt={`${label} screenshot of ${job.route}`}
        />
      </Canvas>
    );
  }

  const overlay = showRegions ? <Regions job={job} focusedRegion={focusedRegion} /> : null;

  if (mode === "side") {
    return (
      <div className={actualSize ? "space-y-4" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
        <Canvas job={job} actualSize={actualSize} label={labels.production}>
          <Screenshot
            job={job}
            src={production.image}
            size={production.size}
            alt={`${labels.production} screenshot of ${job.route}`}
          />
          {overlay}
        </Canvas>
        <Canvas job={job} actualSize={actualSize} label={labels.staging}>
          <Screenshot
            job={job}
            src={staging.image}
            size={staging.size}
            alt={`${labels.staging} screenshot of ${job.route}`}
          />
          {overlay}
        </Canvas>
      </div>
    );
  }

  if (mode === "slider") {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>{labels.production}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={slider}
            onChange={(event) => setSlider(Number(event.target.value))}
            aria-label={`Slider position: ${labels.production} on the left, ${labels.staging} on the right`}
            className="w-48 accent-sky-600"
          />
          <span>{labels.staging}</span>
        </div>
        <Canvas job={job} actualSize={actualSize}>
          <Screenshot
            job={job}
            src={staging.image}
            size={staging.size}
            alt={`${labels.staging} screenshot of ${job.route}`}
          />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }}>
            <Screenshot job={job} src={production.image} size={production.size} alt="" />
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-sky-500 shadow-[0_0_0_1px_white]"
            style={{ left: `${slider}%` }}
          />
          {overlay}
        </Canvas>
      </div>
    );
  }

  if (mode === "onion") {
    return (
      <div>
        <div className="mb-2 flex items-center gap-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>{labels.production}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(event) => setOpacity(Number(event.target.value))}
            aria-label={`${labels.staging} opacity`}
            className="w-48 accent-sky-600"
          />
          <span>{labels.staging}</span>
        </div>
        <Canvas job={job} actualSize={actualSize}>
          <Screenshot
            job={job}
            src={production.image}
            size={production.size}
            alt={`${labels.production} screenshot of ${job.route}`}
          />
          <div className="absolute inset-0" style={{ opacity: opacity / 100 }}>
            <Screenshot job={job} src={staging.image} size={staging.size} alt="" />
          </div>
          {overlay}
        </Canvas>
      </div>
    );
  }

  if (!job.diff?.image) {
    return (
      <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">
        No diff image: the screenshots are within tolerance.
      </p>
    );
  }
  return (
    <Canvas
      job={job}
      actualSize={actualSize}
      label={
        job.diff.shift
          ? "Differences (red) · inserted or removed content (orange)"
          : "Differences (red)"
      }
    >
      <Screenshot
        job={job}
        src={job.diff.image}
        size={{ width: job.diff.width }}
        alt={`Pixel differences for ${job.route}`}
      />
      {overlay}
    </Canvas>
  );
}
