/**
 * @file Runs environment/config/browser/URL diagnostics and prints actionable setup results.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { createProvider } from "../../ai/factory.js";
import { GeminiProvider } from "../../ai/providers/gemini.js";
import { OllamaProvider } from "../../ai/providers/ollama.js";
import { launchBrowser, playwrightVersion } from "../../capture/browser.js";
import { loadConfig, loadEnvFiles } from "../../config/load.js";
import { resolveConfig, type ResolvedConfig } from "../../config/resolve.js";
import { ExitCode, errorMessage, VisualGuardError } from "../../core/errors.js";
import { checkReachable } from "../../core/reachability.js";
import { ENVS } from "../../core/types.js";
import { isCI } from "../shared.js";

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  hint?: string;
  /**
   * Exit code to use when this check fails.
   */
  exitCode?: number;
}

/**
 * Register the doctor command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("check Playwright, the config, the URLs and the AI provider")
    .option("-c, --config <path>", "config file path")
    .action(async (flags: { config?: string }) => {
      const results = await runDoctor(process.cwd(), flags);
      printResults(results);
      const failed = results.filter((result) => result.status === "fail");
      process.exitCode =
        failed.length === 0
          ? ExitCode.Ok
          : Math.max(...failed.map((r) => r.exitCode ?? ExitCode.Environment));
    });
}

/**
 * Compare the running Node.js major/minor version with the package minimum. Return a structured
 * diagnostic instead of throwing so doctor can report several problems together.
 */
function nodeCheck(): CheckResult {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const ok = major > 22 || (major === 22 && minor >= 12);
  return {
    name: "Node.js",
    status: ok ? "ok" : "fail",
    detail: process.versions.node,
    hint: ok ? undefined : "VisualGuard needs Node.js 22.12 or newer.",
  };
}

/**
 * Check Playwright installation and whether its configured browser can launch. Convert failures
 * into diagnostic entries with installation hints.
 */
async function playwrightChecks(config: ResolvedConfig | undefined): Promise<CheckResult[]> {
  const version = playwrightVersion();
  if (!version) {
    return [
      {
        name: "Playwright",
        status: "fail",
        detail: "not installed",
        hint: "npm install -D playwright && npx playwright install chromium",
      },
    ];
  }
  const results: CheckResult[] = [{ name: "Playwright", status: "ok", detail: version }];
  if (config) {
    try {
      const browser = await launchBrowser(config);
      results.push({
        name: "Browser",
        status: "ok",
        detail: `${config.browser.name} ${browser.version()}`,
      });
      await browser.close();
    } catch (error) {
      results.push({
        name: "Browser",
        status: "fail",
        detail: errorMessage(error),
        hint: error instanceof VisualGuardError ? error.hint : undefined,
      });
    }
  }
  return results;
}

/**
 * Check configured environment URLs concurrently and return one result per environment.
 * Promise.all waits for every check while each callback handles its own failure.
 */
async function urlChecks(config: ResolvedConfig): Promise<CheckResult[]> {
  return Promise.all(
    ENVS.map(async (env): Promise<CheckResult> => {
      const url = config.baseURL[env];
      if (!url) {
        return {
          name: `${env} URL`,
          status: "warn",
          detail: "not set",
          hint: `Set baseURL.${env}, VISUALGUARD_${env.toUpperCase()}_URL or pass --${env}.`,
        };
      }
      try {
        const headers = Object.fromEntries(
          Object.entries(config.environments[env]?.headers ?? {}).filter(
            ([, value]) => value !== "",
          ),
        );
        const { status } = await checkReachable(env, url, headers);
        return {
          name: `${env} URL`,
          status: status < 400 ? "ok" : "warn",
          detail: `${url} → HTTP ${status}`,
          hint: status >= 400 ? "The site responds with an error status." : undefined,
        };
      } catch (error) {
        return { name: `${env} URL`, status: "fail", detail: errorMessage(error) };
      }
    }),
  );
}

/**
 * Check the configured provider and model availability without performing visual analysis.
 * Disabled AI is valid; an unavailable optional provider becomes a diagnostic rather than a
 * screenshot failure.
 */
