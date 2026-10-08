import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import pLimit from "p-limit";
import type { Browser } from "playwright";
import { launchBrowser, playwrightVersion } from "../capture/browser.js";
import { capturePage } from "../capture/capture.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { createDiffRunner, type DiffRunner } from "../diff/runner.js";
import { pngSize } from "./util.js";
import { ConfigError, errorMessage } from "./errors.js";
import { applyFindings, healthFindings } from "./findings.js";
import { RunEmitter, type RunEvent } from "./events.js";
import { planJobs } from "./jobs.js";
import { checkReachable } from "./reachability.js";
import { createRunDir, recordRun, writeManifest } from "./runs.js";
import { summarize } from "./status.js";
import {
  ENVS,
  type CaptureResult,
  type Env,
  type FailOn,
  type JobResult,
  type JobSpec,
  type RunManifest,
} from "./types.js";
import { VERSION } from "./version.js";

export interface ReporterContext {
  runDir: string;
  config: ResolvedConfig;
}

/** Reporters receive run events and the final manifest (PLAN.md §5.6). */
export interface Reporter {
  name: string;
  onEvent?(event: RunEvent): void;
  onRunEnd?(manifest: RunManifest, context: ReporterContext): void | Promise<void>;
}

export interface RunOptions {
  /**
   * "compare" captures production and staging live. "baseline" and "scan" capture staging live
   * and compare it with a stored snapshot from `baselineDir` (PLAN.md §14.2).
   */
  mode?: RunManifest["mode"];
  /** Snapshot directory for baseline and scan modes. */
  baselineDir?: string;
  /** Overwrite the stored snapshots with this run's captures. */
  updateBaselines?: boolean;
  /** Route limit when routes are discovered. */
  discoveryLimit?: number;
  failOn?: FailOn;
  /** Record a Playwright trace for every capture. */
  debug?: boolean;
  reporters?: Reporter[];
  env?: NodeJS.ProcessEnv;
  /** Skip the up-front request to each base URL. */
  skipReachabilityCheck?: boolean;
}

export interface RunOutcome {
  manifest: RunManifest;
  runDir: string;
}

export class Run extends RunEmitter {
  constructor(
    readonly config: ResolvedConfig,
    private readonly options: RunOptions = {},
  ) {
    super();
  }

  private emitAll(event: RunEvent): void {
    this.emit(event);
    for (const reporter of this.options.reporters ?? []) {
      try {
        reporter.onEvent?.(event);
      } catch {
        // Reporters must not break the run.
      }
    }
  }

  async start(): Promise<RunOutcome> {
    const { config } = this;
    const failOn = this.options.failOn ?? "regression";

    const mode = this.options.mode ?? "compare";
    if (mode !== "compare" && !this.options.baselineDir) {
      throw new ConfigError(`${mode} mode needs a baseline directory`);
    }
    const liveEnvs: readonly Env[] = mode === "compare" ? ENVS : ["staging"];
    const plan = await planJobs(config, { discoveryLimit: this.options.discoveryLimit });
    const { jobs } = plan;
    if (jobs.length === 0) {
      throw new ConfigError("No routes to test", {
        hint:
          config.only.length > 0 ? `No route matches --only ${config.only.join(", ")}` : undefined,
      });
    }

    if (!this.options.skipReachabilityCheck && !config.browser.ignoreHTTPSErrors) {
      await Promise.all(
        liveEnvs.map((env) =>
          checkReachable(
            env,
            config.baseURL[env]!,
            nonEmptyHeaders(config.environments[env]?.headers),
          ),
        ),
      );
    }

    const run = createRunDir(config.outputDir, this.options.env);
    this.emitAll({
      type: "run:start",
      runId: run.id,
      number: run.number,
      runDir: run.dir,
      jobs,
      baseURL: mode === "compare" ? config.baseURL : { staging: config.baseURL.staging },
      viewports: config.viewports,
      routeCount: plan.routes.length,
      warnings: plan.warnings,
    });

    const browser = await launchBrowser(config);
    const diffRunner = createDiffRunner(Math.max(1, Math.min(4, cpus().length - 1)));
    let results: JobResult[];

    try {
      const limit = pLimit(config.concurrency);
      results = await Promise.all(
        jobs.map((job) => limit(() => this.runJob(job, run.dir, browser, diffRunner, liveEnvs))),
      );
    } finally {
      await browser.close().catch(() => {});
      await diffRunner.close();
    }

    const manifest: RunManifest = {
      schemaVersion: 1,
      id: run.id,
      number: run.number,
      startedAt: run.startedAt.toISOString(),
      durationMs: Date.now() - run.startedAt.getTime(),
      mode,
      tool: {
        version: VERSION,
        playwright: playwrightVersion(),
        node: process.versions.node,
        browser: `${config.browser.name} ${browser.version()}`,
      },
      config: {
        baseURL: mode === "compare" ? config.baseURL : { staging: config.baseURL.staging },
        viewports: Object.fromEntries(
          Object.entries(config.viewports).map(([name, vp]) => [
            name,
            { width: vp.width, height: vp.height },
          ]),
        ),
        ai: { provider: "none" },
        failOn,
      },
      summary: summarize(results),
      jobs: results,
    };

    writeManifest(run.dir, manifest);
    recordRun(config.outputDir, manifest, config.output.keepRuns);
    this.emitAll({ type: "run:end", manifest, runDir: run.dir });
    for (const reporter of this.options.reporters ?? []) {
      await reporter.onRunEnd?.(manifest, { runDir: run.dir, config });
    }
    return { manifest, runDir: run.dir };
  }

