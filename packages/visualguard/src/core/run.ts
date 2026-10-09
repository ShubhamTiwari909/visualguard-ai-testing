import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import pLimit from "p-limit";
import type { Browser } from "playwright";
import { launchBrowser, playwrightVersion } from "../capture/browser.js";
import { capturePage } from "../capture/capture.js";
import { captureDomSnapshot, type DomSnapshot } from "../capture/dom-snapshot.js";
import { classifyComparison } from "./comparison.js";
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
import {
  assertBaselineCompatible,
  capturePolicy,
  fingerprint,
  renderingIdentity,
  sourceRevision,
  writeBaselineMetadata,
} from "./provenance.js";

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
  runGroup?: string;
  signal?: AbortSignal;
  /** Replay original jobs against immutable reference artifacts (fix verification). */
  jobs?: JobSpec[];
  references?: Record<string, { runDir: string; capture: CaptureResult }>;
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
    const liveEnvs: readonly Env[] =
      mode === "compare" && !this.options.references ? ENVS : ["staging"];
    const plan = this.options.jobs
      ? {
          jobs: this.options.jobs,
          routes: this.options.jobs.map((j) => j.route),
          warnings: [] as string[],
        }
      : await planJobs(config, { discoveryLimit: this.options.discoveryLimit });
    this.options.signal?.throwIfAborted();
    const { shard } = this.options;
    const jobs = shard ? shardJobs(plan.jobs, shard) : plan.jobs;
    const vars = this.options.env ?? process.env;
    const group =
      this.options.runGroup ??
      vars.VISUALGUARD_RUN_GROUP ??
      (vars.GITHUB_RUN_ID ? `${vars.GITHUB_RUN_ID}-${vars.GITHUB_RUN_ATTEMPT ?? "1"}` : undefined);
    if (shard && !group)
      throw new ConfigError(
        "Sharded runs require --run-group or VISUALGUARD_RUN_GROUP (automatic in GitHub Actions).",
      );
    const provenance = {
      group: group ?? "",
      sourceRevision: sourceRevision(config.cwd),
      expectedJobs: plan.jobs.map((j) => j.id).sort(),
      fingerprint: fingerprint({
        jobs: [...plan.jobs].sort((a, b) => a.id.localeCompare(b.id)),
        browser: config.browser,
        viewports: config.viewports,
        stabilize: config.stabilize,
        screenshot: config.screenshot,
        diff: config.diff,
        checks: config.checks,
        ai: config.ai,
        environments: config.environments,
        platform: process.platform,
        playwright: playwrightVersion(),
        mode,
        baselineDir: Boolean(this.options.baselineDir),
      }),
    };
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
          signal: this.options.signal,
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
    const onAbort = () => {
      void browser.close().catch(() => {});
    };
    this.options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const captureLimit = pLimit(config.concurrency);
      const aiLimit = pLimit(config.ai.concurrency);
      results = await Promise.all(
        jobs.map(async (job) => {
          // AI calls get their own limit so captures keep going while the model thinks.
          this.options.signal?.throwIfAborted();
          let result = await captureLimit(() =>
            this.runJob(job, run.dir, browser, diffRunner, liveEnvs),
          );
          this.options.signal?.throwIfAborted();
          result = applyAccepted(result, run.dir, accepted, config.output.acceptMatch);
          if (session && needsAnalysis(result, config.ai.analyze)) {
            result = await aiLimit(() => session.analyze(result, run.dir, mode));
          }
          this.options.signal?.throwIfAborted();
          this.emitAll({ type: "job:end", job: result });
          return result;
        }),
      );
    } finally {
      this.options.signal?.removeEventListener("abort", onAbort);
      await browser.close().catch(() => {});
      await diffRunner.close();
    }

    // Monitor mode rolls the snapshots forward once the final (post-AI) status is known.
    if (this.options.updateBaselines === "unless-regression" && this.options.baselineDir) {
      for (const result of results) {
        const capture = result.captures.staging;
        if (!capture || result.status === "regression" || result.status === "error") continue;
        this.saveBaseline(
          join(this.options.baselineDir, `${result.id}.png`),
          run.dir,
          capture,
          result,
        );
      }
    }

    const manifest: RunManifest = {
      schemaVersion: 1,
      provenance: { ...provenance, group: provenance.group || run.id },
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
            generationAttempts: session.budget.generationAttempts,
            networkAttempts: session.budget.networkAttempts,
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
      capturePolicy: capturePolicy(this.config, job),
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
        try {
          assertBaselineCompatible(
            baselinePath,
            renderingIdentity(this.config, job),
            this.config.baseline.legacy,
          );
          result.captures.production = this.loadBaseline(baselinePath, jobDir, rel);
        } catch (error) {
          if (this.options.updateBaselines !== true) throw error;
          // Explicit updates migrate legacy/incompatible references rather than comparing
          // different rendering environments.
        }
      }
      if (this.options.updateBaselines === true && baselinePath) {
        this.saveBaseline(baselinePath, runDir, result.captures.staging!, job);
      }
    }

    const reference = this.options.references?.[job.id];
    if (reference) {
      const image = join(jobDir, "production.png");
      copyFileSync(join(reference.runDir, reference.capture.image), image);
      const dom = reference.capture.dom ? join(jobDir, "production.dom.json") : undefined;
      if (dom) copyFileSync(join(reference.runDir, reference.capture.dom!), dom);
      result.captures.production = {
        ...reference.capture,
        source: "baseline",
        image: rel(image),
        dom: dom ? rel(dom) : undefined,
      };
    }
    if (
      !result.captures.production &&
      !this.options.updateBaselines &&
      this.config.baseline.missing === "error"
    ) {
      result.error = {
        stage: "capture",
        message: "No baseline yet; run with --update-baselines to save one",
      };
      return finish();
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

    try {
      const classified = classifyComparison(
        { ...result, findings: findings.filter((f) => f.source !== "health") },
        runDir,
        this.config.checks,
        this.options.baselineHealth,
      );
      result.regions = classified.regions;
      result.findings = classified.findings;
      result.status = classified.status;
    } catch (error) {
      result.error = { stage: "mapping", message: errorMessage(error) };
      result.status = "error";
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

  private saveBaseline(
    baselinePath: string,
    runDir: string,
    capture: CaptureResult,
    job: Pick<JobSpec, "viewport"> & {
      waitFor?: string;
      mask?: string[];
      hide?: string[];
      capturePolicy?: JobResult["capturePolicy"];
    },
  ): void {
    mkdirSync(join(baselinePath, ".."), { recursive: true });
    copyFileSync(join(runDir, capture.image), baselinePath);
    writeBaselineMetadata(
      baselinePath,
      renderingIdentity(this.config, {
        viewport: job.viewport,
        waitFor: job.waitFor ?? job.capturePolicy?.waitFor,
        mask: job.mask ?? job.capturePolicy?.mask ?? [],
        hide: job.hide ?? job.capturePolicy?.hide ?? [],
      }),
      this.config.cwd,
    );
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
