---
title: "Choose routes and discovery"
description: "List the pages VisualGuard captures, map pages that live at different paths, fill in dynamic segments, and discover pages from Next.js files, a sitemap or links."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/config/routes.ts", "packages/visualguard/src/config/schema.ts", "packages/visualguard/src/config/urls.ts", "packages/visualguard/src/config/glob.ts", "packages/visualguard/src/config/discover/nextjs.ts", "packages/visualguard/src/config/discover/web.ts", "packages/visualguard/src/core/jobs.ts", "packages/visualguard/src/cli/commands/test.ts"]
sidebar: {"order": 3}
---

A route is the path of one page, such as `/pricing`. The `routes` setting decides which pages VisualGuard captures. This page shows how to list pages yourself, how to let VisualGuard find them, and how to narrow a single run to a few pages.

List pages yourself when you want exact, stable coverage. Use discovery when the site has many pages and you want a broad first pass.

## Before you start

- Have a working config file. See [Configure your project](/guides/configuration/).
- For discovery from a sitemap or links, keep the site running and reachable.
- For Next.js discovery, run commands from the folder that contains your `app/` or `pages/` folder.

## 1. List pages explicitly

The simplest form is a list of paths. Each path starts with `/`. It is not a full URL: the site address belongs in `baseURL`.

```ts
routes: ["/", "/pricing", "/about", "/search?q=mugs"],
```

A path can include a query string and a `#` part. VisualGuard captures each page once for each viewport. One page at one viewport is called a job.

To add options to a page, use an object instead of a string:

```ts
routes: [
  "/",
  {
    path: "/checkout",
    name: "Checkout",
    waitFor: "[data-testid=order-summary]",
    mask: ["[data-testid=order-id]"],
    hide: [".promo-ribbon"],
  },
],
```

| Field | What it does | Default |
| --- | --- | --- |
| `path` | The page path. Required. Must start with `/`. | none |
| `name` | A display name for reports. | the path |
| `waitFor` | A CSS selector. VisualGuard waits until it is visible before taking the screenshot. The wait times out after `browser.actionTimeoutMs` (15 seconds by default). | none |
| `production` | The path to use on the production site, when it differs from `path`. | `path` |
| `staging` | The path to use on the staging site, when it differs from `path`. | `path` |
| `params` | Values for dynamic segments such as `[slug]`. See step 3. | none |
| `mask` | Selectors to cover with a solid box on this page only. | none |
| `hide` | Selectors to make invisible on this page only. | none |

`mask` and `hide` here add to the site-wide lists in `stabilize`. [Make captures repeatable](/guides/stable-captures/) explains the difference between them.

If two entries produce the same production and staging paths, VisualGuard keeps only the first one.

## 2. Map a page that moved

Sometimes the same page has a different path on each site. For example, a redesign renames `/pricing` to `/plans` on staging. Set `staging` (or `production`) on the route object:

```ts
routes: [{ path: "/pricing", staging: "/plans" }],
```

VisualGuard then compares `https://shop.example.com/pricing` with `http://localhost:3000/plans`. Reports and `--only` filters still use the logical name `/pricing`.

## 3. Fill in dynamic segments

A path with square brackets, such as `/blog/[slug]`, is a pattern, not a real page. Give it real values with `params`. VisualGuard creates one page for each entry:

```ts
routes: [
  { path: "/blog/[slug]", params: [{ slug: "hello-world" }, { slug: "release-notes" }] },
],
```

This captures `/blog/hello-world` and `/blog/release-notes`. Choose values that exist on both sites.

VisualGuard supports the three Next.js segment styles:

| Pattern | Example params | Result |
| --- | --- | --- |
| `[slug]` | `{ slug: "hello-world" }` | `/blog/hello-world` |
| `[...slug]` (catch-all) | `{ slug: ["guides", "setup"] }` | `/docs/guides/setup` |
| `[[...slug]]` (optional catch-all) | `{}` | `/docs` |

Values are URL-encoded. Params also apply to `production` and `staging` paths, so `{ path: "/blog/[slug]", staging: "/posts/[slug]", params: [...] }` works.

:::caution
A dynamic route without `params` is skipped, with the warning `/blog/[slug] skipped: no params`. A params entry that misses a required name stops the run with `Missing param "slug" for route "/blog/[slug]"`.
:::

## 4. Discover pages automatically

Instead of a list, `routes` can be an object with discovery rules:

```ts
routes: {
  discover: ["nextjs", "sitemap"],
  extra: [{ path: "/blog/[slug]", params: [{ slug: "hello-world" }] }, "/search?q=mugs"],
  include: ["/**"],
  exclude: ["/admin/**", "/account/**"],
  limit: 50,
  crawlDepth: 2,
},
```

| Option | What it does | Default |
| --- | --- | --- |
| `discover` | The sources to use, in order. At least one of `"nextjs"`, `"sitemap"`, `"crawl"`. | required |
| `extra` | Routes that discovery cannot find, in the same format as an explicit list. | none |
| `include` | Keep only discovered paths that match one of these patterns. | keep all |
| `exclude` | Drop discovered paths that match one of these patterns. | drop none |
| `limit` | The most discovered pages to keep. | `50` |
| `crawlDepth` | How many link levels the crawler follows from the start page (0 to 5). | `2` |

### The three sources

