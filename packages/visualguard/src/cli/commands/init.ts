/**
 * @file Interactive/noninteractive setup: discovers project routes and writes config, env and
 * optional workflow files.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import * as p from "@clack/prompts";
import { Option, type Command } from "commander";
import pc from "picocolors";
import { CONFIG_FILE_NAMES, findConfigFile } from "../../config/load.js";
import { discoverNextRoutes } from "../../config/discover/nextjs.js";
import { crawlRoutes, discoverSitemapRoutes } from "../../config/discover/web.js";
import { isDynamicRoute } from "../../config/urls.js";
import { ConfigError, errorMessage } from "../../core/errors.js";
import { checkReachable } from "../../core/reachability.js";
import {
  renderConfig,
  VIEWPORT_PRESETS,
  type AIProviderName,
  type InitAnswers,
  type ViewportPreset,
} from "../../setup/config-template.js";
import { renderWorkflow } from "../../setup/workflow-template.js";
import {
  addDevDependencyCommand,
  addPackageScript,
  detectProject,
  ensureGitignore,
  execCommand,
  FRAMEWORK_LABEL,
  setEnvVar,
  type ProjectInfo,
} from "../../setup/project.js";

export interface InitFlags {
  yes?: boolean;
  production?: string;
  staging?: string;
  ai?: AIProviderName;
  force?: boolean;
  /**
   * Write .github/workflows/visualguard.yml (asked interactively).
   */
  workflow?: boolean;
}

export interface InitResult {
  configPath: string;
  answers: InitAnswers;
  created: string[];
}

const MAX_ROUTES = 50;

/**
 * Register the init command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("set up VisualGuard: writes visualguard.config.ts")
    .option("-y, --yes", "accept defaults without prompting")
    .option("--production <url>", "production URL")
    .option("--staging <url>", "staging or preview URL")
    .addOption(new Option("--ai <provider>", "AI provider").choices(["gemini", "ollama", "none"]))
    .option("--force", "overwrite an existing config file")
    .option("--workflow", "also write .github/workflows/visualguard.yml")
    .action(async (flags: InitFlags) => {
      await runInit(process.cwd(), flags);
    });
}

/**
 * Return a prompt validation message for missing, malformed or non-HTTP URLs. Returning
 * undefined is the prompt library's signal that the input is valid.
 */
function validateURL(value: string | undefined): string | undefined {
  if (!value) return "Enter a URL";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http(s) URL";
  } catch {
    return "Enter a full URL, e.g. https://example.com";
  }
  return undefined;
}

/**
 * Stop setup when the prompt library returns its cancellation symbol. Otherwise narrow the
 * answer type so subsequent code can use the selected value.
 */
function cancelled<T>(value: T): Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }
  return value as Exclude<T, symbol>;
}

interface RouteCandidates {
  routes: string[];
  dynamic: string[];
  source: string;
}

/**
 * Collect setup suggestions from framework routes and available web discovery. Deduplicate and
 * bound the suggestions, retaining dynamic-route information for explicit parameter input.
 */
async function findRouteCandidates(
  cwd: string,
  project: ProjectInfo,
  production: string,
): Promise<RouteCandidates> {
  const routes = new Set<string>();
  const dynamic: string[] = [];
  const sources: string[] = [];

  if (project.framework === "nextjs") {
    const fileRoutes = discoverNextRoutes(cwd);
    for (const route of fileRoutes) {
      if (isDynamicRoute(route.path)) dynamic.push(route.path);
      else routes.add(route.path);
    }
    if (fileRoutes.length > 0) sources.push(project.router === "pages" ? "pages/" : "app/");
  }
  const sitemap = await discoverSitemapRoutes(production, { limit: MAX_ROUTES * 2 }).catch(
    () => [],
  );
  if (sitemap.length > 0) sources.push("sitemap.xml");
  for (const route of sitemap) routes.add(route);

  if (routes.size === 0) {
    const crawled = await crawlRoutes(production, { depth: 1, limit: 20 }).catch(() => []);
    if (crawled.length > 0) sources.push("links on the home page");
    for (const route of crawled) routes.add(route);
  }
  routes.add("/");
  const sorted = [...routes].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  return {
    routes: sorted.slice(0, MAX_ROUTES * 2),
    dynamic,
    source: sources.join(" and ") || "defaults",
  };
}

/**
 * Interactive (or `--yes`) setup. Returns what was written, for tests.
 *
 * Detect the project, gather setup answers and write configuration plus selected integration
 * files. Return the created paths and answers so the setup workflow is inspectable in tests.
 */