async function aiCheck(config: ResolvedConfig): Promise<CheckResult> {
  const name = "AI provider";
  if (config.ai.provider === "none")
    return { name, status: "ok", detail: "none (heuristics only)" };
  const { provider, reason } = createProvider(config.ai);
  if (!provider) {
    return {
      name,
      status: "warn",
      detail: `${config.ai.provider}: ${reason}`,
      hint: "Add GEMINI_API_KEY to .env.local or your CI secrets. Without it, runs fall back to heuristics.",
    };
  }
  try {
    if (provider instanceof GeminiProvider) {
      const models = await provider.listModels();
      const available = models.includes(provider.model);
      return available
        ? { name, status: "ok", detail: `gemini (${provider.model})` }
        : {
            name,
            status: "warn",
            detail: `gemini: model "${provider.model}" not in this key's model list`,
            hint: `Set ai.model to one of: ${models
              .filter((model) => /gemini/.test(model))
              .slice(0, 6)
              .join(", ")}`,
          };
    }
    if (provider instanceof OllamaProvider) {
      const models = await provider.listModels();
      const model = models.find(
        (item) => item.name === provider.model || item.name.startsWith(`${provider.model}:`),
      );
      if (!model) {
        return {
          name,
          status: "warn",
          detail: `ollama at ${provider.host}: "${provider.model}" is not installed`,
          hint: `Run: ollama pull ${provider.model}`,
        };
      }
      return model.vision === false
        ? {
            name,
            status: "warn",
            detail: `ollama: "${model.name}" can't read images`,
            hint: "Pick a vision model.",
          }
        : { name, status: "ok", detail: `ollama at ${provider.host} (${model.name})` };
    }
    return { name, status: "ok", detail: provider.name };
  } catch (error) {
    return {
      name,
      status: "warn",
      detail: `${config.ai.provider}: ${errorMessage(error)}`,
      hint: "Without a working provider, runs fall back to heuristics.",
    };
  }
}

/**
 * Check that report output is writable and ignored by Git. Temporary filesystem probes test
 * actual access instead of relying only on a path string.
 */
function outputChecks(config: ResolvedConfig): CheckResult[] {
  const results: CheckResult[] = [];
  try {
    mkdirSync(config.outputDir, { recursive: true });
    accessSync(config.outputDir, constants.W_OK);
    results.push({
      name: "Output directory",
      status: "ok",
      detail: relative(config.cwd, config.outputDir) || ".",
    });
  } catch (error) {
    results.push({ name: "Output directory", status: "fail", detail: errorMessage(error) });
  }
  const gitignore = join(config.cwd, ".gitignore");
  const dir = config.output.dir.replace(/^\.\//, "").replace(/\/$/, "");
  const ignored =
    existsSync(gitignore) &&
    readFileSync(gitignore, "utf8")
      .split(/\r?\n/)
      .some((line) => line.trim().replace(/^\//, "").replace(/\/$/, "") === dir);
  results.push({
    name: ".gitignore",
    status: ignored ? "ok" : "warn",
    detail: ignored ? `${dir}/ is ignored` : `${dir}/ is not ignored`,
    hint: ignored ? undefined : `Add ${dir}/ to .gitignore so screenshots aren't committed.`,
  });
  return results;
}

/**
 * Collect Node, configuration, browser, URL, provider and output diagnostics. Continue with
 * checks that can run even when another prerequisite is unavailable.
 */
export async function runDoctor(
  cwd: string,
  flags: { config?: string } = {},
): Promise<CheckResult[]> {
  const results: CheckResult[] = [nodeCheck()];
  loadEnvFiles(cwd);

  let config: ResolvedConfig | undefined;
  try {
    const loaded = await loadConfig({ cwd, configPath: flags.config });
    config = resolveConfig(loaded.config, { cwd, configPath: loaded.configPath });
    results.push(
      loaded.configPath
        ? { name: "Config", status: "ok", detail: relative(cwd, loaded.configPath) }
        : {
            name: "Config",
            status: "warn",
            detail: "no visualguard.config.ts",
            hint: "Run `npx visualguard init`.",
          },
    );
  } catch (error) {
    results.push({
      name: "Config",
      status: "fail",
      detail: errorMessage(error),
      hint: error instanceof VisualGuardError ? error.hint : undefined,
      exitCode: ExitCode.Usage,
    });
  }

  results.push(...(await playwrightChecks(config)));
  if (config) {
    results.push(...(await urlChecks(config)));
    results.push(await aiCheck(config));
    results.push(...outputChecks(config));
  }
  return results;
}

/**
 * Render diagnostic symbols, details and hints to the supplied stream. Keep the result data
 * separate from rendering so tests and CLI callers can inspect it directly.
 */
export function printResults(
  results: CheckResult[],
  stream: NodeJS.WritableStream = process.stdout,
): void {
  const colors = pc.createColors(pc.isColorSupported && !isCI());
  const symbol = { ok: colors.green("✓"), warn: colors.yellow("⚠"), fail: colors.red("✖") };
  const width = Math.max(...results.map((result) => result.name.length));
  stream.write("\n");
  for (const result of results) {
    stream.write(`  ${symbol[result.status]}  ${result.name.padEnd(width)}  ${result.detail}\n`);
    if (result.hint && result.status !== "ok")
      stream.write(`     ${" ".repeat(width)}  ${colors.dim(result.hint)}\n`);
  }
  const failed = results.filter((result) => result.status === "fail").length;
  const warned = results.filter((result) => result.status === "warn").length;
  stream.write(
    `\n  ${failed === 0 ? colors.green("Ready.") : colors.red(`${failed} problem(s) to fix.`)}${warned ? colors.dim(` ${warned} warning(s).`) : ""}\n\n`,
  );
}