| Source | Where it looks | Good to know |
| --- | --- | --- |
| `nextjs` | Page files in `app/`, `src/app/`, `pages/` and `src/pages/` in the current folder. | Route groups like `(shop)` are removed from the path. Private `_folders`, parallel `@slots`, intercepting routes, `api/`, `_app`, `_document`, `_error` and test files are skipped. |
| `sitemap` | `/robots.txt` `Sitemap:` lines and `sitemap.xml` at the base URL. Sitemap index files are followed. | Only pages on the same host and under the base path are kept. |
| `crawl` | Links in the HTML of the start page, then the pages it links to, up to `crawlDepth` levels. | Reads plain HTML and does not run JavaScript, so links added by scripts are missed. It is skipped when a source listed before it already found pages. |

Sitemap and crawl discovery read the production site. If no production URL is set, they read the staging site. They send that site's `environments` headers.

Next.js dynamic routes are never guessed. They are reported in a warning such as `2 dynamic route(s) need params: /blog/[slug], /products/[id]`. Add them with `params` under `extra`.

### How the final list is built

1. VisualGuard collects paths from each source, in the order you listed them.
2. It keeps paths that match `include`, then removes paths that match `exclude`.
3. It sorts the rest, with `/` first and the others in alphabetical order.
4. It keeps the first `limit` paths.
5. It adds every `extra` route. Extra routes skip the `include`, `exclude` and `limit` rules.

If nothing is found and there are no extra routes, VisualGuard warns `Route discovery found nothing; testing / only.` and captures the home page.

If you leave out `routes` completely, VisualGuard discovers pages with `sitemap` and `crawl` and a limit of 50. A [scan without a config](/guides/zero-config-scans/) uses a limit of 25.

### Pattern syntax

`include`, `exclude`, `--only` and the `accept` command use the same small pattern language. A pattern must match the whole path.

| Pattern | Matches | Does not match |
| --- | --- | --- |
| `/blog/*` | `/blog/hello` | `/blog/2026/hello` |
| `/blog/**` | `/blog`, `/blog/hello`, `/blog/2026/hello` | `/blogs` |
| `/p?` | `/p1`, `/pa` | `/p10` |
| `/**` | every path | none |

## 5. Narrow one run from the command line

These flags change one run without editing the config:

| Flag | What it does |
| --- | --- |
| `--route <path>` | Captures only this path, on both sites. Repeat it for more pages. It replaces `routes` from the config, including discovery. It must start with `/`. |
| `--only <glob>` | Keeps only configured or discovered routes that match the pattern. Repeatable. It never adds a page that is not in the list. |
| `--viewport <name>` | Keeps only this viewport. Repeatable. |
| `--list` | Prints the planned page pairs and exits, without opening a browser. |

```bash
# Only the blog pages, at the mobile size
npx visualguard test --only "/blog/**" --viewport mobile --no-ai

# A page that is not in the config, for a quick check
npx visualguard test --route /careers --no-ai
```

Quote patterns that contain `*`, so your shell does not expand them. Examples use macOS or Linux shells; on Windows use WSL.

## Example: a Next.js blog

A team has a Next.js blog with about 200 posts, a sitemap, and an admin area. They want every static page, two sample posts, and nothing under `/admin`:

```ts
routes: {
  discover: ["nextjs"],
  exclude: ["/admin/**"],
  extra: [{ path: "/blog/[slug]", params: [{ slug: "hello-world" }, { slug: "launch-week" }] }],
},
```

Next.js discovery finds the static pages from the files. The warning about `/blog/[slug]` disappears, because the route is in `extra` with params.

## Verify the route list

Print the plan before you capture anything:

```bash
npx visualguard test --list
```

You should see each production path, an arrow, and the staging path, followed by a total:

```text
  /                   →  /
  /about              →  /about
  /blog/hello-world   →  /blog/hello-world
  /blog/launch-week   →  /blog/launch-week
  /pricing            →  /plans

  10 jobs (5 routes × 2 viewports)
```

Check that:

- every page you care about is listed,
- mapped pages show the right path on each side,
- no warnings about skipped dynamic routes remain.

Then capture one page to confirm the full URLs work, for example `npx visualguard test --route /pricing --no-ai`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `routes must be paths starting with "/"` | Remove the scheme and host from the route. Put them in `baseURL`. |
| `--route "…" must be a path starting with "/"` | Pass a path, such as `--route /pricing`. Use `--staging` or `--production` to change the site. |
| `/blog/[slug] skipped: no params` | Add `params` to the route, or add it under `extra` with params. |
| `No routes to test` with `No route matches --only …` | The pattern matched nothing. Run `--list` without `--only` to see the logical route names, then adjust the pattern. |
| Discovery finds only `/` | The site has no sitemap and its links are added by JavaScript, or it needs a login. List routes explicitly, or add them under `extra`. |
| Discovery misses pages behind a login | Discovery only sends `environments` headers. List those routes explicitly. See [Application auth](/guides/application-auth/). |
| Too many pages | Lower `limit`, or add `exclude` patterns. |

For capture problems, see [Capture and reports troubleshooting](/troubleshooting/capture/).

## Next steps

- [Capture one section](/guides/section-capture/): set `screenshot.selector` per route, compare several sections, or use `selector: null` for a page override.
- [Choose browsers and viewports](/guides/browsers-and-viewports/): decide the screen sizes for each page.
- [Make captures repeatable](/guides/stable-captures/): use `waitFor`, `mask` and `hide` well.
- [Scan URLs without a config](/guides/zero-config-scans/): try discovery on any site with one command.
- [Configuration reference](/reference/configuration/): every routes field and its limits.
