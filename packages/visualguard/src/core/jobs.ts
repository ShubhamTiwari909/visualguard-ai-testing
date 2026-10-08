import { matchesAny } from "../config/glob.js";
import type { ResolvedConfig } from "../config/resolve.js";
import { resolveRoutes } from "../config/routes.js";
import { joinURL, routeSlug, shortHash, type ExpandedRoute } from "../config/urls.js";
import { ConfigError } from "./errors.js";
import type { Env, JobSpec } from "./types.js";

/** Builds one job per route × viewport. */
export function buildJobs(config: ResolvedConfig, routes: readonly ExpandedRoute[]): JobSpec[] {
  const missing = (["production", "staging"] as const).filter((env) => !config.baseURL[env]);
  if (missing.length > 0) {
    throw new ConfigError(`Missing base URL for ${missing.join(" and ")}`, {
      hint: "Set baseURL in visualguard.config.ts, pass --production/--staging, or set VISUALGUARD_PRODUCTION_URL / VISUALGUARD_STAGING_URL.",
    });
  }

  const jobs: JobSpec[] = [];
  const usedIds = new Set<string>();

  for (const route of routes) {
    let slug = routeSlug(route.route);
    if ([...usedIds].some((id) => id.startsWith(`${slug}__`))) slug += `-${shortHash(route.route)}`;

    for (const viewport of Object.keys(config.viewports)) {
      const id = `${slug}__${viewport}`;
      usedIds.add(id);
      const urls = Object.fromEntries(
        (["production", "staging"] as const).map((env) => [
          env,
          joinURL(config.baseURL[env]!, route.paths[env]),
        ]),
      ) as Record<Env, string>;
      jobs.push({
        id,
        route: route.route,
        name: route.name,
        viewport,
        urls,
        waitFor: route.waitFor,
        mask: route.mask,
        hide: route.hide,
      });
    }
  }
  return jobs;
}

export interface JobPlan {
  /** Routes after `--only` filtering. */
  routes: ExpandedRoute[];
  jobs: JobSpec[];
  warnings: string[];
  source: string;
}

/** Resolves routes (including discovery) and builds the job list. */
export async function planJobs(
  config: ResolvedConfig,
  options: { discoveryLimit?: number } = {},
): Promise<JobPlan> {
  const resolved = await resolveRoutes(config, options);
  const routes =
    config.only.length > 0
      ? resolved.routes.filter((route) => matchesAny(route.route, config.only))
      : resolved.routes;
  return {
    routes,
    jobs: buildJobs(config, routes),
    warnings: resolved.warnings,
    source: resolved.source,
  };
}
