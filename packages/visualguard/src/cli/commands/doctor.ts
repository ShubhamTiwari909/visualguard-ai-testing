import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
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
  /** Exit code to use when this check fails. */
  exitCode?: number;
}

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

async function aiCheck(config: ResolvedConfig): Promise<CheckResult> {
  const { provider } = config.ai;
  if (provider === "none")
    return { name: "AI provider", status: "ok", detail: "none (heuristics only)" };
  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY
      ? { name: "AI provider", status: "ok", detail: "gemini (GEMINI_API_KEY set)" }
      : {
          name: "AI provider",
          status: "warn",
          detail: "gemini, but GEMINI_API_KEY is not set",
          hint: "Add GEMINI_API_KEY to .env.local or your CI secrets. Without it, runs fall back to heuristics.",
        };
  }
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  try {
    const response = await fetch(new URL("/api/tags", host), {
      signal: AbortSignal.timeout(3_000),
    });
    const { models = [] } = (await response.json()) as { models?: Array<{ name: string }> };
    return models.length > 0
      ? {
          name: "AI provider",
          status: "ok",
          detail: `ollama at ${host} (${models.length} model(s))`,
        }
      : {
          name: "AI provider",
          status: "warn",
          detail: `ollama at ${host} has no models`,
          hint: "Pull a vision model.",
        };
  } catch {
    return {
      name: "AI provider",
      status: "warn",
      detail: `ollama not reachable at ${host}`,
      hint: "Start Ollama or set OLLAMA_HOST. Without it, runs fall back to heuristics.",
    };
  }
}

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
