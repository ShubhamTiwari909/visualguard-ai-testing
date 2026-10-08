import { describe, expect, it } from "vitest";
import {
  applyParams,
  expandRoutes,
  joinURL,
  normalizeBaseURL,
  routeSlug,
} from "../src/config/urls.js";
import { matchesGlob } from "../src/config/glob.js";

describe("joinURL (PLAN.md §6.5 joining rules)", () => {
  it.each([
    ["plain", "https://example.com", "/pricing", "https://example.com/pricing"],
    ["root route", "https://example.com", "/", "https://example.com/"],
    [
      "base with path prefix",
      "https://example.com/app",
      "/pricing",
      "https://example.com/app/pricing",
    ],
    [
      "base with prefix and trailing slash",
      "https://example.com/app/",
      "/pricing",
      "https://example.com/app/pricing",
    ],
    ["root route on prefixed base", "https://example.com/app", "/", "https://example.com/app/"],
    [
      "query in route",
      "https://example.com",
      "/search?q=shoes",
      "https://example.com/search?q=shoes",
    ],
    [
      "query on base URL",
      "https://staging.example.com?preview=1",
      "/pricing?plan=pro",
      "https://staging.example.com/pricing?preview=1&plan=pro",
    ],
    [
      "route query wins",
      "https://example.com?plan=basic&x=1",
      "/pricing?plan=pro",
      "https://example.com/pricing?x=1&plan=pro",
    ],
    ["hash route", "https://example.com", "/#/settings", "https://example.com/#/settings"],
    ["trailing slash kept", "https://example.com", "/pricing/", "https://example.com/pricing/"],
    ["localhost with port", "http://localhost:3000", "/checkout", "http://localhost:3000/checkout"],
  ])("%s", (_name, base, route, expected) => {
    expect(joinURL(base, route)).toBe(expected);
  });

  it("rejects routes that are not paths", () => {
    expect(() => joinURL("https://example.com", "pricing")).toThrow(/must start with/);
  });

  it("rejects invalid base URLs", () => {
    expect(() => normalizeBaseURL("example.com")).toThrow(/Invalid base URL/);
    expect(() => normalizeBaseURL("ftp://example.com")).toThrow(/http or https/);
  });
});

describe("applyParams", () => {
  it("fills single, catch-all and optional catch-all segments", () => {
    expect(applyParams("/blog/[slug]", { slug: "hello-world" })).toBe("/blog/hello-world");
    expect(applyParams("/docs/[...slug]", { slug: ["a", "b"] })).toBe("/docs/a/b");
    expect(applyParams("/docs/[[...slug]]", {})).toBe("/docs");
    expect(applyParams("/u/[id]", { id: "a b" })).toBe("/u/a%20b");
  });

  it("throws when a required param is missing", () => {
    expect(() => applyParams("/blog/[slug]", {})).toThrow(/Missing param "slug"/);
  });
});

describe("routeSlug", () => {
  it("makes stable slugs", () => {
    expect(routeSlug("/")).toBe("index");
    expect(routeSlug("/pricing")).toBe("pricing");
    expect(routeSlug("/blog/hello-world")).toBe("blog_hello-world");
    expect(routeSlug("/Blog/Hello World/")).toBe("blog_hello-world");
  });

  it("adds a hash for queries and hashes", () => {
    expect(routeSlug("/search?q=shoes")).toMatch(/^search-[0-9a-f]{6}$/);
    expect(routeSlug("/search?q=shoes")).not.toBe(routeSlug("/search?q=boots"));
    expect(routeSlug("/#/settings")).toMatch(/^index-[0-9a-f]{6}$/);
  });
});

describe("expandRoutes", () => {
  it("expands params, keeps per-env paths, skips dynamic routes without params", () => {
    const { routes, skipped } = expandRoutes([
      "/",
      { path: "/pricing", staging: "/plans" },
      { path: "/blog/[slug]", params: [{ slug: "a" }, { slug: "b" }] },
      "/docs/[...slug]",
      "/",
    ]);
    expect(
      routes.map((route) => [route.route, route.paths.production, route.paths.staging]),
    ).toEqual([
      ["/", "/", "/"],
      ["/pricing", "/pricing", "/plans"],
      ["/blog/a", "/blog/a", "/blog/a"],
      ["/blog/b", "/blog/b", "/blog/b"],
    ]);
    expect(skipped).toEqual(["/docs/[...slug]"]);
  });
});

describe("matchesGlob", () => {
  it.each([
    ["/pricing", "/pricing", true],
    ["/pricing", "/pricing*", true],
    ["/pricing/pro", "/pricing*", false],
    ["/blog/a/b", "/blog/**", true],
    ["/blog", "/blog/**", true],
    ["/blogger", "/blog/**", false],
    ["/a", "/?", true],
  ])("%s ~ %s → %s", (path, glob, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });
});
