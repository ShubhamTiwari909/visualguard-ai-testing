import type { ReactNode } from "react";
import { Compare, COMPARE_MODES, type CompareMode } from "./Compare";
import {
  envLabels,
  formatDuration,
  formatPercent,
  jobSummary,
  type JobResult,
  type RunManifest,
} from "./data";
import { CopyButton, Kbd, Pill, SectionTitle, SegmentedControl, StatusBadge } from "./ui";
import type { Delta, Env, Finding } from "../../src/core/types";

interface JobDetailProps {
  job: JobResult;
  manifest: RunManifest;
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  showRegions: boolean;
  onToggleRegions: () => void;
  actualSize: boolean;
  onToggleSize: () => void;
  focusedRegion?: number;
  onFocusRegion: (id: number) => void;
  actions?: ReactNode;
}

const SEVERITY_STYLE: Record<Finding["severity"], string> = {
  regression:
    "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
  review:
    "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
  info: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

function Findings({ findings }: { findings: Finding[] }) {
  return (
    <section aria-labelledby="findings-title">
      <SectionTitle id="findings-title">Findings</SectionTitle>
      <ul className="space-y-1.5">
        {findings.map((finding, index) => (
          <li
            key={index}
            className={`rounded-md border px-3 py-2 text-sm ${SEVERITY_STYLE[finding.severity]}`}
          >
            <span className="mr-2 text-xs font-semibold uppercase">{finding.severity}</span>
            {finding.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Analysis({ job }: { job: JobResult }) {
  const analysis = job.analysis!;
  return (
    <section
      aria-labelledby="analysis-title"
      className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionTitle id="analysis-title">AI analysis</SectionTitle>
        <Pill>{analysis.classification}</Pill>
        <Pill>model confidence {analysis.confidence.toFixed(2)}</Pill>
        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
          {analysis.provider} · {analysis.model}
          {analysis.cached ? " · cached" : ""}
        </span>
      </div>
      <p className="font-medium">{analysis.title}</p>
      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{analysis.summary}</p>
      {analysis.likelyCause && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Likely cause: </span>
          {analysis.likelyCause}
        </p>
      )}
      {analysis.evidence.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
          {analysis.evidence.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
      {analysis.affected.length > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-semibold">Affected: </span>
          {analysis.affected.map((item, index) => (
            <code
              key={index}
              className="mr-2 rounded bg-slate-100 px-1 font-mono text-xs dark:bg-slate-800"
            >
              {item.component ? `${item.component} · ` : ""}
              {item.selector}
            </code>
          ))}
        </p>
      )}
      {analysis.suggestedFix && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold">Suggested fix</span>
            {analysis.suggestedFix.snippet && <CopyButton text={analysis.suggestedFix.snippet} />}
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300">
            {analysis.suggestedFix.description}
          </p>
          {analysis.suggestedFix.snippet && (
            <pre className="mt-2 overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100">
              {analysis.suggestedFix.snippet.split("\n").map((line, index) => (
                <div
                  key={index}
                  className={
                    line.startsWith("+")
                      ? "text-emerald-300"
                      : line.startsWith("-")
                        ? "text-rose-300"
                        : ""
                  }
                >
                  {line || " "}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function DeltaRow({ delta }: { delta: Delta }) {
  const cell = "px-2 py-1 align-top";
  const code = "font-mono text-xs";
  switch (delta.kind) {
    case "style":
      return (
        <tr>
          <td className={`${cell} ${code}`}>{delta.selector}</td>
          <td className={`${cell} ${code}`}>{delta.property}</td>
          <td className={`${cell} ${code} text-rose-700 dark:text-rose-300`}>{delta.production}</td>
          <td className={`${cell} ${code} text-emerald-700 dark:text-emerald-300`}>
            {delta.staging}
          </td>
        </tr>
      );
    case "text":
      return (
        <tr>
          <td className={`${cell} ${code}`}>{delta.selector}</td>
          <td className={cell}>text</td>
          <td className={`${cell} text-rose-700 dark:text-rose-300`}>“{delta.production}”</td>
          <td className={`${cell} text-emerald-700 dark:text-emerald-300`}>“{delta.staging}”</td>
        </tr>
      );
    case "box": {
      const format = (box: typeof delta.production) =>
        `${box.x},${box.y} ${box.width}×${box.height}`;
      return (
        <tr>
          <td className={`${cell} ${code}`}>{delta.selector}</td>
          <td className={cell}>position / size</td>
          <td className={`${cell} ${code}`}>{format(delta.production)}</td>
          <td className={`${cell} ${code}`}>{format(delta.staging)}</td>
        </tr>
      );
    }
    case "presence":
      return (
        <tr>
          <td className={`${cell} ${code}`}>{delta.selector}</td>
          <td className={cell}>element</td>
          <td className={cell}>{delta.presentIn === "production" ? "present" : "missing"}</td>
          <td className={cell}>{delta.presentIn === "staging" ? "present" : "missing"}</td>
        </tr>
      );
  }
}

function Regions({
  job,
  labels,
  onFocusRegion,
}: {
  job: JobResult;
  labels: Record<Env, string>;
  onFocusRegion: (id: number) => void;
}) {
  return (
    <section aria-labelledby="regions-title">
      <SectionTitle id="regions-title">Changed regions</SectionTitle>
      <ol className="space-y-4">
        {job.regions.map((region) => (
          <li
            key={region.id}
            className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex size-5 items-center justify-center rounded bg-rose-500 text-xs font-bold text-white">
                {region.id + 1}
              </span>
              <span className="font-medium">
                {region.heuristic ?? `${region.diffPixels.toLocaleString()} pixels changed`}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                at {region.box.x},{region.box.y} · {region.box.width}×{region.box.height}
              </span>
              <button
                type="button"
                onClick={() => onFocusRegion(region.id)}
                className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950"
              >
                Show in screenshot
              </button>
            </div>
            {region.crops && (
              <div className="grid grid-cols-3 gap-2">
                {(["production", "staging", "diff"] as const).map((side) => (
                  <figure key={side} className="min-w-0">
                    <figcaption className="mb-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      {side === "diff" ? "Diff" : labels[side]}
                    </figcaption>
                    <img
                      src={region.crops![side]}
                      alt={`Region ${region.id + 1}, ${side === "diff" ? "differences" : labels[side]}`}
                      className="checkerboard block h-auto max-h-56 max-w-full rounded object-contain ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                  </figure>
                ))}
              </div>
            )}
            {region.elements.length > 0 && (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Elements:{" "}
                {region.elements.slice(0, 3).map((element, index) => (
                  <code
                    key={index}
                    className="mr-1.5 rounded bg-slate-100 px-1 font-mono dark:bg-slate-800"
                  >
                    {element.component ? `${element.component} · ` : ""}
                    {element.selector}
                  </code>
                ))}
              </p>
            )}
            {region.deltas.length > 0 && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-2 py-1 font-semibold">Element</th>
                      <th className="px-2 py-1 font-semibold">Property</th>
                      <th className="px-2 py-1 font-semibold">{labels.production}</th>
                      <th className="px-2 py-1 font-semibold">{labels.staging}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {region.deltas.slice(0, 12).map((delta, index) => (
                      <DeltaRow key={index} delta={delta} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Health({ job, labels }: { job: JobResult; labels: Record<Env, string> }) {
  const sides = (["production", "staging"] as const).filter((env) => job.captures[env]);
  return (
    <details className="group rounded-lg border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold select-none">
        Page health
      </summary>
      <div className="grid gap-4 px-3 pb-3 md:grid-cols-2">
        {sides.map((env) => {
          const capture = job.captures[env]!;
          const health = capture.health;
          return (
            <div key={env} className="text-sm">
              <p className="mb-1 font-semibold">
                {labels[env]}
                {capture.source === "baseline" ? " (stored snapshot)" : ""}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-slate-500 dark:text-slate-400">HTTP status</dt>
                <dd>{health.status ?? "–"}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Capture</dt>
                <dd>
                  {formatDuration(capture.durationMs)}
                  {capture.attempts > 1 ? ` · ${capture.attempts} attempts` : ""}
                  {capture.unstable ? " · page kept changing" : ""}
                  {capture.truncated ? " · cut at max height" : ""}
                </dd>
                <dt className="text-slate-500 dark:text-slate-400">Console errors</dt>
                <dd>{health.consoleErrors.length}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Failed requests</dt>
                <dd>{health.failedRequests.length}</dd>
                <dt className="text-slate-500 dark:text-slate-400">Broken images</dt>
                <dd>{health.brokenImages.length}</dd>
              </dl>
              {[...health.consoleErrors, ...health.failedRequests, ...health.brokenImages].length >
                0 && (
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {[...health.consoleErrors, ...health.failedRequests, ...health.brokenImages]
                    .slice(0, 30)
                    .map((line, index) => (
                      <li key={index} className="break-all">
                        {line}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
}

export function JobDetail(props: JobDetailProps) {
  const { job, manifest, mode } = props;
  const labels = envLabels(manifest);
  const bothSides = Boolean(job.captures.production && job.captures.staging);
  const summary = jobSummary(job);

  return (
    <article aria-labelledby="job-title" className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={job.status} />
          <h2 id="job-title" className="font-mono text-lg font-semibold break-all">
            {job.route}
          </h2>
          <Pill>{job.viewport}</Pill>
          {job.diff && job.diff.diffPixels > 0 && (
            <Pill>{formatPercent(job.diff.diffRatio)} changed</Pill>
          )}
          {props.actions && <div className="ml-auto flex gap-2">{props.actions}</div>}
        </div>
        {summary && <p className="text-sm text-slate-700 dark:text-slate-300">{summary}</p>}
        {job.acceptedBy && (
          <p className="text-xs text-teal-800 dark:text-teal-300">
            Accepted {new Date(job.acceptedBy.at).toLocaleString()}
            {job.acceptedBy.note ? `: ${job.acceptedBy.note}` : ""}
          </p>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          {(["production", "staging"] as const)
            .filter(
              (env) =>
                job.captures[env]?.source !== "baseline" &&
                (manifest.mode === "compare" || env === "staging"),
            )
            .map((env) => (
              <a
                key={env}
                href={job.urls[env]}
                target="_blank"
                rel="noreferrer noopener"
                className="hover:underline"
              >
                {labels[env]}: {job.urls[env]}
              </a>
            ))}
        </p>
      </header>

      {job.error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-semibold">The {job.error.stage} step failed</p>
          <pre className="mt-1 font-mono text-xs whitespace-pre-wrap">{job.error.message}</pre>
        </div>
      )}

      {job.findings && job.findings.length > 0 && <Findings findings={job.findings} />}
      {job.analysis && <Analysis job={job} />}

      <section aria-labelledby="compare-title">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 id="compare-title" className="sr-only">
            Screenshots
          </h3>
          {bothSides && (
            <SegmentedControl
              label="Comparison mode"
              value={mode}
              onChange={props.onModeChange}
              options={COMPARE_MODES.map((option) => ({
                ...option,
                disabled: option.value === "diff" && !job.diff?.image,
              }))}
            />
          )}
          <div className="ml-auto flex items-center gap-3 text-xs">
            {job.regions.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={props.showRegions}
                  onChange={props.onToggleRegions}
                  className="accent-rose-500"
                />
                Regions <Kbd>r</Kbd>
              </label>
            )}
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={props.actualSize}
                onChange={props.onToggleSize}
                className="accent-sky-600"
              />
              Actual size <Kbd>z</Kbd>
            </label>
          </div>
        </div>
        <Compare
          job={job}
          manifest={manifest}
          mode={bothSides ? mode : "side"}
          showRegions={props.showRegions}
          actualSize={props.actualSize}
          focusedRegion={props.focusedRegion}
        />
      </section>

      {job.regions.length > 0 && (
        <Regions job={job} labels={labels} onFocusRegion={props.onFocusRegion} />
      )}
      {(job.captures.production || job.captures.staging) && <Health job={job} labels={labels} />}
    </article>
  );
}

export type { CompareMode };