export async function runInit(cwd: string, flags: InitFlags): Promise<InitResult> {
  const interactive = !flags.yes;
  const project = detectProject(cwd);
  const existing = findConfigFile(cwd);

  if (interactive) {
    p.intro(pc.bgCyan(pc.black(" VisualGuard setup ")));
    const router = project.router ? ` (${project.router.replace("+", " + ")} router)` : "";
    p.log.info(
      `Detected ${FRAMEWORK_LABEL[project.framework]}${router} · ${project.packageManager}`,
    );
  }

  if (existing && !flags.force) {
    const overwrite = interactive
      ? cancelled(
          await p.confirm({
            message: `${relative(cwd, existing)} already exists. Overwrite it?`,
            initialValue: false,
          }),
        )
      : false;
    if (!overwrite) {
      if (interactive) p.outro("Kept the existing config.");
      throw new ConfigError(`${relative(cwd, existing)} already exists`, {
        hint: "Pass --force to overwrite it.",
      });
    }
  }

  // URLs
  let production = flags.production;
  if (!production && interactive) {
    production = cancelled(
      await p.text({
        message: "Production URL",
        placeholder: "https://example.com",
        validate: validateURL,
      }),
    );
  }
  if (!production) throw new ConfigError("init --yes needs --production <url>");
  const invalid = validateURL(production);
  if (invalid) throw new ConfigError(`Invalid production URL: ${invalid}`);

  let staging = flags.staging;
  if (staging === undefined && interactive) {
    const value = cancelled(
      await p.text({
        message: "Staging / preview URL",
        placeholder: "https://staging.example.com (leave empty to use VISUALGUARD_STAGING_URL)",
        /**
         * Validate an optional URL only when the prompt contains a value. Leaving it blank is
         * supported by this setup question.
         */
        validate: (input) => (input ? validateURL(input) : undefined),
      }),
    );
    staging = value || undefined;
  }
  if (staging && validateURL(staging))
    throw new ConfigError(`Invalid staging URL: ${validateURL(staging)}`);

  if (interactive) {
    const spin = p.spinner();
    spin.start("Checking URLs");
    const checks = await Promise.allSettled([
      checkReachable("production", production),
      ...(staging ? [checkReachable("staging", staging)] : []),
    ]);
    const failed = checks.filter((check) => check.status === "rejected");
    if (failed.length > 0) {
      spin.stop(pc.yellow("Some URLs did not respond"));
      for (const check of failed) p.log.warn(errorMessage((check as PromiseRejectedResult).reason));
    } else {
      spin.stop("URLs respond");
    }
  }

  // Routes
  let routes: string[];
  let dynamicRoutes: string[];
  if (interactive) {
    const spin = p.spinner();
    spin.start("Looking for routes");
    const candidates = await findRouteCandidates(cwd, project, production);
    spin.stop(`Found ${candidates.routes.length} route(s) in ${candidates.source}`);
    const selected = cancelled(
      await p.multiselect({
        message: "Routes to test",
        options: candidates.routes.map((route) => ({ value: route, label: route })),
        initialValues: candidates.routes.slice(0, 20),
        required: true,
      }),
    );
    routes = selected;
    dynamicRoutes = candidates.dynamic;
    if (dynamicRoutes.length > 0) {
      p.log.info(
        `${dynamicRoutes.length} dynamic route(s) need params, e.g. ${dynamicRoutes[0]}. They're added to the config as commented examples.`,
      );
    }
  } else {
    const candidates = await findRouteCandidates(cwd, project, production);
    routes = candidates.routes.slice(0, 20);
    dynamicRoutes = candidates.dynamic;
  }

  // Viewports
  let viewports: ViewportPreset[] = ["desktop", "mobile"];
  if (interactive) {
    viewports = cancelled(
      await p.multiselect({
        message: "Viewports",
        options: (Object.keys(VIEWPORT_PRESETS) as ViewportPreset[]).map((name) => ({
          value: name,
          label: `${name[0]!.toUpperCase()}${name.slice(1)} ${VIEWPORT_PRESETS[name].width}×${VIEWPORT_PRESETS[name].height}`,
        })),
        initialValues: viewports,
        required: true,
      }),
    );
  }

  // AI provider
  let ai: AIProviderName = flags.ai ?? (interactive ? "gemini" : "none");
  let geminiKey: string | undefined;
  if (interactive && !flags.ai) {
    ai = cancelled(
      await p.select({
        message: "AI provider",
        options: [
          { value: "gemini" as const, label: "Gemini", hint: "cloud, free tier available" },
          { value: "ollama" as const, label: "Ollama", hint: "local, free, private" },
          { value: "none" as const, label: "None", hint: "pixel diff and DOM explanations only" },
        ],
        initialValue: "gemini" as const,
      }),
    );
  }
  if (interactive && ai === "gemini") {
    p.note(
      "On Google's free (unpaid) tier, submitted content may be used to improve Google products.\n" +
        "That includes screenshots of unreleased staging pages. For confidential work, use Ollama\n" +
        "or a paid key. Check Google's current terms for details.",
      "Gemini privacy",
    );
    if (!process.env.GEMINI_API_KEY) {
      const key = cancelled(
        await p.password({ message: "GEMINI_API_KEY (leave empty to set it later)", mask: "▪" }),
      );
      geminiKey = key || undefined;
    } else {
      p.log.info("Using GEMINI_API_KEY from the environment.");
    }
  }
  if (interactive && ai === "ollama") await describeOllama();

  // CI workflow
  const workflowPath = join(cwd, ".github", "workflows", "visualguard.yml");
  let workflow = Boolean(flags.workflow);
  if (interactive && flags.workflow === undefined) {
    workflow = cancelled(
      await p.confirm({
        message: existsSync(workflowPath)
          ? "Replace .github/workflows/visualguard.yml?"
          : "Add a GitHub Actions workflow (PR comment, report artifact)?",
        initialValue: !existsSync(workflowPath),
      }),
    );
  }

  // Write files
  const answers: InitAnswers = { production, staging, routes, dynamicRoutes, viewports, ai };
  const configPath = existing ?? join(cwd, CONFIG_FILE_NAMES[0]);
  writeFileSync(configPath, renderConfig(answers));
  const created = [relative(cwd, configPath)];

  const ignored = ensureGitignore(cwd, [".visualguard/", ".env.local"]);
  if (geminiKey) {
    setEnvVar(join(cwd, ".env.local"), "GEMINI_API_KEY", geminiKey);
    created.push(".env.local (GEMINI_API_KEY)");
  }
  const scriptAdded = addPackageScript(cwd, "visual", "visualguard test");
  if (workflow && (!existsSync(workflowPath) || interactive || flags.force)) {
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, renderWorkflow(project.packageManager, { ai: ai === "gemini" }));
    created.push(relative(cwd, workflowPath));
  }

  if (interactive) {
    p.log.success(`Created ${relative(cwd, configPath)}`);
    if (ignored.length > 0) p.log.success(`Added ${ignored.join(", ")} to .gitignore`);
    if (geminiKey) p.log.success("Saved GEMINI_API_KEY to .env.local");
    if (scriptAdded) p.log.success(`Added "visual": "visualguard test" to package.json scripts`);
    if (created.some((file) => file.endsWith("visualguard.yml"))) {
      p.log.success(
        `Created ${relative(cwd, workflowPath)}${ai === "gemini" ? " (add GEMINI_API_KEY to the repository secrets)" : ""}`,
      );
    }
    await ensurePlaywright(cwd, project);
    p.outro(`Run ${pc.cyan("npx visualguard test")} to begin.`);
  }
  return { configPath, answers, created };
}

