import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import pLimit from "p-limit";
import type { Browser } from "playwright";
import { launchBrowser, playwrightVersion } from "../capture/browser.js";
import { capturePage } from "../capture/capture.js";
import { captureDomSnapshot, type DomSnapshot } from "../capture/dom-snapshot.js";
import { classifyJob } from "../mapping/classify.js";
import { AnalysisSession, needsAnalysis } from "../ai/analyze-job.js";
import { createProvider } from "../ai/factory.js";
import type { AIProvider } from "../ai/provider.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { createDiffRunner, type DiffRunner } from "../diff/runner.js";
import { pngSize } from "./util.js";
import { applyAccepted, readAccepted } from "./accepted.js";
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
  type DiffResult,
  type Env,
  type Finding,
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
  /**
   * Overwrite the stored snapshots with this run's captures. "unless-regression" (monitor mode)
   * keeps the old snapshot for pages that regressed, so they're reported again next time.
   */
  updateBaselines?: boolean | "unless-regression";
  /**
   * Compare health signals (broken images, HTTP errors…) with the stored snapshot's, so only new
   * problems are reported (monitor mode).
   */
  baselineHealth?: boolean;
  /** Route limit when routes are discovered. */
  discoveryLimit?: number;
  /** AI provider for this run; `false` disables AI. Defaults to the configured provider. */
  ai?: AIProvider | false;
  /** Reuse cached AI answers (default true). */
  aiCache?: boolean;
  failOn?: FailOn;
  /** Record a Playwright trace for every capture. */
  debug?: boolean;
  reporters?: Reporter[];
  env?: NodeJS.ProcessEnv;
  /** Skip the up-front request to each base URL. */
  skipReachabilityCheck?: boolean;
  /** Run only this part of the jobs, e.g. { index: 1, total: 4 } (`--shard 1/4`). */
  shard?: Shard;
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
    const { shard } = this.options;
    const jobs = shard ? shardJobs(plan.jobs, shard) : plan.jobs;
    if (jobs.length === 0 && shard && plan.jobs.length > 0) {
      throw new ConfigError(
        `Shard ${shard.index}/${shard.total} has no jobs: there are only ${plan.jobs.length}`,
        { hint: "Use fewer shards." },
      );
    }
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

    // AI is optional: without a provider (or a key) the heuristics explain everything.
    let provider: AIProvider | undefined;
    const warnings = [...plan.warnings];
    if (this.options.ai !== false) {
      if (this.options.ai) {
        provider = this.options.ai;
      } else {
        const created = createProvider(config.ai, this.options.env ?? process.env);
        provider = created.provider;
        if (!provider && created.reason) warnings.push(`AI off: ${created.reason}`);
      }
    }
    const session = provider
      ? new AnalysisSession(provider, config.ai, {
          cacheDir:
            this.options.aiCache === false ? undefined : join(config.outputDir, "cache", "ai"),
        })
      : undefined;

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
      warnings,
      ai: provider ? { provider: provider.name, model: provider.model } : undefined,
      shard,
    });

    const browser = await launchBrowser(config);
    const diffRunner = createDiffRunner(Math.max(1, Math.min(4, cpus().length - 1)));
    let results: JobResult[];

    const accepted = readAccepted(config.acceptedPath);
    try {
      const captureLimit = pLimit(config.concurrency);
      const aiLimit = pLimit(config.ai.concurrency);
      results = await Promise.all(
        jobs.map(async (job) => {
          // AI calls get their own limit so captures keep going while the model thinks.
          let result = await captureLimit(() =>
            this.runJob(job, run.dir, browser, diffRunner, liveEnvs),
          );
          result = applyAccepted(result, run.dir, accepted, config.output.acceptMatch);
          if (session && needsAnalysis(result, config.ai.analyze)) {
            result = await aiLimit(() => session.analyze(result, run.dir, mode));
          }
          this.emitAll({ type: "job:end", job: result });
          return result;
        }),
      );
    } finally {
      await browser.close().catch(() => {});
      await diffRunner.close();
    }

    // Monitor mode rolls the snapshots forward once the final (post-AI) status is known.
    if (this.options.updateBaselines === "unless-regression" && this.options.baselineDir) {
      for (const result of results) {
        const capture = result.captures.staging;
        if (!capture || result.status === "regression" || result.status === "error") continue;
        this.saveBaseline(join(this.options.baselineDir, `${result.id}.png`), run.dir, capture);
      }
    }

    const manifest: RunManifest = {
      schemaVersion: 1,
      id: run.id,
      number: run.number,
      startedAt: run.startedAt.toISOString(),
      durationMs: Date.now() - run.startedAt.getTime(),
      mode,
      shard,
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
        ai: provider ? { provider: provider.name, model: provider.model } : { provider: "none" },
        failOn,
      },
      summary: summarize(results),
      usage: session
        ? {
            aiCalls: session.calls,
            inputTokens: session.usage.inputTokens,
            outputTokens: session.usage.outputTokens,
            thinkingTokens: session.usage.thinkingTokens,
          }
        : undefined,
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
      result.baseStatus = result.status;
      return result;
    };

    // Capture production then staging back to back to keep time skew small.
    for (const env of liveEnvs) {
      try {
        let dom: DomSnapshot | undefined;
        const outcome = await capturePage({
          browser,
          config: this.config,
          job,
          env,
          tracePath: this.options.debug ? join(jobDir, `trace.${env}.zip`) : undefined,
          afterScreenshot: async (page) => {
            // A failed DOM snapshot only costs the explanation, never the capture.
            dom = await captureDomSnapshot(page).catch(() => undefined);
          },
        });
        const imagePath = join(jobDir, `${env}.png`);
        writeFileSync(imagePath, outcome.png);
        const domPath = join(jobDir, `${env}.dom.json`);
        if (dom) writeFileSync(domPath, JSON.stringify(dom));
        const capture: CaptureResult = {
          source: "live",
          image: rel(imagePath),
          dom: dom ? rel(domPath) : undefined,
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
      if (this.options.updateBaselines === true && baselinePath) {
        this.saveBaseline(baselinePath, runDir, result.captures.staging!);
      }
    }

    const findings = healthFindings(result.captures, {
      baselineHealth: this.options.baselineHealth,
      checks: this.config.checks,
    });
    if (!result.captures.production) {
      // Nothing to compare against yet: the status comes from health checks alone.
      findings.push({
        severity: "info",
        message: this.options.updateBaselines
          ? "No previous snapshot; saved this capture"
          : "No baseline yet; run with --update-baselines to save one",
        source: "baseline",
      });
      result.findings = findings;
      result.status = applyFindings("pass", findings);
      return finish();
    }

    try {
      const diffInput = {
        productionPath: join(runDir, result.captures.production!.image),
        stagingPath: join(runDir, result.captures.staging!.image),
        outDir: jobDir,
        options: this.config.diff,
      };
      let diff = await diffRunner.run(diffInput);
      // The page differs: load it once more to find areas that change on every load.
      const noiseEnv = liveEnvs[0]!;
      if (!diff.passed && this.config.diff.noiseMap) {
        const againPath = join(jobDir, `${noiseEnv}.again.png`);
        const again = await capturePage({
          browser,
          config: this.config,
          job,
          env: noiseEnv,
          checks: false,
        }).catch(() => undefined);
        if (again) {
          writeFileSync(againPath, again.png);
          const dom = result.captures[noiseEnv]?.dom;
          diff = await diffRunner.run({
            ...diffInput,
            noise: { env: noiseEnv, againPath, domPath: dom ? join(runDir, dom) : undefined },
          });
          if (!this.options.debug) rmSync(againPath, { force: true });
        }
      }
      result.diff = {
        width: diff.width,
        height: diff.height,
        sizeMismatch: diff.sizeMismatch,
        diffPixels: diff.diffPixels,
        diffRatio: diff.diffRatio,
        image: diff.image ? rel(diff.image) : undefined,
        shift: diff.shift,
        noise: diff.noise && { env: noiseEnv, ...diff.noise },
      };
      const noiseFinding = describeNoise(result.diff.noise, liveEnvs.length > 1);
      if (noiseFinding) findings.push(noiseFinding);
      result.regions = diff.regions.map((region, id) => ({
        id,
        kind: region.kind === "shift" ? "shift" : undefined,
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
    } catch (error) {
      result.error = { stage: "diff", message: errorMessage(error) };
      return finish();
    }

    let visualStatus: "pass" | "review" | "regression" = "pass";
    if (result.diff.diffPixels > 0 && result.regions.length > 0) {
      try {
        const classified = classifyJob({
          diff: result.diff,
          regions: result.regions,
          production: readDom(runDir, result.captures.production),
          staging: readDom(runDir, result.captures.staging),
        });
        result.regions = classified.regions;
        findings.unshift(...classified.findings);
        visualStatus = classified.status;
      } catch (error) {
        result.error = { stage: "mapping", message: errorMessage(error) };
        visualStatus = "review";
      }
    }
    result.findings = findings.length > 0 ? findings : undefined;
    result.status = applyFindings(visualStatus, findings);
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
    const domPath = baselinePath.replace(/\.png$/, ".dom.json");
    const domTarget = join(jobDir, "production.dom.json");
    if (existsSync(domPath)) copyFileSync(domPath, domTarget);
    return {
      source: "baseline",
      image: rel(target),
      dom: existsSync(domPath) ? rel(domTarget) : undefined,
      size: pngSize(readFileSync(target)),
      durationMs: 0,
      attempts: 0,
      health: existsSync(healthPath)
        ? (JSON.parse(readFileSync(healthPath, "utf8")) as CaptureResult["health"])
        : { consoleErrors: [], failedRequests: [], brokenImages: [] },
    };
  }

  private saveBaseline(baselinePath: string, runDir: string, capture: CaptureResult): void {
    mkdirSync(join(baselinePath, ".."), { recursive: true });
    copyFileSync(join(runDir, capture.image), baselinePath);
    if (capture.dom)
      copyFileSync(join(runDir, capture.dom), baselinePath.replace(/\.png$/, ".dom.json"));
    writeFileSync(
      baselinePath.replace(/\.png$/, ".health.json"),
      `${JSON.stringify(capture.health, null, 2)}\n`,
    );
  }
}

function describeNoise(noise: DiffResult["noise"], nameEnv: boolean): Finding | undefined {
  if (!noise) return undefined;
  if (noise.skipped) {
    return {
      severity: "info",
      message: `Noise map not applied: ${noise.skipped}`,
      source: "heuristic",
    };
  }
  if (noise.ignoredPixels === 0) return undefined;
  const areas = noise.boxes.length;
  return {
    severity: "info",
    message: `Ignored ${areas} area${areas > 1 ? "s" : ""} that change${areas > 1 ? "" : "s"} on every load${nameEnv ? ` of ${noise.env}` : ""} (${noise.ignoredPixels.toLocaleString("en-US")} px)`,
    source: "heuristic",
  };
}

function readDom(runDir: string, capture: CaptureResult | undefined): DomSnapshot | undefined {
  if (!capture?.dom) return undefined;
  try {
    return JSON.parse(readFileSync(join(runDir, capture.dom), "utf8")) as DomSnapshot;
  } catch {
    return undefined;
  }
}

function nonEmptyHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).filter(([, value]) => value !== ""));
}

export interface Shard {
  /** 1-based. */
  index: number;
  total: number;
}

/**
 * The jobs for one shard: sorted by id and dealt out round-robin, so every machine computes the
 * same split from the same job list and the shards stay balanced.
 */
export function shardJobs<T extends { id: string }>(jobs: readonly T[], shard: Shard): T[] {
  return [...jobs]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((_, position) => position % shard.total === shard.index - 1);
}

export function parseShard(value: string): Shard {
  const match = value.trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total < 1 || index < 1 || index > total) {
    throw new ConfigError(`--shard must look like 1/4 (got "${value}")`);
  }
  return { index, total };
}

export function createRun(config: ResolvedConfig, options?: RunOptions): Run {
  return new Run(config, options);
}
