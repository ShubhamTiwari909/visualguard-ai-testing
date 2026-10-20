---
title: "Choose browsers and viewports"
description: "Define named screen sizes, pick the browser engine, and set locale, time zone, colour scheme and timeouts so every capture renders the same way."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/config/resolve.ts", "packages/visualguard/src/capture/browser.ts", "packages/visualguard/src/core/provenance.ts"]
sidebar: {"order": 4}
---

A viewport is the size of the browser window used for a screenshot, such as a desktop screen or a phone. The browser settings choose the engine and how pages render: language, time zone and light or dark theme. This page shows how to set both, and how to switch them for a single run.

Add viewports when your layout changes at different widths. Change browser settings when you need another engine or a fixed language and theme.

## Before you start

- Have a working config file. See [Configure your project](/guides/configuration/).
- Know which screen widths your design changes at, for example 390, 768 and 1440 pixels.
- Run commands from your application's root folder.

## 1. Install the browser engines you need

VisualGuard uses Playwright browsers. Install only the engines you plan to use:

```bash
npx playwright install chromium
npx playwright install firefox
npx playwright install webkit
```

On Linux and in CI, add `--with-deps` to also install the system libraries the browser needs, for example `npx playwright install --with-deps chromium`.

You should see a download progress bar, then the command exits without errors. If an engine is missing when you run a test, VisualGuard stops with `Playwright's firefox browser is not installed.` and the hint `Run: npx playwright install firefox`.

## 2. Define your viewports

Viewports are named. Each name becomes part of the job ID and is shown in reports. Names may use letters, digits and `-`.

```ts
viewports: {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024, hasTouch: true },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
},
```

| Field | What it does | Allowed values | Default |
| --- | --- | --- | --- |
| `width` | Window width in CSS pixels. | 200 to 7680 | required |
| `height` | Window height in CSS pixels. With full-page screenshots, the image can be taller than this. | 200 to 4320 | required |
| `isMobile` | Uses mobile browser behaviour, such as the `meta viewport` tag. Ignored in Firefox. | `true` or `false` | off |
| `hasTouch` | Reports a touch screen to the page. | `true` or `false` | off |
| `deviceScaleFactor` | Pixel density for this viewport. `2` makes a sharper image twice as wide in pixels. It replaces `browser.deviceScaleFactor`. | more than 0, up to 4 | `browser.deviceScaleFactor` |

If you leave out `viewports`, VisualGuard uses one viewport: `desktop`, 1440 × 900. You must define at least one.

Every viewport multiplies the work. Five routes and three viewports make 15 jobs, and each job loads the page on both sites.

:::note
`isMobile` and `hasTouch` change how the browser behaves. They do not turn a desktop browser into a real phone. Check important mobile flows on real devices too.
:::

## 3. Set the browser options

These settings apply to every page in a run:

```ts
browser: {
  name: "chromium",
  locale: "en-US",
  timezoneId: "UTC",
  colorScheme: "light",
  deviceScaleFactor: 1,
},
```

| Field | What it does | Default |
| --- | --- | --- |
| `name` | The engine: `"chromium"`, `"firefox"` or `"webkit"` (the Safari engine). | `"chromium"` |
| `locale` | The browser language, used for `Accept-Language` and for date and number formats. | `"en-US"` |
| `timezoneId` | The time zone for dates shown by the page. | `"UTC"` |
| `colorScheme` | What the page sees for `prefers-color-scheme`: `"light"`, `"dark"` or `"no-preference"`. | `"light"` |
| `deviceScaleFactor` | Pixel density for viewports that do not set their own. More than 0, up to 4. | `1` |
| `navigationTimeoutMs` | How long to wait for a page to load. | `30000` |
| `actionTimeoutMs` | How long to wait for things such as a route's `waitFor` selector. | `15000` |
| `headless` | Runs the browser without a window. Set `false` to watch captures while debugging. | `true` |
| `ignoreHTTPSErrors` | Accepts invalid or self-signed HTTPS certificates. It also skips the check that both sites are reachable before the run. | `false` |

VisualGuard also sets a few things you cannot change, so captures stay consistent:

- Pages see `prefers-reduced-motion: reduce`.
- Service workers are blocked, so one site cannot serve old cached files.
- Each capture gets a fresh browser context, so cookies and storage never leak between pages.

## 4. Change the browser or viewport for one run

These flags and variables override the config for one run:

| Flag | Environment variable | What it does |
| --- | --- | --- |
| `--browser <name>` | `VISUALGUARD_BROWSER` | Uses another engine. The flag wins over the variable. |
| `--viewport <name>` | none | Keeps only this viewport. Repeat it for more. The name must exist in `viewports`. |

```bash
# Only the mobile size
npx visualguard test --viewport mobile --no-ai

# The desktop size in Firefox
npx visualguard test --browser firefox --viewport desktop --no-ai
```

One run uses one engine. To cover three engines, run the test three times with a different `--browser` value each time.

There is no flag for the colour scheme, locale or time zone. To test dark mode as well, create a second config file that reuses the first:

```ts
// visualguard.dark.ts
import { defineConfig } from "visualguard";
import base from "./visualguard.config";

export default defineConfig({
  ...base,
  browser: { ...base.browser, colorScheme: "dark" },
});
```

```bash
npx visualguard test --config visualguard.dark.ts --no-ai
```

## Example: a shop at three sizes

An online shop has a desktop layout, a two-column tablet layout and a one-column phone layout. Its customers are mostly in Germany. The team uses this config:

```ts
viewports: {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180, hasTouch: true },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
},
browser: { name: "chromium", locale: "de-DE", timezoneId: "Europe/Berlin" },
```

Prices and dates now render the German way on both sites, so a format difference cannot appear on only one side.

## Keep rendering the same between runs

Screenshots only compare well when both sides render the same way. Text and anti-aliasing can differ between operating systems and engines.

- In compare mode, both sites are captured in the same run, with the same browser and settings. They always match.
- In baseline mode, the saved screenshots record the browser settings, viewport, capture settings and operating system. If any of these change, the run stops with `Baseline rendering settings do not match`. Use the original settings, or create new baselines. See [Create local baselines](/guides/local-baselines/).

For example, baselines created on macOS will not match a Linux CI machine. Create the baselines on the same kind of machine that compares against them.

## Verify the setup

1. Print the plan:

   ```bash
   npx visualguard test --list
   ```

   You should see a `viewports` line with every name, and a total such as `15 jobs (5 routes × 3 viewports)`.

2. Capture one page at every size and open the report:

   ```bash
   npx visualguard test --route / --no-ai
   npx visualguard report
   ```

   You should see one job per viewport for `/`, with the viewport name next to the route. The run's `manifest.json` records the browser name and version under `tool.browser`, and each viewport's size under `config.viewports`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Playwright's … browser is not installed.` | Run the command in the hint, for example `npx playwright install webkit`. On Linux add `--with-deps`. |
| `Unknown viewport: …` | Use a name from `viewports`. The error lists the configured names. |
| `viewport names may only use letters, digits and -` | Rename the viewport, for example `mobile-small` instead of `mobile small`. |
| A mobile layout looks like desktop in Firefox | Firefox ignores `isMobile`. Rely on `width` for responsive layouts, or use Chromium or WebKit for mobile checks. |
| Page load times out | Raise `browser.navigationTimeoutMs`, or check that the site responds. |
| `waitFor` times out | Check the selector, or raise `browser.actionTimeoutMs`. |
| Certificate errors on a local HTTPS site | Set `browser.ignoreHTTPSErrors: true` for that config only. |
| `Baseline rendering settings do not match` | Use the settings the baselines were made with, or recreate them with `--update-baselines`. |

For more, see [Installation troubleshooting](/troubleshooting/installation/) and [Capture troubleshooting](/troubleshooting/capture/).

## Next steps

- [Make captures repeatable](/guides/stable-captures/): stop animations, clocks and banners from causing false differences.
- [Choose routes and discovery](/guides/routes/): decide which pages run at each size.
- [Configuration reference](/reference/configuration/): every `viewports` and `browser` field.
