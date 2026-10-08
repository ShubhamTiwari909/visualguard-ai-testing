import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface FileRoute {
  /** Route path with dynamic segments kept, e.g. "/blog/[slug]". */
  path: string;
  /** Source file relative to the project root, e.g. "app/blog/[slug]/page.tsx". */
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

/** Finds `app/` and `pages/` (or their `src/` variants) in a project. */
export function findNextRouters(cwd: string): NextRouterInfo {
  const pick = (names: string[]) =>
    names
      .map((name) => join(cwd, name))
      .find((dir) => existsSync(dir) && statSync(dir).isDirectory());
  return {
    appDir: pick(["app", "src/app"]),
    pagesDir: pick(["pages", "src/pages"]),
  };
}

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

/** Pages router: every file is a route except `_app`, `_document`, `_error` and `api/`. */
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

/** All Next.js file-system routes, sorted with static routes first. */
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
