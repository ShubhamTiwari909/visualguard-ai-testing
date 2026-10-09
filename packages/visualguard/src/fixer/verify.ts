/**
 * @file Runs bounded verification commands, manages the dev-server process and compares new
 * captures with immutable saved references.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { joinURL } from "../config/urls.js";
import { findRun } from "../core/runs.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { EnvironmentError } from "../core/errors.js";
import { createRun } from "../core/run.js";
import type { JobResult } from "../core/types.js";
import { sleep } from "../core/util.js";

export interface CommandResult {
  ok: boolean;
  command: string;
  /**
   * Last lines of combined output, for feedback and display.
   */
  output: string;
  timedOut?: boolean;
}

/**
 * Runs a shell command with a timeout; output is kept, never streamed.
 *
 * Run a configured shell command with cancellation, a timeout and bounded captured output.
 * Resolve a structured result after cleanup so verification can inspect failures without
 * streaming noisy logs.
 */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, command, output: "Cancelled" });
      return;
    }
    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== "win32",
      env: { ...process.env, CI: process.env.CI ?? "1" },
    });
    let output = "";
    /**
     * Append process output while retaining only the most recent bounded text. Buffer limits
     * prevent a verbose verification command from consuming unbounded memory.
     */
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    let timedOut = false;
    let settled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    /**
     * Settle the command result once and remove timers/listeners. Multiple process events may
     * fire, so the settled flag prevents resolving and cleaning up twice.
     */
    const finish = (code: number | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (escalation) clearTimeout(escalation);
      signal?.removeEventListener("abort", cancel);
      resolve({
        ok: !timedOut && !error && code === 0,
        command,
        timedOut: timedOut || undefined,
        output: error ?? output.split("\n").slice(-30).join("\n").trim(),
      });
    };
    /**
     * Terminate the command's process group on Unix or its descendant tree on Windows. Killing
     * only the shell could otherwise leave its child server/build process running.
     */
    const killTree = (signal: NodeJS.Signals) => {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else if (child.pid) process.kill(-child.pid, signal);
      } catch {
        /* Already exited. */
      }
    };
    /**
     * Mark a timeout, request graceful termination and schedule a forceful fallback. The
     * fallback also releases output streams so an exited parent cannot leave the promise
     * waiting on descendants.
     */
    const terminate = () => {
      timedOut = true;
      output += `\n(timed out after ${timeoutMs}ms)`;
      killTree("SIGTERM");
      escalation = setTimeout(() => {
        killTree("SIGKILL");
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(null);
      }, 1000);
    };
    /**
     * Record caller cancellation and use the same termination path as a timeout. This keeps
     * process cleanup consistent across both stop conditions.
     */
    const cancel = () => {
      output += "\n(cancelled)";
      terminate();
    };
    const timer = setTimeout(terminate, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("close", (code) => finish(code));
    child.on("error", (error) => finish(null, error.message));
  });
}

/**
 * Execute verification commands in order and stop at the first unsuccessful result. Later
 * checks should not run against a build that already failed.
 */
export async function runCommands(
  commands: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const command of commands) {
    const result = await runCommand(command, cwd, timeoutMs, signal);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

/**
 * Probe whether an HTTP server answers within a short timeout and discard its response body.
 * Any response proves it is listening, regardless of its page status.
 */
async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/**
 * The local server that fixed code is checked against (PLAN.md §13.5): staging serves the
 * deployed code, so a local edit can only be seen on a local dev server.
 */
export class DevServer {
  private child: ChildProcess | undefined;
  private log = "";

  /**
   * Store server settings, working directory and verification mode. Parameter properties create
   * fields; starting a process is deferred to ensure.
   */
  constructor(
    private readonly options: { command?: string; url: string; readyTimeoutMs: number },
    private readonly cwd: string,
    private readonly mode: { requireFresh?: boolean } = {},
  ) {}

  /**
   * Expose the configured local server URL through a getter. Reading this property does not
   * start or probe the server.
   */
  get url(): string {
    return this.options.url;
  }

  /**
   * Starts the server (unless one already answers) and waits until it responds.
   *
   * Start a server if policy requires it and wait until its URL answers or startup fails/times
   * out. Check cancellation throughout and retain recent process logs for useful failure
   * messages.
   */
  async ensure(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.child && (await responds(this.options.url))) {
      if (!this.mode.requireFresh) return;
      // In a worktree, a server that's already running serves the main checkout, not our edits.
      throw new EnvironmentError(`A server is already running at ${this.options.url}`, {
        hint: "Stop it so VisualGuard can start the dev server from the fix worktree, or use --in-place.",
      });
    }
    if (this.child && (await responds(this.options.url))) return;
    if (!this.options.command) {
      throw new EnvironmentError(`Nothing is answering at ${this.options.url}`, {
        hint: "Start your dev server, or set fix.verify.server.command so VisualGuard starts it.",
      });
    }
    if (!this.child) {
      this.child = spawn(this.options.command, {
        cwd: this.cwd,
        shell: true,
        detached: process.platform !== "win32",
      });
      /**
       * Append managed-server output to a bounded diagnostic log. The final startup error can
       * then include the most recent lines.
       */
      const collect = (chunk: Buffer) => {
        this.log = (this.log + chunk.toString()).slice(-4_000);
      };
      this.child.stdout?.on("data", collect);
      this.child.stderr?.on("data", collect);
    }
    const deadline = Date.now() + this.options.readyTimeoutMs;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (this.child.exitCode !== null) break;
      if (await responds(this.options.url)) return;
      await sleep(500);
    }
    await this.stop();
    throw new EnvironmentError(`The dev server didn't respond at ${this.options.url}`, {
      hint: `Command: ${this.options.command}\n${this.log.split("\n").slice(-10).join("\n")}`,
    });
  }

  /**
   * Stop the managed server process tree if this instance started it. Clear the stored child
   * reference first so repeated stop calls are harmless.
   */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    try {
      // Kill the whole process group: dev servers spawn their own children.
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else if (child.pid)
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* Already stopped. */
    }
  }
}

