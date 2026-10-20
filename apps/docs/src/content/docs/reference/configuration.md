---
title: "Configuration fields"
description: "Look up every visualguard.config.ts field with its type, allowed values, default and limits, plus a short guide to each section of the config."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/config/resolve.ts", "packages/visualguard/src/config/load.ts", "scripts/docs/generate-reference.mjs"]
sidebar: {"order": 2}
---

This page lists every field you can set in `visualguard.config.ts`, with its type, allowed values, default and limits. Use it to check a single field quickly. For explanations and complete examples, start with the [configuration guide](/guides/configuration/).

## Before you start

- Create the config at your app's root folder, or let `npx --no-install visualguard init` write one for you.
- VisualGuard finds `visualguard.config.ts`, `.mts`, `.js`, `.mjs` and `.cjs` automatically. Any other file name needs `--config PATH`.
- Wrap the object in `defineConfig` from `visualguard` to get type checking and editor hints.

## A small example

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: "http://localhost:3000",
  },
  routes: ["/", "/pricing", "/blog"],
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
  stabilize: { mask: ["[data-testid=live-price]"] },
  ai: { provider: "gemini" },
});
```

Every field you leave out uses its default from the table below.

## How to read this page

The table further down is generated from the source schema, so it always matches the code.

- **Field** uses dots for nesting. `ai.maxTokens` means `ai: { maxTokens: ... }`.
- `[name]` stands for a name you choose, such as a viewport name or a header name. `[]` means an item inside a list.
- `(variant 2)` means the field accepts a second shape. For example, `routes` can be a list of paths, or an object with `discover` settings.
- **Direct default** is the value used when you leave the field out. `not set` means there is no direct default; the parent object's default or runtime logic still applies.
- **Constraints** list limits such as `minimum` and `maximum`. `9007199254740991` just means "no practical upper limit".

When the same setting comes from several places, VisualGuard uses this order: command-line options, then environment variables, then the config file, then defaults. See [environment variables](/reference/environment/).

## Config sections at a glance

| Section | What it controls | Learn more |
| --- | --- | --- |
| `mode`, `baseline` | Compare production with staging, or compare staging with saved baselines. | [Comparison modes](/concepts/comparison-modes/), [local baselines](/guides/local-baselines/) |
| `baseURL`, `routes` | Which sites and pages to capture. | [Routes](/guides/routes/) |
| `viewports`, `browser` | Screen sizes, browser, locale, time zone, theme and timeouts. | [Browsers and viewports](/guides/browsers-and-viewports/) |
| `environments` | Headers and saved login sessions for each side. | [Application login](/guides/application-auth/) |
| `stabilize`, `screenshot` | How pages are made steady before capture, and what is masked or hidden. | [Stable captures](/guides/stable-captures/) |
| `diff` | How pixel differences are measured and which ones are ignored as noise. | [Diffs and noise](/guides/diff-and-noise/) |
| `ai` | AI provider, model, budgets and deadline. | [AI policy and budgets](/guides/ai-policy-and-budgets/) |
| `report`, `output` | HTML report, JUnit, webhook, output folder and run retention. | [Reports](/guides/reports/), [run artifacts](/reference/artifacts/) |
| `fix` | Automatic fixes and how they are verified. | [Automatic fixes](/guides/fixes/) |
| `checks` | Accessibility and performance checks. | [Accessibility and performance](/guides/accessibility-and-performance/) |
| `monitor` | Where monitor snapshots live and when they update. | [Monitoring](/guides/monitoring/) |
| `concurrency`, `reporters`, `hooks` | Parallel captures, custom reporters and code that runs before navigation or capture. | [Reporters](/guides/reporters/) |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Config file not found: PATH` | Check the path given to `--config`. |
| A value seems to be ignored | An environment variable or CLI option may override it. Check `VISUALGUARD_*` variables. |
| `VISUALGUARD_BROWSER must be chromium, firefox or webkit.` | Fix or unset that environment variable. |
| Hooks or reporters do not work from a JSON config | Functions only work in a JavaScript or TypeScript config. |

More help: [installation problems](/troubleshooting/installation/).

<!-- generated-reference -->

## Field types, defaults and constraints

Generated from the current configuration input schema. `not set` means the field has no direct schema default; enclosing object defaults and runtime resolution still apply. Read the explanations below for functions, precedence and capture behavior.

