---
title: "Configure your project"
description: "Create a VisualGuard config file, learn what each settings group does, and see which value wins when flags, environment variables and the file disagree."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/config/load.ts", "packages/visualguard/src/config/resolve.ts", "packages/visualguard/src/config/urls.ts", "packages/visualguard/src/cli/shared.ts", "packages/visualguard/src/cli/commands/init.ts"]
sidebar: {"order": 2}
---

A config file tells VisualGuard which sites to compare, which pages and screen sizes to capture, and how strict the comparison should be. This page shows you how to create one, what each group of settings is for, and which value wins when the same setting comes from several places.

Use a config file once you want the same checks on every run. For a quick look at a site without any setup, see [Scan URLs without a config](/guides/zero-config-scans/).

## Before you start

- [Install VisualGuard](/start/install/) in your application.
- Know the two addresses you want to compare. "Production" is the reference site and "staging" is the new version, for example `http://localhost:3000`. See the [glossary](/concepts/glossary/) for these terms.
- Run every command on this page from your application's root folder. VisualGuard looks for the config file and the `.env` files in the folder you run the command from.

## 1. Create the config file

The quickest way is the setup wizard. It asks for your URLs, pages, screen sizes and AI provider, then writes the file for you.

```bash
npx visualguard init
```

You should see a summary like `Created visualguard.config.ts`. The wizard also adds `.visualguard/` and `.env.local` to `.gitignore`, and adds a `"visual": "visualguard test"` script to `package.json`.

You can also create the file by hand. VisualGuard looks for these names in the root folder, in this order, and uses the first one it finds:

| File name | Notes |
| --- | --- |
| `visualguard.config.ts` | Recommended. `init` writes this one. |
| `visualguard.config.mts` | TypeScript as an ES module. |
| `visualguard.config.js` | JavaScript. |
| `visualguard.config.mjs` | JavaScript as an ES module. |
| `visualguard.config.cjs` | JavaScript as a CommonJS module. |

TypeScript files load directly. You do not need a build step. The file can import other modules, like any other source file.

To use a file with another name or location, pass `--config` (short form `-c`). A relative path is resolved from the current folder. If the file does not exist, the command stops with `Config file not found`.

```bash
npx visualguard test --config configs/visualguard.staging.ts
```

:::note
With no config file and no `--config`, VisualGuard uses its built-in defaults. Commands that need two URLs then stop with `No visualguard.config.ts found and no URLs given.` Pass `--production` and `--staging`, or create a config file.
:::

## 2. Wrap the settings in `defineConfig`

`defineConfig` returns your settings unchanged. Its job is to give your editor autocompletion and type checking for every field.

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://shop.example.com",
    staging: "http://localhost:3000",
  },
  routes: ["/", "/pricing"],
});
```

Every field is optional. VisualGuard fills in defaults when it loads the file, then checks every value. If something is wrong, the command stops and lists each problem with its path. Some problems include a hint:

```text
✖ Invalid config (/path/to/visualguard.config.ts)
  routes.0: routes must be paths starting with "/" (e.g. "/pricing"), not full URLs
    Hint: Routes are paths like "/pricing". Put the site address in baseURL.
