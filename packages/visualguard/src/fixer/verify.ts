import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import type { ResolvedConfig } from "../config/resolve.js";
import type { RouteObject } from "../config/schema.js";
import { EnvironmentError } from "../core/errors.js";
import { createRun } from "../core/run.js";
import type { JobResult } from "../core/types.js";
import { sleep } from "../core/util.js";

export interface CommandResult {
  ok: boolean;
  command: string;
  /** Last lines of combined output, for feedback and display. */
  output: string;
}

/** Runs a shell command with a timeout; output is kept, never streamed. */
export function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, CI: process.env.CI ?? "1" },
    });
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8_000);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      output += `\n(timed out after ${Math.round(timeoutMs / 1000)}s)`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, command, output: output.split("\n").slice(-30).join("\n").trim() });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, command, output: error.message });
    });
  });
}

export async function runCommands(
  commands: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const command of commands) {
    const result = await runCommand(command, cwd, timeoutMs);
    results.push(result);
    if (!result.ok) break;
  }
  return results;
}

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

  constructor(
    private readonly options: { command?: string; url: string; readyTimeoutMs: number },
    private readonly cwd: string,
  ) {}

  get url(): string {
    return this.options.url;
  }

  /** Starts the server (unless one already answers) and waits until it responds. */
  async ensure(): Promise<void> {
    if (await responds(this.options.url)) return;
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
      const collect = (chunk: Buffer) => {
        this.log = (this.log + chunk.toString()).slice(-4_000);
      };
      this.child.stdout?.on("data", collect);
      this.child.stderr?.on("data", collect);
    }
    const deadline = Date.now() + this.options.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) break;
      if (await responds(this.options.url)) return;
      await sleep(500);
    }
    await this.stop();
    throw new EnvironmentError(`The dev server didn't respond at ${this.options.url}`, {
      hint: `Command: ${this.options.command}\n${this.log.split("\n").slice(-10).join("\n")}`,
    });
  }

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
  }
}

function pathOf(url: string, base: string | undefined): string {
  const parsed = new URL(url);
  const basePath = base ? new URL(base).pathname.replace(/\/$/, "") : "";
  const path = parsed.pathname.startsWith(basePath)
    ? parsed.pathname.slice(basePath.length) || "/"
    : parsed.pathname;
  return `${path}${parsed.search}${parsed.hash}`;
}

export interface Verification {
  resolved: boolean;
  job: JobResult;
}

/**
 * Captures the job's route on the local server and compares it with production again. The
 * fix is resolved when the comparison passes.
 */
export async function verifyAgainstProduction(
  config: ResolvedConfig,
  job: JobResult,
  localURL: string,
): Promise<Verification> {
  const route: RouteObject = {
    path: pathOf(job.urls.production, config.baseURL.production),
    staging: pathOf(job.urls.staging, config.baseURL.staging),
  };
  const verifyConfig: ResolvedConfig = {
    ...config,
    baseURL: { production: config.baseURL.production, staging: localURL },
    routes: [route],
    viewports: { [job.viewport]: config.viewports[job.viewport]! },
    only: [],
    outputDir: join(config.outputDir, "fix-checks"),
    output: { ...config.output, keepRuns: 5 },
    report: {
      ...config.report,
      html: false,
      webhook: undefined,
      junit: undefined,
      githubSummary: false,
    },
    // Accepted changes don't count as fixed.
    acceptedPath: join(config.outputDir, "fix-checks", "none.json"),
  };
  const { manifest } = await createRun(verifyConfig, { ai: false, reporters: [] }).start();
  const result = manifest.jobs[0]!;
  return { resolved: result.status === "pass", job: result };
}
