---
title: "Make captures repeatable"
description: "Stabilize fonts, time, media, networking and dynamic elements without hiding meaningful changes."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md"]
sidebar: {"order": 4}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

VisualGuard creates isolated browser contexts, disables CSS animations/transitions, waits for fonts and quiet networking, scrolls to load lazy content, hides common widgets, pauses media and the clock before capture, and checks consecutive screenshots for stability. Use `freezeTime` when dates must be repeatable.

Mask selectors preserve element dimensions; hide selectors conceal the element. Choose stable-size containers when masking variable content. You can also mark dynamic elements directly:

```html
<span data-visualguard-ignore>Live visitor count</span>
<div data-visualguard-ignore="hide">Rotating ticker</div>
```

When a page differs, the default noise map repeats the reference capture and excludes areas that vary between reference loads. It is skipped if its area exceeds `diff.noiseMapMaxRatio` (default 25%). Disable it with `diff: { noiseMap: false }` when those changing areas matter to your comparison.

`diff.threshold` is per-pixel colour tolerance; `maxDiffPixels` and `maxDiffRatio` control how much total change is allowed. Anti-aliasing is ignored by default. These settings can suppress small changes, so inspect tolerances and masks when an expected difference is absent.

## Verify the setup

Run the same unchanged route twice and inspect findings/noise exclusions. Keep masks narrow; a hidden expected change is a configuration problem, not a successful test.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