/**
 * Show whether a local Ollama installation and suitable models are reachable. A bounded fetch
 * keeps this optional setup explanation from waiting indefinitely.
 */
async function describeOllama(): Promise<void> {
  const host = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
  try {
    const response = await fetch(new URL("/api/tags", host), {
      signal: AbortSignal.timeout(3_000),
    });
    const { models = [] } = (await response.json()) as { models?: Array<{ name: string }> };
    if (models.length === 0) {
      p.log.warn(
        "Ollama is running but has no models. Pull a vision model, e.g. `ollama pull qwen2.5vl`.",
      );
    } else {
      p.log.info(`Ollama models: ${models.map((model) => model.name).join(", ")}`);
    }
  } catch {
    p.log.warn(
      `Ollama is not reachable at ${host}. Install it from https://ollama.com and pull a vision model.`,
    );
  }
}

/**
 * Install missing Playwright dependencies/browser binaries using the detected package manager.
 * Report an installation failure with a command the developer can run manually.
 */
async function ensurePlaywright(cwd: string, project: ProjectInfo): Promise<void> {
  const browserInstall = execCommand(project.packageManager, ["playwright", "install", "chromium"]);
  if (project.playwrightVersion) {
    p.log.success(`Playwright ${project.playwrightVersion} found`);
    p.log.info(`If Chromium is missing, run: ${browserInstall.join(" ")}`);
    return;
  }
  const install = addDevDependencyCommand(project.packageManager, ["playwright"]);
  const ok = cancelled(
    await p.confirm({
      message: `Playwright is not installed. Run "${install.join(" ")}" now?`,
      initialValue: true,
    }),
  );
  if (!ok) {
    p.log.warn(`Install it later: ${install.join(" ")} && ${browserInstall.join(" ")}`);
    return;
  }
  for (const command of [install, browserInstall]) {
    const result = spawnSync(command[0]!, command.slice(1), {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      p.log.error(
        `"${command.join(" ")}" failed. Run it yourself, then \`npx visualguard doctor\`.`,
      );
      return;
    }
  }
  p.log.success("Installed Playwright and Chromium");
}
