# VisualGuard

Visual regression testing for websites, as a CLI. VisualGuard captures the same pages on production
and staging with Playwright, diffs them pixel by pixel, and tells you what changed and where.

```bash
npm install -D visualguard playwright
npx playwright install chromium
npx visualguard init
npx visualguard test
```

```
  ✓  /             desktop   PASS
  ✓  /pricing      desktop   PASS
  ⚠  /text-change  desktop   REVIEW      0.13% changed · 1 region
  ✖  /checkout     mobile    REGRESSION  Horizontal overflow: page is 480px wide at a 390px viewport

  2 passed · 1 review · 1 regression · 0 errors   (6.4s)
```

## Try it without a config

```bash
# Scan one site: finds routes (sitemap.xml, then links), captures them, checks health,
# and saves snapshots. The next scan compares against them.
npx visualguard https://example.com

# Compare two sites (routes are discovered from the first one)
npx visualguard https://example.com https://staging.example.com

# Compare one page
npx visualguard https://example.com/pricing https://staging.example.com/pricing
```

## Commands

| Command                    | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `visualguard <url> [url2]` | Zero-config scan of one site, or comparison of two                    |
| `visualguard init`         | Interactive setup; writes `visualguard.config.ts`                     |
| `visualguard doctor`       | Checks Node, Playwright, the browser, the config and the URLs         |
| `visualguard test`         | Captures production and staging, diffs every route, reports           |
| `visualguard report`       | Opens the HTML report for the latest run (`--run <id>`, `--no-serve`) |

Useful `test` flags:

| Flag                                   | Meaning                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `--production <url>` `--staging <url>` | Override the base URLs, e.g. `--staging http://localhost:3000` |
| `--route <path>`                       | Test only this path (repeatable)                               |
| `--only <glob>`                        | Filter routes, e.g. `--only "/blog/**"`                        |
| `--viewport <name>`                    | Run one configured viewport                                    |
| `--list`                               | Print the resolved URL pairs without opening a browser         |
| `--fail-on <regression\|review\|any>`  | What makes the exit code non-zero (default `regression`)       |
| `--ci` `--json` `--debug`              | Plain output · manifest JSON on stdout · Playwright traces     |

Exit codes: `0` ok, `1` failures at or above `--fail-on` (or capture errors), `2` config or usage
error, `3` environment error (browser missing, URL unreachable).

## Configuration

```ts
// visualguard.config.ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: "https://staging.example.com", // VISUALGUARD_STAGING_URL overrides this
  },
  routes: [
    "/",
    "/pricing",
    { path: "/checkout", waitFor: "[data-testid=order-summary]" },
    { path: "/blog/[slug]", params: [{ slug: "hello-world" }] },
    { path: "/pricing", staging: "/plans" }, // renamed on staging
  ],
  // or discover them: routes: { discover: ["nextjs", "sitemap"], exclude: ["/admin/**"] },
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
  stabilize: {
    freezeTime: "2026-01-01T00:00:00Z",
    hide: [".cookie-banner"],
    mask: ["[data-testid=live-price]"], // mask fixed-size containers
  },
  diff: { threshold: 0.1, maxDiffPixels: 20 },
});
```

A page URL is the base URL plus the route: `https://example.com/app` + `/pricing` becomes
`https://example.com/app/pricing`. Query params on a base URL are added to every page. Settings
are resolved in this order: CLI flags, then environment variables
(`VISUALGUARD_PRODUCTION_URL`, `VISUALGUARD_STAGING_URL`), then the config file.

## How captures stay stable

Before each screenshot VisualGuard disables CSS animations and transitions, hides common cookie
banners and chat widgets, waits for fonts, scrolls through the page so lazy content loads, waits
for a quiet network, pauses the page clock (timers and `requestAnimationFrame`) and media, and
takes screenshots until two in a row match. Each capture runs in its own browser context.

## Output

Every run writes `.visualguard/runs/<run>/` with `manifest.json`, the screenshots, a diff image,
crops of each changed region and `index.html`: a self-contained report with side-by-side, slider,
onion-skin and diff views. It opens straight from disk, so you can upload the run directory as a
CI artifact. `npx visualguard report` serves it locally. Add `.visualguard/` to `.gitignore`
(`init` does this for you).

## Requirements

Node.js 22.12 or newer, and Playwright 1.45 or newer (`npx playwright install chromium`).

## License

MIT