```

:::caution
Never put API keys in the config file. If a value looks like a Google API key, loading stops with `looks like an API key`. Put keys in `.env.local` or your CI secrets instead.
:::

## 3. Learn the settings groups

The config has one level of top-level groups. This table says what each group is for and where to learn more. For every field, its type and its default, see the [configuration reference](/reference/configuration/).

| Group | What it is for | Learn more |
| --- | --- | --- |
| `mode` | `"compare"` (default) compares two live sites. `"baseline"` compares one site with saved screenshots. | [Local baselines](/guides/local-baselines/) |
| `baseURL` | The `production` and `staging` addresses. | [Step 4](#4-set-the-base-urls) |
| `routes` | The pages to capture: a list of paths, or rules that discover pages for you. | [Routes](/guides/routes/) |
| `viewports` | Named screen sizes. The default is one `desktop` size of 1440 × 900. | [Browsers and viewports](/guides/browsers-and-viewports/) |
| `browser` | Browser engine, locale, time zone, colour scheme, pixel density and timeouts. | [Browsers and viewports](/guides/browsers-and-viewports/) |
| `environments` | Extra request headers and a saved login state for each site. | [Application auth](/guides/application-auth/) |
| `hooks` | Your own code that runs before navigation and before each screenshot. | [Step 6](#6-start-from-a-complete-example) |
| `stabilize` | How VisualGuard makes pages hold still: animations, clock, fonts, network, hidden and masked elements. | [Stable captures](/guides/stable-captures/) |
| `screenshot` | Full-page capture and the maximum height. | [Stable captures](/guides/stable-captures/) |
| `diff` | How much change is allowed, how changed areas are grouped, and the noise map. | [Differences and noise](/guides/diff-and-noise/) |
| `checks` | Optional accessibility and performance checks. Both are off by default. | [Accessibility and performance](/guides/accessibility-and-performance/) |
| `ai` | AI provider, model and spending limits. The default provider is `"none"`. | [Gemini](/guides/ai-gemini/), [AI policy](/guides/ai-policy-and-budgets/) |
| `fix` | The `visualguard fix` command. It is off until you set `fix.enabled: true`. | [Fixes](/guides/fixes/) |
| `report` | HTML report, JUnit file, GitHub step summary, webhook and public report link. | [Reports](/guides/reports/), [Reporters](/guides/reporters/) |
| `reporters` | Your own reporter objects that receive run events. | [Reporters](/guides/reporters/) |
| `output` | Where runs are saved, how many to keep, and how accepted changes are stored. | [Reports](/guides/reports/), [Accepting changes](/guides/accepting-changes/) |
| `baseline` | The saved-screenshot folder and the rules for missing or old screenshots. | [Local baselines](/guides/local-baselines/) |
| `monitor` | Where `visualguard monitor` keeps its previous captures. | [Monitoring](/guides/monitoring/) |
| `concurrency` | How many pages are captured at the same time (1 to 32). | [Step 5](#5-know-which-value-wins) |

## 4. Set the base URLs

A base URL is the start of every page address on one site. It must start with `http://` or `https://`. A route is the rest of the address, and it must start with `/`.

VisualGuard joins them with these rules:

