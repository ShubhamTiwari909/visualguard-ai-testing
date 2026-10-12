/**
 * @file Reads Next.js App/Pages Router files, accounting for routing conventions, to discover
 * page paths.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface FileRoute {
  /**
   * Route path with dynamic segments kept, e.g. "/blog/[slug]".
   */
  path: string;
  /**
   * Source file relative to the project root, e.g. "app/blog/[slug]/page.tsx".
   */
  file: string;
}

const PAGE_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];
const APP_PAGE = new RegExp(`^page\\.(${PAGE_EXTENSIONS.join("|")})$`);
const PAGES_FILE = new RegExp(`\\.(${PAGE_EXTENSIONS.join("|")})$`);
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git"]);

export interface NextRouterInfo {
  appDir?: string;
  pagesDir?: string;
}

/**
 * Finds `app/` and `pages/` (or their `src/` variants) in a project.
 *
 * Look for Next.js router directories relative to the project root. Return separate optional
 * app/pages paths because a project may use either router or both.
 */
export function findNextRouters(cwd: string): NextRouterInfo {
  /**
   * Return the first candidate path that exists and is a directory. find stops after its first
   * match, preserving the configured preference order.
   */
  const pick = (names: string[]) =>
    names
      .map((name) => join(cwd, name))
      .find((dir) => existsSync(dir) && statSync(dir).isDirectory());
  return {
    appDir: pick(["app", "src/app"]),
    pagesDir: pick(["pages", "src/pages"]),
  };
}

/**
 * Recursively visit files below a directory while skipping ignored entries. Pass each file to
 * the supplied callback so router-specific rules stay outside this filesystem helper.
 */
function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

/**
 * App router: every `page.*` file is a route. Route groups `(group)` are removed from the URL,
 * parallel slots `@slot`, intercepting routes `(.)x` and private folders `_x` are skipped.
 *
 * Translate App Router page files into URL paths and retain their source-file paths. Remove
 * route-group segments and skip private, parallel-slot and intercepted routes that cannot be
 * treated as independent pages.
 */
export function appRouterRoutes(appDir: string, cwd: string): FileRoute[] {
  const routes: FileRoute[] = [];
  walk(appDir, (file) => {
    const segments = relative(appDir, file).split(/[\\/]/);
    const name = segments.pop()!;
    if (!APP_PAGE.test(name)) return;

    const urlSegments: string[] = [];
    for (const segment of segments) {
      if (segment.startsWith("_")) return; // private folder
      if (segment.startsWith("@")) return; // parallel route slot
      if (/^\(\.{1,3}\)/.test(segment)) return; // intercepting route
      if (/^\(.*\)$/.test(segment)) continue; // route group
      urlSegments.push(segment);
    }
    routes.push({
      path: `/${urlSegments.join("/")}`,
      file: relative(cwd, file).split("\\").join("/"),
    });
  });
  return routes;
}

/**
 * Pages router: every file is a route except `_app`, `_document`, `_error` and `api/`.
 *
 * Translate Pages Router files into URL paths, treating index as its parent route. Exclude API
 * routes, framework special files and non-page files.
 */
export function pagesRouterRoutes(pagesDir: string, cwd: string): FileRoute[] {
  const routes: FileRoute[] = [];
  walk(pagesDir, (file) => {
    const rel = relative(pagesDir, file).split(/[\\/]/);
    if (rel[0] === "api") return;
    const name = rel.pop()!;
    if (!PAGES_FILE.test(name) || name.startsWith("_") || /\.(test|spec)\./.test(name)) return;
    if (rel.some((segment) => segment.startsWith("_"))) return;
    const base = name.replace(PAGES_FILE, "");
    const segments = base === "index" ? rel : [...rel, base];
    routes.push({
      path: `/${segments.join("/")}`,
      file: relative(cwd, file).split("\\").join("/"),
    });
  });
  return routes;
}

/**
 * All Next.js file-system routes, sorted with static routes first.
 *
 * Combine both router inventories, deduplicate route paths and put static paths before
 * parameterized paths. A predictable order makes discovery and later job planning reproducible.
 */
export function discoverNextRoutes(cwd: string): FileRoute[] {
  const { appDir, pagesDir } = findNextRouters(cwd);
  const routes = [
    ...(appDir ? appRouterRoutes(appDir, cwd) : []),
    ...(pagesDir ? pagesRouterRoutes(pagesDir, cwd) : []),
  ];
  const seen = new Set<string>();
  return routes
    .filter((route) => {
      if (seen.has(route.path)) return false;
      seen.add(route.path);
      return true;
    })
    .sort(
      (a, b) =>
        Number(a.path.includes("[")) - Number(b.path.includes("[")) || a.path.localeCompare(b.path),
    );
}
