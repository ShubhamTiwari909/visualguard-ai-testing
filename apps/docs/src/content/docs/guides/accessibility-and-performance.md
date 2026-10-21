---
title: "Add accessibility and performance checks"
description: "Report new accessibility violations, slower loads, extra layout shift and heavier pages next to the visual comparison."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/capture/checks.ts",
    "packages/visualguard/src/core/findings.ts",
    "packages/visualguard/src/capture/capture.ts",
    "packages/visualguard/src/config/schema.ts",
    "packages/visualguard/src/cli/shared.ts",
  ]
sidebar: { "order": 13 }
---

This page shows how to add two optional checks to every capture: an **accessibility** check that uses [axe-core](https://github.com/dequelabs/axe-core), and a **performance** check that reads the browser's own load timings. Both run on the reference and the candidate, so VisualGuard reports only problems that are new. Use them to catch a missing label or a heavier bundle in the same run that catches visual changes.

Both checks are off by default. They can flag a page even when its screenshots match pixel for pixel.

## Before you start

- Finish [Run your first visual test](/start/quickstart/) so you have a working `visualguard.config.ts`.
- Keep both application versions running. For performance, both should be the same kind of build (see [Compare like with like](#compare-like-with-like)).
- Nothing extra to install: axe-core ships with VisualGuard.
- Run commands from your app's root folder, where `visualguard.config.ts` lives.

## What each check compares

**Accessibility.** After the screenshot, VisualGuard runs axe-core on the page (not inside iframes). It counts how many elements fail each axe rule, on both sides. A rule becomes a finding when it fails on **more elements** than on the reference, and its impact is at or above `minImpact`. The finding names the rule, the impact, how many new elements fail and up to three of their selectors.

**Performance.** After the page loads and the network goes quiet, and before VisualGuard hides banners or scrolls, it reads the browser's performance timeline. It records:

| Metric                | Meaning                                                         |
| --------------------- | --------------------------------------------------------------- |
| LCP                   | Largest Contentful Paint: when the biggest element appeared.    |
| CLS                   | Cumulative Layout Shift: how much content jumped while loading. |
| TTFB, FCP, load time  | Time to first byte, first contentful paint and the load event.  |
| Weight                | Total transferred size of the page and its resources.           |
| JS                    | Transferred size of scripts.                                    |
| Requests and elements | Number of requests and DOM elements.                            |

A finding is raised when the candidate is worse than the reference by more than your thresholds:

| Finding                                            | Raised when                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Slower load: LCP 1.2s → 2.6s`                     | LCP grew by more than `lcpIncreaseMs`.                                                 |
| `More layout shift while loading: CLS 0.02 → 0.18` | CLS grew by more than `clsIncrease`.                                                   |
| `Heavier page: 820 KB → 1.1 MB (+34%)`             | Weight grew by more than `weightIncreaseKB` **and** more than `weightIncreasePercent`. |
| `More JavaScript: 310 KB → 450 KB`                 | Script size grew by more than both of the same margins.                                |

Requiring both margins for weight stops tiny files from being flagged just because they doubled.

## 1. Try the checks for one run

The `--a11y` and `--perf` flags turn the checks on for a single run, with default settings:

```bash
npx --no-install visualguard test --a11y --perf
```

These flags work on `test`, `monitor` and the one-line URL scan (`npx visualguard <url>`).

You should see the usual results. Pages with new problems are at least **review**, with messages such as `Accessibility (serious): Buttons must have discernible text — 1 new element: .checkout > button [button-name]`. Open the report with `npx --no-install visualguard report` and expand **Page health** on any page to see both sides' **Load**, **Weight** and **Accessibility** values, with links to each axe rule's help page.

## 2. Turn the checks on in your config

To run them on every test, add a `checks` block. `true` turns a check on with its defaults. An object turns it on and changes settings:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing baseURL, routes and viewports
  checks: {
    accessibility: true,
    performance: {
      lcpIncreaseMs: 1000,
      clsIncrease: 0.1,
      weightIncreasePercent: 20,
      weightIncreaseKB: 100,
      severity: "review",
    },
  },
});
```

You should see the same findings as in step 1 on every `test`, without the flags.

### Accessibility options

| Option      | What it does                                                                       | Default                                        |
| ----------- | ---------------------------------------------------------------------------------- | ---------------------------------------------- |
| `enabled`   | Turn the check on or off.                                                          | `true` when you give an object                 |
| `minImpact` | Lowest axe impact to report: `"minor"`, `"moderate"`, `"serious"` or `"critical"`. | `"serious"`                                    |
| `tags`      | axe-core rule tags to run.                                                         | `["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]` |
| `severity`  | What a new violation does: `"review"`, or `"regression"` to fail the run.          | `"review"`                                     |

### Performance options

| Option                  | What it does                                                        | Default                        |
| ----------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `enabled`               | Turn the check on or off.                                           | `true` when you give an object |
| `lcpIncreaseMs`         | Flag the page when LCP is this many milliseconds slower.            | `1000`                         |
| `clsIncrease`           | Flag the page when CLS is this much higher.                         | `0.1`                          |
| `weightIncreasePercent` | Percent growth that page weight or JS must exceed.                  | `20`                           |
| `weightIncreaseKB`      | Kilobytes of growth that page weight or JS must also exceed.        | `100`                          |
| `severity`              | What a finding does: `"review"`, or `"regression"` to fail the run. | `"review"`                     |

Setting `checks.accessibility: false` (the default) turns the check off. The `--a11y` and `--perf` flags can only turn checks on, not off.

## 3. Make new violations fail the build (optional)

Once your team trusts the results, raise the severity so CI fails on new problems:

```ts
checks: {
  accessibility: { minImpact: "serious", severity: "regression" },
},
```

You should see pages with a new serious or critical violation marked **regression**, and `test` exiting with code 1.

## Compare like with like

The checks only report differences, so both sides must be comparable:

- **Performance needs two live sites.** It compares the candidate with a live reference in the same run. In [baseline mode](/guides/local-baselines/) and in [monitoring](/guides/monitoring/), the stored snapshot has no fresh timings to compare against, so no performance findings appear.
- **Use the same kind of build on both sides.** A dev server is always slower and heavier than a production build. Compare production with a production-mode preview, not with `npm run dev`.
- **Timings vary.** Network and machine load affect LCP. Keep the default margins, or widen them for busy CI machines.
- **Only measurable bytes count.** Browsers hide sizes of cross-origin files that do not send a `Timing-Allow-Origin` header, so third-party scripts may count as 0 KB.
- **Accessibility needs a reference result.** With no reference capture, or a baseline saved before the check was on, violations are listed as info, ending with `nothing to compare with yet`. They do not change the status. Save new baselines with the check on to compare from then on.
- **If a check itself fails**, for example axe-core times out after 30 seconds, the page gets an info finding `Check failed: accessibility: …` and the status is not changed.

:::note
A matching screenshot does not mean the page is unchanged for assistive technology. A removed `aria-label` changes nothing on screen but is a new accessibility violation.
:::

## Example: a checkout button loses its label

A refactor replaces the checkout button's text with an icon. The screenshot barely changes, so the visual diff passes. With `checks.accessibility: true`, VisualGuard finds that axe rule `button-name` now fails on one more element than on production, and marks `/checkout` as **review** with the message `Accessibility (critical): Buttons must have discernible text — 1 new element: …`. The same run's performance check shows the new icon library added 140 KB of JavaScript (+28%), so it also reports `More JavaScript`.

## Verify the checks run

1. Run `npx --no-install visualguard test --a11y --perf`.
2. Open the report and expand **Page health** on any page. You should see **Load**, **Weight** and **Accessibility** rows for both sides.
3. To see a finding, remove an `alt` or `aria-label` on staging only, and run again. The page should become **review** with an `Accessibility (…)` message.
4. Check there is no `Check failed: …` finding. If there is, the check did not complete on that page.

## Troubleshooting

| Problem                                                        | Fix                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No **Load** or **Weight** row in **Page health**               | Performance is off. Add `--perf` or `checks.performance`.                                                |
| Every page is slower or heavier                                | One side is a dev server. Compare two production builds.                                                 |
| No performance findings in baseline or monitor mode            | Expected. Performance compares two live sites in one run.                                                |
| `nothing to compare with yet` on every page                    | The reference has no accessibility results. Use compare mode, or save baselines again with the check on. |
| `Check failed: accessibility: axe-core did not finish in time` | The page is very large or busy. Try a smaller page, or hide heavy widgets with `stabilize.hide`.         |
| Too many low-impact findings                                   | Raise `minImpact`, or narrow `tags`.                                                                     |

See [Capture problems](/troubleshooting/capture/) for pages that do not load.

## Next steps

- [Understand results](/concepts/results/): how findings raise a page's status.
- [Read the HTML report](/guides/reports/): where **Page health** appears.
- [Monitor production](/guides/monitoring/): nightly checks against yesterday's capture.
- [Configuration reference](/reference/configuration/): every `checks` option.
