import { InvalidArgumentError, Option, type Command } from "commander";
import pc from "picocolors";
import { loadConfig, loadEnvFiles } from "../config/load.js";
import { resolveConfig, type ConfigOverrides, type ResolvedConfig } from "../config/resolve.js";
import { join, relative, resolve } from "node:path";
import { ConfigError, ExitCode, VisualGuardError, errorMessage } from "../core/errors.js";
import type { Reporter } from "../core/run.js";
import type { FailOn, RunManifest } from "../core/types.js";
import { githubSummaryReporter, junitReporter, webhookReporter } from "../reporters/ci.js";
import { htmlReporter, reportPath } from "../reporters/html.js";
import { jsonReporter } from "../reporters/json.js";
import { terminalReporter } from "../reporters/terminal.js";

export const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

export function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError("expected a positive integer");
  }
  return parsed;
}

export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CI && env.CI !== "false" && env.CI !== "0");
}

/** Plain output (no colours or box drawing) in CI or when stdout is not a terminal. */
export function usePlainOutput(
  ciFlag: boolean | undefined,
  stream: NodeJS.WriteStream = process.stdout,
): boolean {
  return Boolean(ciFlag) || isCI() || !stream.isTTY;
}

export interface ConfigFlags {
  config?: string;
  production?: string;
  staging?: string;
  route?: string[];
  only?: string[];
  viewport?: string[];
  concurrency?: number;
  provider?: "gemini" | "ollama" | "none";
  model?: string;
}

/** Loads .env files and the config, then applies CLI overrides. */
export async function loadResolvedConfig(
  flags: ConfigFlags,
  extra: Partial<ConfigOverrides> = {},
): Promise<ResolvedConfig> {
  const cwd = process.cwd();
  loadEnvFiles(cwd);
  const { config, configPath } = await loadConfig({ cwd, configPath: flags.config });
  return resolveConfig(config, {
    cwd,
    configPath,
    overrides: {
      production: flags.production,
      staging: flags.staging,
      routes: flags.route,
      only: flags.only,
      viewports: flags.viewport,
      concurrency: flags.concurrency,
      aiProvider: flags.provider,
      aiModel: flags.model,
      ...extra,
    },
  });
}

export function requireCompareURLs(config: ResolvedConfig): void {
  if (config.baseURL.production && config.baseURL.staging) return;
  if (!config.configPath) {
    throw new ConfigError("No visualguard.config.ts found and no URLs given.", {
      hint: "Run `npx visualguard init`, or pass --production <url> --staging <url>.",
    });
  }
}

/** Prints an error with its hint and returns the exit code to use. */
export function reportError(
  error: unknown,
  stream: NodeJS.WritableStream = process.stderr,
): number {
  const colors = pc.createColors(pc.isColorSupported && !isCI());
  if (error instanceof VisualGuardError) {
    stream.write(`${colors.red("✖")} ${error.message}\n`);
    if (error.hint) stream.write(`  ${colors.dim(error.hint)}\n`);
    return error.exitCode;
  }
  stream.write(`${colors.red("✖")} Unexpected error: ${errorMessage(error)}\n`);
  if (process.env.VISUALGUARD_DEBUG && error instanceof Error && error.stack) {
    stream.write(`${colors.dim(error.stack)}\n`);
  } else {
    stream.write(`  ${colors.dim("Set VISUALGUARD_DEBUG=1 to see the stack trace.")}\n`);
  }
  return ExitCode.Failed;
}

export interface OutputFlags {
  ci?: boolean;
  json?: boolean;
  junit?: string;
  failOn?: FailOn;
}

/** Terminal (to stderr with --json), HTML report and optional JSON reporters. */
export function standardReporters(
  config: ResolvedConfig,
  flags: OutputFlags,
  extraSteps?: (manifest: RunManifest) => Array<[string, string]>,
): Reporter[] {
  const stream = flags.json ? process.stderr : process.stdout;
  const plain = usePlainOutput(flags.ci, stream as NodeJS.WriteStream);
  const reporters: Reporter[] = [
    terminalReporter({
      stream,
      plain,
      nextSteps: (manifest) => {
        const steps: Array<[string, string]> = [];
        if (config.report.html) {
          steps.push([
            "Report",
            plain
              ? relative(process.cwd(), reportPath(join(config.outputDir, "runs", manifest.id)))
              : "npx visualguard report",
          ]);
        }
        return [...steps, ...(extraSteps?.(manifest) ?? [])];
      },
    }),
  ];
  if (config.report.html) reporters.push(htmlReporter());
  if (flags.json) reporters.push(jsonReporter());
  const junit = flags.junit ?? config.report.junit;
  if (junit)
    reporters.push(junitReporter(resolve(config.cwd, junit), flags.failOn ?? "regression"));
  if (config.report.githubSummary && process.env.GITHUB_STEP_SUMMARY) {
    reporters.push(githubSummaryReporter(process.env.GITHUB_STEP_SUMMARY, config.report.publicURL));
  }
  const webhook = process.env.VISUALGUARD_WEBHOOK_URL ?? config.report.webhook;
  if (webhook) {
    reporters.push(
      webhookReporter(webhook, {
        reportURL: config.report.publicURL,
        warn: (message) => process.stderr.write(`  ⚠ ${message}\n`),
      }),
    );
  }
  return reporters;
}

/** `--provider`, `--model` and `--no-ai`. */
export function addAIOptions(command: Command): Command {
  return command
    .addOption(new Option("--provider <name>", "AI provider").choices(["gemini", "ollama", "none"]))
    .option("--model <id>", "AI model id")
    .option("--no-ai", "skip AI analysis (heuristics only)");
}
