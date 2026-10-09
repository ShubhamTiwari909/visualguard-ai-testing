/**
 * @file Watches source files, traces page import relationships and re-runs affected routes
 * against a dev server.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, watch, type FSWatcher } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { matchesAny } from "../../config/glob.js";
import { discoverNextRoutes } from "../../config/discover/nextjs.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { resolveRoutes } from "../../config/routes.js";
import { ConfigError } from "../../core/errors.js";
import { createRun } from "../../core/run.js";
import { listSourceFiles } from "../../fixer/files.js";
import { localImports } from "../../fixer/locate.js";
import { DevServer } from "../../fixer/verify.js";
import { htmlReporter } from "../../reporters/html.js";
import { terminalReporter } from "../../reporters/terminal.js";
import { addAIOptions, collect, loadResolvedConfig, type ConfigFlags } from "../shared.js";

export interface WatchFlags extends ConfigFlags {
  ai?: boolean;
}

/**
 * Top-level directories to watch, from glob patterns like "app/**" or "src/components/**".
 *
 * Find existing fixed directory prefixes of include globs. Watching these roots avoids trying
 * to watch wildcard text as though it were a filesystem path.
 */
export function watchRoots(cwd: string, include: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const pattern of include) {
    const fixed = pattern
      .split("/")
      .filter(
        (segment, index, all) =>
          !/[*?[{]/.test(segment) && all.slice(0, index).every((part) => !/[*?[{]/.test(part)),
      );
    const dir = resolve(cwd, fixed.join("/") || ".");
    if (existsSync(dir)) roots.add(dir);
  }
  return [...roots];
}

/**
 * Reverse import graph: file → files that import it (project-relative paths).
 *
 * Build a reverse dependency map from a source file to the files that import it. Reverse edges
 * allow a changed shared component to be traced back toward route pages.
 */
export function importers(cwd: string, include: readonly string[]): Map<string, Set<string>> {
  const files = listSourceFiles(cwd, include);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    for (const imported of localImports(file, byPath)) {
      const set = graph.get(imported) ?? new Set<string>();
      set.add(file.path);
      graph.set(imported, set);
    }
  }
  return graph;
}

/**
 * Routes affected by changed files (PLAN.md §14.1): a route is affected when its page file, or
 * anything the page imports (a few levels deep), changed. Returns undefined when a change can't
 * be traced to a page (global CSS, config), meaning "re-test everything".
 *
 * Walk importer edges from changed files to route pages and return affected routes. Return
 * undefined when a change cannot be safely localized, instructing the watcher to test every
 * route.
 */
export function affectedRoutes(
  changed: readonly string[],
  pages: ReadonlyArray<{ path: string; file: string }>,
  graph: Map<string, Set<string>>,
): string[] | undefined {
  const routes = new Set<string>();
  for (const file of changed) {
    const seen = new Set<string>([file]);
    let frontier = [file];
    for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const importer of graph.get(current) ?? []) {
          if (!seen.has(importer)) {
            seen.add(importer);
            next.push(importer);
          }
        }
      }
      frontier = next;
    }
    const hits = pages.filter((page) => seen.has(page.file));
    if (hits.length === 0) return undefined;
    for (const page of hits) routes.add(page.path);
  }
  return [...routes];
}

/**
 * Register the watch command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerWatchCommand(program: Command): void {
  const command = program
    .command("watch")
    .description("re-test changed routes against your local dev server whenever you save")
    .argument("[routes...]", "routes or globs to watch (default: all configured routes)")
    .option("-c, --config <path>", "config file path")
    .option(
      "--staging <url>",
      "local URL to test (default: fix.verify.server.url, then baseURL.staging)",
    )
    .option("--viewport <name>", "run only this viewport; repeatable", collect);
  addAIOptions(command).action(async (routes: string[], flags: WatchFlags) => {
    await runWatch(routes, flags);
  });
}

/**
 * Watch source roots and coordinate repeated runs against the local server. Track pending
 * changes separately from the active run so edits arriving during capture are handled
 * afterward.
 */
