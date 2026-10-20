---
title: "Tune differences and noise"
description: "Understand pixel tolerance, allowed change, dynamic regions and shift detection."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "packages/visualguard/src/config/schema.ts"]
sidebar: {"order": 5}
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

## Understand the two tolerances

`diff.threshold` controls whether an individual pixel differs. `maxDiffPixels` and `maxDiffRatio` bound the total difference. Ratio zero disables that alternative. Noise mapping spends an extra reference capture only when the page differs. Use the default bounds until you have inspected a known false positive; do not increase them solely to remove a regression.

## Verify the setup

Compare a known intentional change and a deliberately broken control before and after tuning. Verify that meaningful regressions remain visible.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
