/**
 * @file Reads sitemap/robots URLs and crawls same-site links within configured scope/depth.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { normalizeBaseURL } from "../urls.js";

const FETCH_TIMEOUT_MS = 10_000;
const NON_PAGE_EXTENSION =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|mp4|webm|mp3|wav|css|js|mjs|json|xml|txt|woff2?|ttf|otf|eot)$/i;

/**
 * Fetch a text page with the supplied headers and a bounded timeout. Return its final URL after
 * redirects, or undefined when discovery cannot use the response.
 */
async function fetchText(
  url: string,
  headers: Record<string, string>,
): Promise<{ text: string; url: string } | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html,application/xml;q=0.9,*/*;q=0.8", ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    return { text: await response.text(), url: response.url || url };
  } catch {
    return undefined;
  }
}

/**
 * Decode the small set of HTML/XML entities handled by discovery. Chained replace calls produce
 * a new string rather than changing the input string.
 */
const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

/**
 * Converts an absolute URL to a route path relative to the base URL, or undefined when it is on
 * another host, outside the base path, or not a page.
 *
 * Resolve a discovered link against the base URL and keep only usable page paths within that
 * site/prefix. Return undefined for invalid, external or excluded resource links.
 */
export function toRoutePath(href: string, base: URL): string | undefined {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.host !== base.host) return undefined;
  if (!url.pathname.startsWith(base.pathname) && `${url.pathname}/` !== base.pathname)
    return undefined;
  if (NON_PAGE_EXTENSION.test(url.pathname)) return undefined;
  const rest =
    url.pathname === base.pathname.slice(0, -1) ? "" : url.pathname.slice(base.pathname.length);
  return `/${rest}`;
}

/**
 * Reads `sitemap.xml` (following sitemap indexes and robots.txt hints) into route paths.
 *
 * Read sitemap locations, following index files and robots.txt hints within configured limits.
 * Sets prevent duplicate pages and repeated sitemap processing.
 */
export async function discoverSitemapRoutes(
  baseURL: string,
  options: { headers?: Record<string, string>; limit?: number } = {},
): Promise<string[]> {
  const base = normalizeBaseURL(baseURL);
  const headers = options.headers ?? {};
  const limit = options.limit ?? 500;

  const queue: string[] = [new URL("sitemap.xml", base).href];
  const robots = await fetchText(new URL("/robots.txt", base).href, headers);
  if (robots) {
    for (const match of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) queue.unshift(match[1]!);
  }

  const visited = new Set<string>();
  const paths = new Set<string>();
  while (queue.length > 0 && visited.size < 20 && paths.size < limit) {
    const sitemapURL = queue.shift()!;
    if (visited.has(sitemapURL)) continue;
    visited.add(sitemapURL);
    const result = await fetchText(sitemapURL, headers);
    if (!result || !/<(urlset|sitemapindex)/i.test(result.text)) continue;

    const isIndex = /<sitemapindex/i.test(result.text);
    for (const match of result.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = decodeEntities(match[1]!);
      if (isIndex) {
        queue.push(loc);
      } else {
        const path = toRoutePath(loc, base);
        if (path) paths.add(path);
        if (paths.size >= limit) break;
      }
    }
  }
  return [...paths];
}

/**
 * Breadth-first crawl of same-site links from the base URL (static HTML only, no JS).
 *
 * Explore same-site links one depth level at a time using fetched HTML. This is breadth-first
 * discovery and does not execute a site's JavaScript.
 */
export async function crawlRoutes(
  baseURL: string,
  options: { headers?: Record<string, string>; depth?: number; limit?: number } = {},
): Promise<string[]> {
  const base = normalizeBaseURL(baseURL);
  const depth = options.depth ?? 2;
  const limit = options.limit ?? 50;
  const headers = options.headers ?? {};

  const found = new Set<string>(["/"]);
  let frontier = ["/"];
  for (let level = 0; level < depth && frontier.length > 0 && found.size < limit; level++) {
    const next: string[] = [];
    for (const path of frontier) {
      const page = await fetchText(new URL(path.slice(1), base).href, headers);
      if (!page) continue;
      for (const match of page.text.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"'#]+)[^"']*["']/gi)) {
        const href = decodeEntities(match[1]!);
        const route = toRoutePath(href.split("?")[0]!, base);
        if (!route || found.has(route)) continue;
        found.add(route);
        next.push(route);
        if (found.size >= limit) break;
      }
      if (found.size >= limit) break;
    }
    frontier = next;
  }
  return [...found];
}
