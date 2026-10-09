/**
 * @file Normalizes/joins base URLs, expands dynamic segments and creates safe slugs/stable
 * short hashes.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { createHash } from "node:crypto";
import type { Env } from "../core/types.js";
import { ConfigError } from "../core/errors.js";
import type { RouteInput, RouteObject } from "./schema.js";

/**
 * URL resolution rules, see PLAN.md §6.5.
 *
 * A page URL is a base URL (one per environment) plus a route path. A path on the base URL is a
 * prefix, query params on the base URL are added to every page, and the route's own query and
 * hash are kept.
 */

/**
 * Parses a base URL and makes its path end in "/" so it acts as a prefix.
 *
 * Validate an HTTP(S) base, remove its fragment and ensure its path ends in /. That trailing
 * slash makes URL resolution preserve a configured application prefix.
 */
export function normalizeBaseURL(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ConfigError(`Invalid base URL "${input}"`, {
      hint: "Base URLs must be absolute, e.g. https://example.com",
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError(`Base URL must use http or https: "${input}"`);
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  url.hash = "";
  return url;
}

interface SplitRoute {
  path: string;
  query: string;
  hash: string;
}

/**
 * Separate a route into pathname, query and fragment without treating it as a full URL. Split
 * the fragment first so a ? inside it is not mistaken for a query.
 */
function splitRoute(route: string): SplitRoute {
  const hashIndex = route.indexOf("#");
  const hash = hashIndex >= 0 ? route.slice(hashIndex) : "";
  const beforeHash = hashIndex >= 0 ? route.slice(0, hashIndex) : route;
  const queryIndex = beforeHash.indexOf("?");
  return {
    path: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    query: queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "",
    hash,
  };
}

/**
 * Joins a route onto a base URL.
 *
 * `new URL("/pricing", "https://example.com/app/")` would drop the "/app" prefix, so the
 * route's leading slash is stripped and it is resolved relative to the base (which ends in
 * "/").
 *
 * Join a route to a base while preserving the base path prefix and merging query parameters.
 * Remove the route's leading slash before URL resolution because an absolute slash would
 * discard that prefix.
 */
export function joinURL(base: string | URL, route: string): string {
  if (!route.startsWith("/")) {
    throw new ConfigError(`Route "${route}" must start with "/"`);
  }
  const baseURL = typeof base === "string" ? normalizeBaseURL(base) : new URL(base.href);
  const { path, query, hash } = splitRoute(route);

  const relative = path.replace(/^\/+/, "");
  const url = new URL(relative, `${baseURL.origin}${baseURL.pathname}`);

  // Base params first, then the route's; the route's value wins for the same key.
  const params = new URLSearchParams(baseURL.search);
  const routeParams = new URLSearchParams(query);
  for (const key of new Set(routeParams.keys())) params.delete(key);
  for (const [key, value] of routeParams) params.append(key, value);

  const search = params.toString();
  url.search = search ? `?${search}` : "";
  url.hash = hash;
  return url.href;
}

const DYNAMIC_SEGMENT = /\[\[?(\.\.\.)?([^\]]+?)\]?\]/g;

/**
 * Detect a bracketed route parameter such as [slug]. This tells expansion whether concrete
 * parameter values are required.
 */
export function isDynamicRoute(path: string): boolean {
  return /\[[^\]]+\]/.test(path);
}

/**
 * Replaces `[slug]`, `[...slug]` and `[[...slug]]` segments with param values.
 *
 * Replace route parameter segments with encoded values, including catch-all and optional
 * catch-all forms. Normalize trailing slashes left by empty optional segments.
 */
export function applyParams(path: string, params: Record<string, string | string[]>): string {
  const result = path.replace(
    DYNAMIC_SEGMENT,
    (match, _spread: string | undefined, name: string) => {
      const value = params[name];
      if (value === undefined) {
        // Optional catch-all with no value collapses to nothing.
        if (match.startsWith("[[")) return "";
        throw new ConfigError(`Missing param "${name}" for route "${path}"`);
      }
      const parts = Array.isArray(value) ? value : [value];
      return parts.map((part) => encodeURIComponent(part)).join("/");
    },
  );
  // "/docs/[[...slug]]" without a value leaves a trailing slash: "/docs/" -> "/docs".
  return result.length > 1 ? result.replace(/\/+$/, "") || "/" : result;
}

/**
 * Turns a route into a file-system and URL-safe slug: "/" -> "index", "/blog/a" -> "blog_a".
 *
 * Create a bounded filesystem-friendly name for a route. Add a short hash for query/fragment
 * variants so different page inputs do not share artifact filenames.
 */
export function routeSlug(route: string): string {
  const { path, query, hash } = splitRoute(route);
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  let slug = trimmed
    ? trimmed
        .split("/")
        .map((segment) =>
          decodeSafe(segment)
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, "-"),
        )
        .join("_")
    : "index";
  slug = slug.replace(/-{2,}/g, "-").slice(0, 80);
  if (query || hash) slug += `-${shortHash(route)}`;
  return slug;
}

/**
 * Decode a URL segment when its percent encoding is valid. Return the original text on invalid
 * encoding instead of aborting route naming.
 */
function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Hash a string and keep a short hexadecimal prefix for stable identifiers. This names
 * artifacts; it is not used to authenticate requests.
 */
export function shortHash(value: string, length = 6): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

export interface ExpandedRoute {
  /**
   * The route as shown to users, e.g. "/blog/hello-world".
   */
  route: string;
  name: string;
  paths: Record<Env, string>;
  waitFor?: string;
  mask: string[];
  hide: string[];
}

export interface ExpandRoutesResult {
  routes: ExpandedRoute[];
  /**
   * Dynamic routes skipped because they have no params.
   */
  skipped: string[];
}

/**
 * Expands route inputs: normalises strings, applies params, drops duplicates.
 *
 * Normalize route inputs, expand supplied parameters and retain per-environment
 * paths/masks/hides. Return unresolved dynamic paths separately so callers can explain what was
 * skipped.
 */
export function expandRoutes(inputs: readonly RouteInput[]): ExpandRoutesResult {
  const routes: ExpandedRoute[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  /**
   * Add a route only when its production/staging path pair has not been seen. The separator
   * keeps the two path values distinct in the deduplication key.
   */
  const push = (route: ExpandedRoute) => {
    const key = `${route.paths.production}\u0000${route.paths.staging}`;
    if (seen.has(key)) return;
    seen.add(key);
    routes.push(route);
  };

  for (const input of inputs) {
    const object: RouteObject = typeof input === "string" ? { path: input } : input;
    const base = {
      waitFor: object.waitFor,
      mask: object.mask ?? [],
      hide: object.hide ?? [],
    };

    if (
      isDynamicRoute(object.path) ||
      isDynamicRoute(object.production ?? "") ||
      isDynamicRoute(object.staging ?? "")
    ) {
      if (!object.params || object.params.length === 0) {
        skipped.push(object.path);
        continue;
      }
      for (const params of object.params) {
        const route = applyParams(object.path, params);
        push({
          ...base,
          route,
          name: object.name ? `${object.name} (${route})` : route,
          paths: {
            production: applyParams(object.production ?? object.path, params),
            staging: applyParams(object.staging ?? object.path, params),
          },
        });
      }
      continue;
    }

    push({
      ...base,
      route: object.path,
      name: object.name ?? object.path,
      paths: {
        production: object.production ?? object.path,
        staging: object.staging ?? object.path,
      },
    });
  }

  return { routes, skipped };
}