| Field | Type / choices | Direct default | Constraints |
| --- | --- | --- | --- |
| `mode` | "compare" / "baseline" | `"compare"` | — |
| `baseline` | object | `{}` | — |
| `baseline.dir` | string | `"visualguard/baselines"` | — |
| `baseline.missing` | "error" / "create" | `"error"` | — |
| `baseline.legacy` | "error" / "allow" | `"error"` | — |
| `baseURL` | object | `{}` | — |
| `baseURL.production` | string | not set | — |
| `baseURL.staging` | string | not set | — |
| `routes` | array of string or object or object | not set | — |
| `routes (variant 2)` | object | not set | required: discover |
| `routes (variant 2).discover` | array of "nextjs" / "sitemap" / "crawl" | not set | minItems: 1 |
| `routes (variant 2).extra` | array of string or object | not set | — |
| `routes (variant 2).include` | array of string | not set | — |
| `routes (variant 2).exclude` | array of string | not set | — |
| `routes (variant 2).limit` | integer | `50` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `routes (variant 2).crawlDepth` | integer | `2` | minimum: 0; maximum: 5 |
| `viewports` | object | `{"desktop":{"width":1440,"height":900}}` | named entries: object |
| `viewports.[name]` | object | not set | required: width, height |
| `viewports.[name].width` | integer | not set | minimum: 200; maximum: 7680 |
| `viewports.[name].height` | integer | not set | minimum: 200; maximum: 4320 |
| `viewports.[name].isMobile` | boolean | not set | — |
| `viewports.[name].hasTouch` | boolean | not set | — |
| `viewports.[name].deviceScaleFactor` | number | not set | maximum: 4; exclusiveMinimum: 0 |
| `browser` | object | `{}` | — |
| `browser.name` | "chromium" / "firefox" / "webkit" | `"chromium"` | — |
| `browser.locale` | string | `"en-US"` | — |
| `browser.timezoneId` | string | `"UTC"` | — |
| `browser.colorScheme` | "light" / "dark" / "no-preference" | `"light"` | — |
| `browser.deviceScaleFactor` | number | `1` | maximum: 4; exclusiveMinimum: 0 |
| `browser.navigationTimeoutMs` | integer | `30000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `browser.actionTimeoutMs` | integer | `15000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `browser.headless` | boolean | `true` | — |
| `browser.ignoreHTTPSErrors` | boolean | `false` | — |
| `environments` | object | `{}` | — |
| `environments.production` | object | not set | — |
| `environments.production.headers` | object | not set | named entries: string |
| `environments.production.headers.[name]` | string | not set | — |
| `environments.production.storageState` | string | not set | — |
| `environments.staging` | object | not set | — |
| `environments.staging.headers` | object | not set | named entries: string |
| `environments.staging.headers.[name]` | string | not set | — |
| `environments.staging.storageState` | string | not set | — |
| `stabilize` | object | `{}` | — |
| `stabilize.disableAnimations` | boolean | `true` | — |
| `stabilize.freezeTime` | string or false | `false` | — |
| `stabilize.pauseClock` | boolean | `true` | — |
| `stabilize.pauseMedia` | boolean | `true` | — |
| `stabilize.waitForFonts` | boolean | `true` | — |
| `stabilize.networkQuietMs` | integer | `500` | minimum: 0; maximum: 9007199254740991 |
| `stabilize.networkQuietTimeoutMs` | integer | `10000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `stabilize.scrollToLoad` | boolean | `true` | — |
| `stabilize.hideDefaults` | boolean | `true` | — |
| `stabilize.hide` | array of string | `[]` | — |
| `stabilize.mask` | array of string | `[]` | — |
| `stabilize.blockRequests` | array of string | `[]` | — |
| `stabilize.retries` | integer | `2` | minimum: 0; maximum: 5 |
| `stabilize.stabilityAttempts` | integer | `3` | minimum: 1; maximum: 10 |
| `stabilize.stabilityIntervalMs` | integer | `150` | minimum: 0; maximum: 9007199254740991 |
| `screenshot` | object | `{}` | — |
| `screenshot.fullPage` | boolean | `true` | — |
| `screenshot.maxHeight` | integer | `15000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `diff` | object | `{}` | — |
| `diff.engine` | "pixelmatch" | `"pixelmatch"` | — |
| `diff.threshold` | number | `0.1` | minimum: 0; maximum: 1 |
| `diff.maxDiffPixels` | integer | `20` | minimum: 0; maximum: 9007199254740991 |
| `diff.maxDiffRatio` | number | `0` | minimum: 0; maximum: 1 |
| `diff.ignoreAntialiasing` | boolean | `true` | — |
| `diff.maxRegions` | integer | `10` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `diff.regionCellSize` | integer | `16` | minimum: 4; maximum: 64 |
| `diff.regionMergeDistance` | integer | `32` | minimum: 0; maximum: 9007199254740991 |
| `diff.regionPadding` | integer | `24` | minimum: 0; maximum: 9007199254740991 |
| `diff.detectShift` | boolean | `true` | — |
| `diff.noiseMap` | boolean | `true` | — |
| `diff.noiseMapMaxRatio` | number | `0.25` | minimum: 0; maximum: 1 |
| `ai` | object | `{}` | — |
| `ai.provider` | "gemini" / "ollama" / "none" | `"none"` | — |
| `ai.model` | string | not set | minLength: 1 |
| `ai.maxCallsPerRun` | integer | `30` | minimum: 0; maximum: 9007199254740991 |
| `ai.maxGenerationAttempts` | integer | `60` | minimum: 0; maximum: 9007199254740991 |
| `ai.maxNetworkAttempts` | integer | `120` | minimum: 0; maximum: 9007199254740991 |
| `ai.maxTokens` | integer | `200000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `ai.timeoutMs` | integer | `120000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `ai.cacheTTLHours` | number | `24` | exclusiveMinimum: 0 |
| `ai.advisory` | boolean | `false` | — |
| `ai.intent` | object | not set | required: title |
| `ai.intent.title` | string | not set | maxLength: 200 |
| `ai.intent.description` | string | not set | maxLength: 2000 |
| `ai.intent.changedFiles` | array of string | `[]` | maxItems: 50 |
| `ai.concurrency` | integer | `4` | minimum: 1; maximum: 8 |
| `ai.analyze` | "uncertain" / "all" | `"uncertain"` | — |
| `ai.thinking` | "off" / "low" / "default" | `"low"` | — |
| `ai.imageDetail` | "low" / "medium" / "high" | `"medium"` | — |
| `ai.noiseConfidence` | number | `0.8` | minimum: 0; maximum: 1 |
| `ai.maxRegionsPerJob` | integer | `3` | minimum: 1; maximum: 10 |
| `report` | object | `{}` | — |
| `report.html` | boolean | `true` | — |
| `report.publicURL` | string | not set | — |
| `report.junit` | string | not set | — |
| `report.githubSummary` | boolean | `true` | — |
| `report.webhook` | string | not set | — |
| `output` | object | `{}` | — |
| `output.dir` | string | `".visualguard"` | — |
| `output.keepRuns` | integer | `10` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `output.acceptedFile` | string | `"visualguard.accepted.json"` | — |
| `output.acceptMatch` | "exact" / "similar" | `"similar"` | — |
| `fix` | object | `{}` | — |
| `fix.enabled` | boolean | `false` | — |
| `fix.requireConfirmation` | boolean | `true` | — |
| `fix.include` | array of string | `["src/**","app/**","pages/**","components/**","styles/**","lib/**"]` | — |
| `fix.compareRef` | string | not set | — |
| `fix.verify` | object | `{}` | — |
| `fix.verify.server` | object | not set | required: url |
| `fix.verify.server.command` | string | not set | — |
| `fix.verify.server.url` | string | not set | — |
| `fix.verify.server.readyTimeoutMs` | integer | `60000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `fix.verify.commands` | array of string | `[]` | — |
| `fix.verify.commandTimeoutMs` | integer | `300000` | maximum: 9007199254740991; exclusiveMinimum: 0 |
| `fix.maxAttempts` | integer | `2` | minimum: 1; maximum: 5 |
| `fix.allowSourceUpload` | boolean | `false` | — |
| `checks` | object | `{}` | — |
| `checks.accessibility` | boolean or object | `false` | — |
| `checks.accessibility (variant 2)` | object | not set | — |
| `checks.accessibility (variant 2).enabled` | boolean | `true` | — |
| `checks.accessibility (variant 2).minImpact` | "minor" / "moderate" / "serious" / "critical" | `"serious"` | — |
| `checks.accessibility (variant 2).tags` | array of string | `["wcag2a","wcag2aa","wcag21a","wcag21aa"]` | — |
| `checks.accessibility (variant 2).severity` | "review" / "regression" | `"review"` | — |
| `checks.performance` | boolean or object | `false` | — |
| `checks.performance (variant 2)` | object | not set | — |
| `checks.performance (variant 2).enabled` | boolean | `true` | — |
| `checks.performance (variant 2).lcpIncreaseMs` | number | `1000` | minimum: 0 |
| `checks.performance (variant 2).clsIncrease` | number | `0.1` | minimum: 0 |
| `checks.performance (variant 2).weightIncreasePercent` | number | `20` | minimum: 0 |
| `checks.performance (variant 2).weightIncreaseKB` | number | `100` | minimum: 0 |
| `checks.performance (variant 2).severity` | "review" / "regression" | `"review"` | — |
| `monitor` | object | `{}` | — |
| `monitor.dir` | string | `".visualguard/monitor"` | — |
| `monitor.update` | "unless-regression" / "always" | `"unless-regression"` | — |
| `concurrency` | integer | not set | minimum: 1; maximum: 32 |
| `reporters` | array of custom value | `[]` | — |
| `hooks` | object | `{}` | — |
| `hooks.beforeNavigate` | custom value | not set | — |
| `hooks.beforeCapture` | custom value | not set | — |

## Runtime-only values

`hooks.beforeNavigate` and `hooks.beforeCapture` are functions receiving the page, environment, route, URL and viewport. `reporters` contains objects with a name and `onEvent` and/or `onRunEnd`. These custom functions cannot be represented by JSON Schema; use executable JavaScript/TypeScript config, not JSON or a saved dashboard profile.

`routes` must be nonempty/resolvable for actual capture, viewport names use letters/digits/hyphens, and at least one viewport is required. Runtime resolution validates the needed URLs for the selected mode. Explicit CLI overrides win over environment variables, then configuration, then defaults. `.env.local` overrides `.env`; existing process values win over both.

See [configuration](/guides/configuration/), [routing](/guides/routes/), [capture stability](/guides/stable-captures/), [AI policy](/guides/ai-policy-and-budgets/) and [repairs](/guides/fixes/) for behavioral explanations and complete examples.
