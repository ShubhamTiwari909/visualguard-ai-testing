import { join } from "node:path";
import type { Command } from "commander";
import { Option } from "commander";
import type { RouteInput } from "../../config/schema.js";
import { ConfigError } from "../../core/errors.js";
import { createRun } from "../../core/run.js";
import { exitCodeFor, FAIL_ON_VALUES } from "../../core/status.js";
import type { FailOn, RunManifest } from "../../core/types.js";
import {
  addAIOptions,
  collect,
  loadResolvedConfig,
  parsePositiveInt,
  standardReporters,
  type ConfigFlags,
} from "../shared.js";

export interface ZeroConfigFlags extends Omit<ConfigFlags, "production" | "staging" | "route"> {
  failOn: FailOn;
  ai?: boolean;
  ci?: boolean;
  json?: boolean;
  debug?: boolean;
}

export interface TargetURL {
  /** Origin with a trailing slash, e.g. "https://example.com/". */
  base: string;
  /** The page, when the URL points at one: path + query + hash. */
  route?: string;
  host: string;
}

/** Splits a positional URL into a base URL and (when it has a path) a single route. */
export function parseTargetURL(input: string): TargetURL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ConfigError(`"${input}" is not a URL`, {
      hint: "Pass full URLs, e.g. https://example.com",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`"${input}" must use http or https`);
  }
  const hasPage = url.pathname !== "/" || url.search !== "" || url.hash !== "";
  return {
    base: `${url.origin}/`,
    route: hasPage ? `${url.pathname}${url.search}${url.hash}` : undefined,
    host: url.host,
  };
}

/**
 * Routes for positional URLs (PLAN.md §6.5): a path compares only that page; if only one URL has
 * a path, it is used on both sites; different paths compare those two exact pages.
 */
export function routesForTargets(targets: readonly TargetURL[]): RouteInput[] | undefined {
  const [production, staging] = targets;
  if (!staging) return production?.route ? [production.route] : undefined;
  if (production!.route && staging.route) {
    return production!.route === staging.route
      ? [production!.route]
      : [{ path: production!.route, staging: staging.route }];
  }
  const route = production!.route ?? staging.route;
  return route ? [route] : undefined;
}

export function registerZeroConfigCommand(program: Command): void {
  program
    .argument("[urls...]", "one URL to scan, or two URLs (production, staging) to compare")
    .option("-c, --config <path>", "config file path (viewports, stabilisation and AI settings)")
    .option("--only <glob>", "filter routes; repeatable", collect)
    .option("--viewport <name>", "run only this viewport; repeatable", collect)
    .option("--concurrency <n>", "pages captured in parallel", parsePositiveInt)
    .addOption(
      new Option("--fail-on <level>", "what makes the exit code non-zero")
        .choices(FAIL_ON_VALUES as string[])
        .default("regression"),
    )
    .option("--ci", "no prompts, colours or spinners")
    .option("--json", "print the manifest JSON to stdout")
    .option("--debug", "save Playwright traces");
  addAIOptions(program).action(async (urls: string[], flags: ZeroConfigFlags) => {
    if (urls.length === 0) program.help();
    process.exitCode = await runZeroConfig(urls, flags);
  });
}

export async function runZeroConfig(urls: string[], flags: ZeroConfigFlags): Promise<number> {
  if (urls.length > 2) {
    throw new ConfigError("Pass one URL to scan, or two URLs (production, staging) to compare.");
  }
  const targets = urls.map(parseTargetURL);
  const scan = targets.length === 1;
  const routes = routesForTargets(targets);

  const config = await loadResolvedConfig(flags, {
    production: targets[0]!.base,
    staging: (targets[1] ?? targets[0])!.base,
    routes,
  });

  // Without a config file, use Gemini automatically when a key is available.
  if (
    !config.configPath &&
    !flags.provider &&
    config.ai.provider === "none" &&
    process.env.GEMINI_API_KEY
  ) {
    config.ai = { ...config.ai, provider: "gemini" };
  }

  const reporters = standardReporters(config, flags, (manifest) =>
    nextSteps(manifest, Boolean(config.configPath)),
  );

  const host = targets[0]!.host.replace(/[^a-z0-9.-]+/gi, "_");
  const { manifest } = await createRun(config, {
    mode: scan ? "scan" : "compare",
    baselineDir: scan ? join(config.outputDir, "snapshots", host) : undefined,
    updateBaselines: scan,
    discoveryLimit: 25,
    failOn: flags.failOn,
    debug: flags.debug,
    ai: flags.ai === false ? false : undefined,
    reporters,
  }).start();
  return exitCodeFor(manifest, flags.failOn);
}

function nextSteps(manifest: RunManifest, hasConfig: boolean): Array<[string, string]> {
  const steps: Array<[string, string]> = [];
  if (manifest.mode === "scan") {
    const compared = manifest.jobs.some((job) => job.captures.production?.source === "baseline");
    steps.push([
      "Snapshots",
      compared
        ? "compared with the previous scan and updated"
        : "saved; the next scan compares against them",
    ]);
  }
  if (!hasConfig)
    steps.push([
      "Setup",
      "no config found; run `npx visualguard init` to compare production ↔ staging",
    ]);
  return steps;
}
