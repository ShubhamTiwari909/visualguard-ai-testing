/**
 * @file Tests Next.js route conventions, base-path URLs, sitemap/robots and web crawling.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverNextRoutes } from "../src/config/discover/nextjs.js";
import { crawlRoutes, discoverSitemapRoutes, toRoutePath } from "../src/config/discover/web.js";
import { resolveRoutes } from "../src/config/routes.js";
import { testConfig } from "./helpers/config.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

/**
 * Create a temporary Next.js-like file tree from the supplied page paths. Only route filenames
 * matter here, so each file exports a minimal empty page.
 */
function project(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "vg-next-"));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "export default function Page() { return null }\n");
  }
  return dir;
}

describe("Next.js file-system routes", () => {
  it("reads the app router, skipping groups, slots, intercepting routes and private folders", () => {
    const dir = project([
      "app/page.tsx",
      "app/layout.tsx",
      "app/pricing/page.tsx",
      "app/(marketing)/about/page.tsx",
      "app/blog/[slug]/page.mdx",
      "app/docs/[[...slug]]/page.tsx",
      "app/@modal/(.)photo/[id]/page.tsx",
      "app/photo/(..)feed/page.tsx",
      "app/_components/page.tsx",
      "app/api/route.ts",
      "app/dashboard/@analytics/page.tsx",
    ]);
    expect(discoverNextRoutes(dir)).toEqual([
      { path: "/", file: "app/page.tsx" },
      { path: "/about", file: "app/(marketing)/about/page.tsx" },
      { path: "/pricing", file: "app/pricing/page.tsx" },
      { path: "/blog/[slug]", file: "app/blog/[slug]/page.mdx" },
      { path: "/docs/[[...slug]]", file: "app/docs/[[...slug]]/page.tsx" },
    ]);
  });

  it("reads the pages router under src/", () => {
    const dir = project([
      "src/pages/index.tsx",
      "src/pages/_app.tsx",
      "src/pages/_document.tsx",
      "src/pages/contact.jsx",
      "src/pages/blog/index.tsx",
      "src/pages/blog/[id].tsx",
      "src/pages/api/hello.ts",
      "src/pages/button.test.tsx",
    ]);
    expect(discoverNextRoutes(dir).map((route) => route.path)).toEqual([
      "/",
      "/blog",
      "/contact",
      "/blog/[id]",
    ]);
  });
});

describe("web discovery", () => {
  let production: FixtureServer;
  beforeAll(async () => {
    production = await startFixtureServer("production");
  });
  afterAll(() => production.close());

  it("converts URLs to route paths under the base URL", () => {
    const base = new URL("https://example.com/app/");
    expect(toRoutePath("https://example.com/app/pricing", base)).toBe("/pricing");
    expect(toRoutePath("https://example.com/app", base)).toBe("/");
    expect(toRoutePath("/app/blog/a", base)).toBe("/blog/a");
    expect(toRoutePath("https://example.com/other", base)).toBeUndefined();
    expect(toRoutePath("https://cdn.example.com/app/x", base)).toBeUndefined();
    expect(toRoutePath("https://example.com/app/logo.png", base)).toBeUndefined();
    expect(toRoutePath("mailto:hi@example.com", base)).toBeUndefined();
  });

  it("reads sitemap.xml via robots.txt", async () => {
    const routes = await discoverSitemapRoutes(production.url);
    expect(routes).toContain("/");
    expect(routes).toContain("/text-change");
    expect(routes).not.toContain("/checkout");
  });

  it("crawls same-site links", async () => {
    const routes = await crawlRoutes(production.url, { depth: 1, limit: 50 });
    expect(routes).toEqual(
      expect.arrayContaining(["/", "/identical", "/pricing", "/checkout", "/alignment"]),
    );
    expect(routes).not.toContain("/signup/extra");
  });

  it("resolveRoutes discovers when no routes are configured, and applies include/exclude", async () => {
    const config = testConfig({ baseURL: { production: production.url, staging: production.url } });
    const resolved = await resolveRoutes(config);
    expect(resolved.source).toBe("discovered (sitemap)");
    expect(resolved.routes.length).toBeGreaterThan(10);

    const filtered = testConfig({
      baseURL: { production: production.url, staging: production.url },
      routes: {
        discover: ["sitemap"],
        exclude: ["/over*"],
        include: ["/", "/o*", "/hidden"],
        extra: ["/checkout"],
      },
    });
    const result = await resolveRoutes(filtered);
    expect(result.routes.map((route) => route.route)).toEqual(["/", "/hidden", "/checkout"]);
  });
});