  private async runJob(
    job: JobSpec,
    runDir: string,
    browser: Browser,
    diffRunner: DiffRunner,
    liveEnvs: readonly Env[],
  ): Promise<JobResult> {
    const started = Date.now();
    this.emitAll({ type: "job:start", job });
    const jobDir = join(runDir, "jobs", job.id);
    mkdirSync(jobDir, { recursive: true });
    const rel = (path: string) => relative(runDir, path).split("\\").join("/");

    const result: JobResult = {
      id: job.id,
      route: job.route,
      name: job.name,
      viewport: job.viewport,
      status: "error",
      urls: job.urls,
      captures: {},
      regions: [],
      durationMs: 0,
    };
    const finish = (): JobResult => {
      result.durationMs = Date.now() - started;
      this.emitAll({ type: "job:end", job: result });
      return result;
    };

    // Capture production then staging back to back to keep time skew small.
    for (const env of liveEnvs) {
      try {
        const outcome = await capturePage({
          browser,
          config: this.config,
          job,
          env,
          tracePath: this.options.debug ? join(jobDir, `trace.${env}.zip`) : undefined,
        });
        const imagePath = join(jobDir, `${env}.png`);
        writeFileSync(imagePath, outcome.png);
        const capture: CaptureResult = {
          source: "live",
          image: rel(imagePath),
          size: outcome.size,
          truncated: outcome.truncated || undefined,
          unstable: outcome.unstable || undefined,
          durationMs: outcome.durationMs,
          attempts: outcome.attempts,
          health: outcome.health,
        };
        result.captures[env] = capture;
        this.emitAll({ type: "job:captured", job, env, capture });
      } catch (error) {
        result.error = { stage: "capture", message: `${env}: ${errorMessage(error)}` };
        return finish();
      }
    }

    const baselinePath = this.options.baselineDir
      ? join(this.options.baselineDir, `${job.id}.png`)
      : undefined;
    if (!liveEnvs.includes("production")) {
      if (baselinePath && existsSync(baselinePath)) {
        result.captures.production = this.loadBaseline(baselinePath, jobDir, rel);
      }
      if (this.options.updateBaselines && baselinePath) {
        this.saveBaseline(
          baselinePath,
          join(runDir, result.captures.staging!.image),
          result.captures.staging!,
        );
      }
    }

    const findings = healthFindings(result.captures);
    if (!result.captures.production) {
      // Nothing to compare against yet: the status comes from health checks alone.
      findings.push({
        severity: "info",
        message: this.options.updateBaselines
          ? "No previous snapshot; saved this capture"
          : "No baseline snapshot",
        source: "baseline",
      });
      result.findings = findings;
      result.status = applyFindings("pass", findings);
      return finish();
    }

    try {
      const diff = await diffRunner.run({
        productionPath: join(runDir, result.captures.production!.image),
        stagingPath: join(runDir, result.captures.staging!.image),
        outDir: jobDir,
        options: this.config.diff,
      });
      result.diff = {
        width: diff.width,
        height: diff.height,
        sizeMismatch: diff.sizeMismatch,
        diffPixels: diff.diffPixels,
        diffRatio: diff.diffRatio,
        image: diff.image ? rel(diff.image) : undefined,
      };
      result.regions = diff.regions.map((region, id) => ({
        id,
        box: region.box,
        diffPixels: region.diffPixels,
        crops: {
          production: rel(region.crops.production),
          staging: rel(region.crops.staging),
          diff: rel(region.crops.diff),
        },
        elements: [],
        deltas: [],
      }));
      result.findings = findings.length > 0 ? findings : undefined;
      result.status = applyFindings(diff.passed ? "pass" : "review", findings);
    } catch (error) {
      result.error = { stage: "diff", message: errorMessage(error) };
    }
    return finish();
  }

  /** Copies a stored snapshot into the job directory as the "production" side. */
  private loadBaseline(
    baselinePath: string,
    jobDir: string,
    rel: (path: string) => string,
  ): CaptureResult {
    const target = join(jobDir, "production.png");
    copyFileSync(baselinePath, target);
    const healthPath = baselinePath.replace(/\.png$/, ".health.json");
    return {
      source: "baseline",
      image: rel(target),
      size: pngSize(readFileSync(target)),
      durationMs: 0,
      attempts: 0,
      health: existsSync(healthPath)
        ? (JSON.parse(readFileSync(healthPath, "utf8")) as CaptureResult["health"])
        : { consoleErrors: [], failedRequests: [], brokenImages: [] },
    };
  }

  private saveBaseline(baselinePath: string, imagePath: string, capture: CaptureResult): void {
    mkdirSync(join(baselinePath, ".."), { recursive: true });
    copyFileSync(imagePath, baselinePath);
    writeFileSync(
      baselinePath.replace(/\.png$/, ".health.json"),
      `${JSON.stringify(capture.health, null, 2)}\n`,
    );
  }
}

function nonEmptyHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([, value]) => value !== ""));
}

export function createRun(config: ResolvedConfig, options?: RunOptions): Run {
  return new Run(config, options);
}
