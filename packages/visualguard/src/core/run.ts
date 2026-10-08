import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import pLimit from "p-limit";
import type { Browser } from "playwright";
import { launchBrowser, playwrightVersion } from "../capture/browser.js";
import { capturePage } from "../capture/capture.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { createDiffRunner, type DiffRunner } from "../diff/runner.js";
import { ConfigError, errorMessage } from "./errors.js";
import { RunEmitter, type RunEvent } from "./events.js";
import { planJobs } from "./jobs.js";
import { checkReachable } from "./reachability.js";
import { createRunDir, recordRun, writeManifest } from "./runs.js";
import { summarize } from "./status.js";
import {
  ENVS,
  type CaptureResult,
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

    const plan = await planJobs(config);
    const { jobs } = plan;
    if (jobs.length === 0) {
      throw new ConfigError("No routes to test", {
        hint:
          config.only.length > 0 ? `No route matches --only ${config.only.join(", ")}` : undefined,
      });
    }

    if (!this.options.skipReachabilityCheck && !config.browser.ignoreHTTPSErrors) {
      await Promise.all(
        ENVS.map((env) =>
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
      baseURL: config.baseURL,
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
        jobs.map((job) => limit(() => this.runJob(job, run.dir, browser, diffRunner))),
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
      mode: "compare",
      tool: {
        version: VERSION,
        playwright: playwrightVersion(),
        node: process.versions.node,
        browser: `${config.browser.name} ${browser.version()}`,
      },
      config: {
        baseURL: config.baseURL,
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
    for (const env of ENVS) {
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
      result.status = diff.passed ? "pass" : "review";
    } catch (error) {
      result.error = { stage: "diff", message: errorMessage(error) };
    }
    return finish();
  }
}

function nonEmptyHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([, value]) => value !== ""));
}

export function createRun(config: ResolvedConfig, options?: RunOptions): Run {
  return new Run(config, options);
}
