import { matchesAny } from "./glob.js";
import { discoverNextRoutes } from "./discover/nextjs.js";
import { crawlRoutes, discoverSitemapRoutes } from "./discover/web.js";
import type { ResolvedConfig } from "./resolve.js";
import type { DiscoverySource, RouteDiscovery, RouteInput } from "./schema.js";
import { expandRoutes, isDynamicRoute, type ExpandRoutesResult } from "./urls.js";

export interface ResolvedRoutes extends ExpandRoutesResult {
  /** Where the routes came from, for display. */
  source: string;
  warnings: string[];
  /** Route path → source file, from file-system discovery (used by the fixer and watch mode). */
  sourceFiles: Record<string, string>;
}

export interface DiscoveryResult {
  paths: string[];
  sources: DiscoverySource[];
  sourceFiles: Record<string, string>;
  /** Dynamic file-system routes that need params. */
  dynamic: string[];
}

const DEFAULT_DISCOVERY: RouteDiscovery = {
  discover: ["sitemap", "crawl"],
  limit: 50,
  crawlDepth: 2,
};

/**
 * Runs route discovery. `crawl` only runs when the other sources found nothing, because a
 * sitemap or the file system is a better list than whatever links a crawler happens to see.
 */
export async function discoverRoutes(
  config: Pick<ResolvedConfig, "cwd" | "baseURL" | "environments">,
  discovery: RouteDiscovery,
): Promise<DiscoveryResult> {
  const baseURL = config.baseURL.production ?? config.baseURL.staging;
  const env = config.baseURL.production ? "production" : "staging";
  const headers = Object.fromEntries(
    Object.entries(config.environments[env]?.headers ?? {}).filter(([, value]) => value !== ""),
  );

  const paths = new Set<string>();
  const used: DiscoverySource[] = [];
  const sourceFiles: Record<string, string> = {};
  const dynamic: string[] = [];

  for (const source of discovery.discover) {
    let found: string[] = [];
    if (source === "nextjs") {
      for (const route of discoverNextRoutes(config.cwd)) {
        sourceFiles[route.path] = route.file;
        if (isDynamicRoute(route.path)) dynamic.push(route.path);
        else found.push(route.path);
      }
    } else if (source === "sitemap" && baseURL) {
      found = await discoverSitemapRoutes(baseURL, { headers, limit: discovery.limit * 4 });
    } else if (source === "crawl" && baseURL) {
      if (paths.size > 0) continue;
      found = await crawlRoutes(baseURL, {
        headers,
        depth: discovery.crawlDepth,
        limit: discovery.limit * 2,
      });
    }
    if (found.length > 0) used.push(source);
    for (const path of found) paths.add(path);
  }

  let result = [...paths];
  if (discovery.include?.length)
    result = result.filter((path) => matchesAny(path, discovery.include!));
  if (discovery.exclude?.length)
    result = result.filter((path) => !matchesAny(path, discovery.exclude!));
  result.sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
  return { paths: result.slice(0, discovery.limit), sources: used, sourceFiles, dynamic };
}

/** Turns the configured routes (an explicit list or discovery) into concrete paths. */
export async function resolveRoutes(
  config: ResolvedConfig,
  options: { discoveryLimit?: number } = {},
): Promise<ResolvedRoutes> {
  const warnings: string[] = [];

  if (Array.isArray(config.routes)) {
    const expanded = expandRoutes(config.routes);
    for (const route of expanded.skipped) warnings.push(`${route} skipped: no params`);
    return { ...expanded, source: "config", warnings, sourceFiles: {} };
  }

  const discovery: RouteDiscovery = config.routes ?? {
    ...DEFAULT_DISCOVERY,
    limit: options.discoveryLimit ?? DEFAULT_DISCOVERY.limit,
  };
  const found = await discoverRoutes(config, discovery);
  const inputs: RouteInput[] = [...found.paths, ...(discovery.extra ?? [])];

  if (inputs.length === 0) {
    warnings.push(
      "Route discovery found nothing; testing / only. Add routes to visualguard.config.ts.",
    );
    inputs.push("/");
  }
  if (found.dynamic.length > 0) {
    warnings.push(
      `${found.dynamic.length} dynamic route(s) need params: ${found.dynamic.slice(0, 3).join(", ")}${found.dynamic.length > 3 ? ", …" : ""}`,
    );
  }

  const expanded = expandRoutes(inputs);
  for (const route of expanded.skipped) warnings.push(`${route} skipped: no params`);
  const source = found.sources.length > 0 ? `discovered (${found.sources.join(", ")})` : "default";
  return { ...expanded, source, warnings, sourceFiles: found.sourceFiles };
}