| Base URL | Route | Page that is captured |
| --- | --- | --- |
| `https://example.com` | `/pricing` | `https://example.com/pricing` |
| `https://example.com/app` | `/pricing` | `https://example.com/app/pricing` (the base path is kept) |
| `https://example.com/?lang=en` | `/pricing` | `https://example.com/pricing?lang=en` (base query is added to every page) |
| `https://example.com/?lang=en` | `/pricing?lang=de` | `https://example.com/pricing?lang=de` (the route's own value wins for the same key) |
| `https://example.com/#top` | `/faq#billing` | `https://example.com/faq#billing` (a `#` part on the base is dropped; the route's is kept) |

The base path rule is useful when your app lives under a prefix, such as a preview deployment at `/pr-42/`.

## 5. Know which value wins

Most settings can come from four places. When two places set the same thing, the higher one in this list wins:

1. Command-line flags, such as `--staging`.
2. Environment variables, such as `VISUALGUARD_STAGING_URL`.
3. The config file.
4. Built-in defaults.

This table shows each setting that you can override, and where the override comes from:

| Setting | CLI flag | Environment variable | Config field | Default |
| --- | --- | --- | --- | --- |
| Production URL | `--production <url>` | `VISUALGUARD_PRODUCTION_URL` | `baseURL.production` | none |
| Staging URL | `--staging <url>` | `VISUALGUARD_STAGING_URL` | `baseURL.staging` | none |
| Browser engine | `--browser <name>` | `VISUALGUARD_BROWSER` | `browser.name` | `chromium` |
| Output folder | `--output-dir <path>` | `VISUALGUARD_OUTPUT_DIR` | `output.dir` | `.visualguard` |
| AI provider | `--provider <name>` | `VISUALGUARD_AI_PROVIDER` | `ai.provider` | `none` |
| AI model | `--model <id>` | none | `ai.model` | depends on the provider |
| Parallel captures | `--concurrency <n>` | none | `concurrency` | number of CPU cores, at most 4 |
| Pages | `--route <path>` replaces the list | none | `routes` | discovery |
| Screen sizes | `--viewport <name>` keeps only the named ones | none | `viewports` | `desktop` |
| Accessibility and performance checks | `--a11y`, `--perf` turn them on | none | `checks` | off |
| JUnit file | `--junit <path>` | none | `report.junit` | none |
| Webhook | none | `VISUALGUARD_WEBHOOK_URL` | `report.webhook` | none |

:::note
A model name belongs to one provider. If you switch the provider with `--provider` or `VISUALGUARD_AI_PROVIDER`, VisualGuard ignores `ai.model` from the file and uses the new provider's default, unless you also pass `--model`.
:::

### Environment files

Before reading the config, VisualGuard loads two files from the current folder, if they exist:

1. `.env`
2. `.env.local`, whose values replace the same names from `.env`.

Variables that are already set in your shell or CI always win over both files. This keeps CI secrets from being replaced by a file someone forgot to delete.

These are the variables you are most likely to use with the CLI:

| Variable | What it does |
| --- | --- |
| `VISUALGUARD_PRODUCTION_URL`, `VISUALGUARD_STAGING_URL` | Replace the base URLs, for example with a pull request preview address. |
| `VISUALGUARD_BROWSER` | `chromium`, `firefox` or `webkit`. |
| `VISUALGUARD_OUTPUT_DIR` | Where runs are saved. Use the same value for later `report` and `accept` commands. |
| `VISUALGUARD_AI_PROVIDER` | `gemini`, `ollama` or `none`. |
| `GEMINI_API_KEY`, `GOOGLE_API_KEY` | Gemini key. If both are set, `GEMINI_API_KEY` is used. |
| `OLLAMA_HOST` | Address of your Ollama server. |
| `VISUALGUARD_RUN_GROUP` | A shared name for all shards of one sharded run. |
| `VISUALGUARD_WEBHOOK_URL` | Where to send a JSON summary after each run. |

The [environment variable reference](/reference/environment/) lists every variable, including dashboard ones.

## 6. Start from a complete example

This example is for an online shop. It compares the live site with a local build, on a desktop and a phone screen. Copy it, then delete the parts you do not need. Every field shown here is explained in the guides linked in step 3.

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // Compare two live sites. Use "baseline" to compare one site with saved screenshots.
  mode: "compare",

  // Full http(s) addresses. A path or query string here applies to every page.
  baseURL: {
    production: "https://shop.example.com",
    staging: "http://localhost:3000",
  },

  // The pages to capture. Strings are paths; objects add per-page options.
  routes: [
    "/",
    // The same logical page lives at a different path on staging.
    { path: "/pricing", staging: "/plans" },
    // Wait for the order summary, and cover the order number, which changes every time.
    {
      path: "/checkout",
      waitFor: "[data-testid=order-summary]",
      mask: ["[data-testid=order-id]"],
    },
    // One page per entry in params.
    { path: "/products/[slug]", params: [{ slug: "blue-mug" }, { slug: "red-mug" }] },
  ],

  // Named screen sizes. Names may use letters, digits and "-".
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },

  // One browser per run. These values are the defaults except colorScheme.
  browser: {
    name: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  },

  // Headers or a saved login for each site. Read secrets from the environment.
  environments: {
    staging: {
      headers: { "x-preview-token": process.env.PREVIEW_TOKEN ?? "" },
    },
  },

  // Make pages hold still before the screenshot.
  stabilize: {
    freezeTime: "2026-01-01T00:00:00Z", // Every page sees this date.
    hide: [".promo-banner"], // Made invisible; the space stays.
    mask: ["[data-testid=live-price]"], // Covered by a solid box on both sides.
    blockRequests: ["**/analytics.js"], // Never loaded.
  },

  // Full-page screenshots, cut at 15,000 px.
  screenshot: { fullPage: true, maxHeight: 15000 },

  // How much change is allowed before a page needs review.
  diff: { threshold: 0.1, maxDiffPixels: 20 },

  // Optional extra checks. Both are off by default.
  checks: { accessibility: true, performance: false },

  // AI explanations. The key comes from GEMINI_API_KEY in .env.local, never from this file.
  ai: { provider: "gemini", maxCallsPerRun: 30 },

  // Reports. The HTML report is on by default.
  report: { junit: "reports/visualguard.xml" },

  // Where runs go, how many to keep, and where accepted changes are recorded.
  output: {
    dir: ".visualguard",
    keepRuns: 10,
    acceptedFile: "visualguard.accepted.json",
    acceptMatch: "similar",
  },

  // Your own code. Both hooks receive { page, env, route, url, viewport }.
  hooks: {
    // Runs before the page is opened.
    beforeNavigate: async ({ page }) => {
      await page.context().addCookies([
        { name: "consent", value: "yes", domain: "shop.example.com", path: "/" },
      ]);
    },
    // Runs after the page has settled, just before the screenshot.
    beforeCapture: async ({ page }) => {
      await page.evaluate(() => document.querySelector("[data-testid=chat-launcher]")?.remove());
    },
  },

  // Pages captured at the same time. Leave it out to use up to 4.
  concurrency: 2,
});
```

To find pages automatically instead of listing them, replace `routes` with discovery rules. The [routes guide](/guides/routes/) explains each option.

```ts
routes: {
  discover: ["nextjs", "sitemap"],
  exclude: ["/admin/**"],
  limit: 50,
},
```

## Use a JSON file instead

`init` always writes TypeScript. If you prefer JSON, create `visualguard.config.json` with the same fields, without the `import`, `export default` or `defineConfig` wrapper:

```json
{
  "baseURL": {
    "production": "https://shop.example.com",
    "staging": "http://127.0.0.1:3000"
  },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" }
}
```

VisualGuard does not look for JSON files on its own. Pass the file on every command:

```bash
npx visualguard test --config visualguard.config.json --no-ai
```

JSON cannot hold hooks, custom reporters or `process.env` reads. Keep only one config file in the root folder, so every command reads the same settings.

## Verify the configuration

1. Check that the browser, the URLs and the AI provider are ready:

   ```bash
   npx visualguard doctor
   ```

   You should see one line per check, such as Node.js, Playwright, Browser, each URL, Config and Output directory. A failing check has a hint under it.

2. List what a test would capture, without opening a browser:

   ```bash
   npx visualguard test --list
   ```

   You should see both base URLs, the viewport names, one line per page pair, and a total:

   ```text
     production   https://shop.example.com
     staging      http://localhost:3000
     viewports    desktop, mobile

     /                   →  /
     /pricing            →  /plans
     /checkout           →  /checkout
     /products/blue-mug  →  /products/blue-mug
     /products/red-mug   →  /products/red-mug

     10 jobs (5 routes × 2 viewports)
   ```

If you use a `--config` path, pass the same path to both commands.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Config file not found: …` | The `--config` path is resolved from the current folder. Run the command from the app root, or pass an absolute path. |
| `Invalid config (…)` followed by a field path | Fix the named field. The [configuration reference](/reference/configuration/) lists allowed values and limits. |
| `… looks like an API key` | Remove the key from the config. Set `GEMINI_API_KEY` in `.env.local` or in your CI secrets. |
| `No visualguard.config.ts found and no URLs given.` | You are not in the folder with the config, or the file has another name. Use `--config`, or run `npx visualguard init`. |
| `Missing base URL for production` (or staging) | Set `baseURL`, pass `--production` and `--staging`, or set `VISUALGUARD_PRODUCTION_URL` and `VISUALGUARD_STAGING_URL`. |
| `Unknown viewport: …` | `--viewport` only accepts names defined in `viewports`. The error lists the configured names. |
| A value in `.env` has no effect | A variable with the same name is already set in your shell or CI, and that one wins. Also check that `.env` is in the folder you run the command from. |
| `VISUALGUARD_AI_PROVIDER must be gemini, ollama or none` | Fix the variable's value, or unset it. |

For other problems, see [Troubleshooting](/troubleshooting/).

## Next steps

- [Choose routes and discovery](/guides/routes/): list pages, map different paths, and find pages automatically.
- [Choose browsers and viewports](/guides/browsers-and-viewports/): add phone and tablet sizes and other engines.
- [Make captures repeatable](/guides/stable-captures/): stop moving content from causing false differences.
- [Configuration reference](/reference/configuration/): every field with its type and default.