/**
 * Recover a route path/query/fragment from a capture URL, stripping the configured base prefix
 * when present. The local verification server can then capture the corresponding page.
 */
function pathOf(url: string, base: string | undefined): string {
  const parsed = new URL(url);
  const basePath = base ? new URL(base).pathname.replace(/\/$/, "") : "";
  const path =
    parsed.pathname === basePath || parsed.pathname.startsWith(`${basePath}/`)
      ? parsed.pathname.slice(basePath.length) || "/"
      : parsed.pathname;
  return `${path}${parsed.search}${parsed.hash}`;
}

export interface Verification {
  resolved: boolean;
  job: JobResult;
  runDir: string;
}

/**
 * Captures the job's route on the local server and compares it with production again. The fix
 * is resolved when the comparison passes.
 *
 * Capture the repaired page on the local server and classify it against the original reference
 * evidence. Use deterministic checks and return resolved only when the resulting status passes.
 */
export async function verifyAgainstProduction(
  config: ResolvedConfig,
  job: JobResult,
  localURL: string,
  runDir?: string,
  signal?: AbortSignal,
): Promise<Verification> {
  const sourceDir = runDir ?? findRun(config.outputDir).dir;
  const reference = job.captures.production;
  if (!reference) throw new EnvironmentError("The original reference capture is missing.");
  const policy = job.capturePolicy;
  const spec = {
    id: job.id,
    route: job.route,
    name: job.name,
    viewport: job.viewport,
    urls: {
      ...job.urls,
      staging: joinURL(localURL, pathOf(job.urls.staging, config.baseURL.staging)),
    },
    waitFor: policy?.waitFor,
    mask: policy?.mask ?? [],
    hide: policy?.hide ?? [],
  };
  const verifyConfig: ResolvedConfig = {
    ...config,
    browser: policy?.browser ?? config.browser,
    stabilize: { ...(policy?.stabilize ?? config.stabilize) },
    screenshot: policy?.screenshot ?? config.screenshot,
    checks: policy?.checks ?? config.checks,
    baseURL: { ...config.baseURL, staging: localURL },
    viewports: { [job.viewport]: policy?.viewport ?? config.viewports[job.viewport]! },
    only: [],
    outputDir: join(sourceDir, "fix-checks"),
    output: { ...config.output, keepRuns: Number.MAX_SAFE_INTEGER },
    report: {
      ...config.report,
      html: false,
      webhook: undefined,
      junit: undefined,
      githubSummary: false,
    },
    acceptedPath: join(sourceDir, "fix-checks", "none.json"),
  };
  // A repair must match the immutable reference, without dynamically excluding pixels.
  verifyConfig.diff = { ...(policy?.diff ?? config.diff), noiseMap: false };
  const { manifest, runDir: verificationDir } = await createRun(verifyConfig, {
    ai: false,
    reporters: [],
    jobs: [spec],
    baselineHealth: true,
    signal,
    references: { [job.id]: { runDir: sourceDir, capture: reference } },
  }).start();
  const result = manifest.jobs[0]!;
  return { resolved: result.status === "pass", job: result, runDir: verificationDir };
}