export async function runWatch(routes: string[], flags: WatchFlags): Promise<void> {
  const config: ResolvedConfig = await loadResolvedConfig({
    ...flags,
    staging: flags.staging ?? undefined,
    only: routes.length > 0 ? routes : undefined,
  });
  const local = flags.staging ?? config.fix.verify.server?.url ?? config.baseURL.staging;
  if (!local)
    throw new ConfigError("Nothing to watch: set fix.verify.server.url or pass --staging <url>.");
  config.baseURL.staging = local;
  if (config.mode === "baseline") config.baseURL.production ??= local;
  if (!config.baseURL.production)
    throw new ConfigError('Set baseURL.production (or use mode: "baseline").');

  const server =
    config.fix.verify.server && config.fix.verify.server.url === local
      ? new DevServer(config.fix.verify.server, config.cwd)
      : undefined;
  await server?.ensure();

  /**
   * Write one timestamp/progress line to stdout. A default empty string supports blank
   * separator lines.
   */
  const write = (line = "") => process.stdout.write(`${line}\n`);
  const allRoutes = (await resolveRoutes(config)).routes;
  const pages = discoverNextRoutes(config.cwd);
  let graph = importers(config.cwd, config.fix.include);
  let running = false;
  let pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;

  /**
   * Run the requested route subset and update watch progress. When the run finishes, schedule
   * any changes that accumulated while it was busy.
   */
  const test = async (only: string[] | undefined, reason: string) => {
    running = true;
    write(pc.dim(`\n[${new Date().toLocaleTimeString()}] ${reason}`));
    const runConfig: ResolvedConfig = {
      ...config,
      routes: allRoutes
        .filter((route) => !only || only.includes(route.route))
        .map((route) => ({
          path: route.paths.production,
          staging: route.paths.staging,
          mask: route.mask,
          hide: route.hide,
          waitFor: route.waitFor,
        })),
    };
    try {
      await createRun(runConfig, {
        ...(config.mode === "baseline"
          ? { mode: "baseline" as const, baselineDir: resolve(config.cwd, config.baseline.dir) }
          : {}),
        ai: flags.ai === false ? false : undefined,
        skipReachabilityCheck: true,
        reporters: [terminalReporter({ plain: !process.stdout.isTTY }), htmlReporter()],
      }).start();
    } catch (error) {
      write(pc.red(`  ✖ ${error instanceof Error ? error.message : String(error)}`));
    }
    running = false;
    if (pending.size > 0) schedule();
    else write(pc.dim("Watching for changes… (Ctrl+C to stop)"));
  };

  /**
   * Debounce rapid filesystem notifications into one run after a short delay. Clearing the
   * previous timer combines a burst of saves rather than starting overlapping browser runs.
   */
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (running) return;
      const changed = [...pending];
      pending = new Set();
      graph = importers(config.cwd, config.fix.include);
      const affected = affectedRoutes(changed, pages, graph);
      const label = changed.slice(0, 3).join(", ") + (changed.length > 3 ? ", …" : "");
      if (affected && affected.length === 0) return;
      void test(
        affected,
        affected ? `${label} changed → ${affected.join(", ")}` : `${label} changed → all routes`,
      );
    }, 600);
  };

  const watchers: FSWatcher[] = watchRoots(config.cwd, config.fix.include).map((root) =>
    watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const path = relative(config.cwd, join(root, filename.toString())).split("\\").join("/");
      if (/(^|\/)(node_modules|\.next|\.git|\.visualguard|dist)(\/|$)/.test(path)) return;
      // Editors and tools write temporary files next to the real one (.!123!file.tsx, file.tsx~).
      if (/(^|\/)\.[^/]*$|~$|\.(swp|swx|tmp)$/.test(path)) return;
      if (!matchesAny(path, config.fix.include)) return;
      pending.add(path);
      schedule();
    }),
  );

  write(`${pc.bold("VisualGuard watch")} · ${config.baseURL.production} vs ${local}`);
  await test(undefined, "Initial run");

  await new Promise<void>((done) => {
    /**
     * Close watchers, cancel the pending timer and stop any managed server. Resolve the outer
     * wait only after the server shutdown promise finishes.
     */
    const stop = () => {
      for (const watcher of watchers) watcher.close();
      clearTimeout(timer);
      void (server?.stop() ?? Promise.resolve()).then(done);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
