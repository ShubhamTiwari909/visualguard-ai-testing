import type { ResolvedConfig } from "./resolve.js";
import type { RouteInput } from "./schema.js";
import { expandRoutes, type ExpandRoutesResult } from "./urls.js";

export interface ResolvedRoutes extends ExpandRoutesResult {
  /** Where the routes came from, for display. */
  source: string;
  warnings: string[];
}

/** Turns the configured routes into concrete paths. Discovery is added in Phase 2. */
export async function resolveRoutes(config: ResolvedConfig): Promise<ResolvedRoutes> {
  const warnings: string[] = [];
  let inputs: RouteInput[];
  let source: string;

  if (Array.isArray(config.routes)) {
    inputs = config.routes;
    source = "config";
  } else if (config.routes) {
    inputs = [...(config.routes.extra ?? [])];
    source = "config";
    warnings.push("Route discovery is not available yet; using routes.extra only.");
    if (inputs.length === 0) inputs = ["/"];
  } else {
    inputs = ["/"];
    source = "default";
  }

  const expanded = expandRoutes(inputs);
  for (const route of expanded.skipped) warnings.push(`${route} skipped: no params`);
  return { ...expanded, source, warnings };
}
