---
title: "Add accessibility and performance checks"
description: "Compare independent accessibility and browser performance evidence alongside visual changes."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md"]
sidebar: {"order": 13}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

```bash
npx visualguard test --a11y --perf
```

Or enable checks in configuration:

```ts
checks: {
  accessibility: { minImpact: "serious", severity: "regression" },
  performance: {
    lcpIncreaseMs: 1000,
    clsIncrease: 0.1,
    weightIncreasePercent: 20,
    weightIncreaseKB: 100,
    severity: "review",
  },
},
```

Accessibility uses axe-core to compare new/worsened violations, including issues with unchanged pixels. Performance records browser timings and resource signals and checks LCP, CLS and page/JavaScript weight increases. Both are optional and default to `review` when enabled with `true`. Compare equivalent builds, browser settings and environments; a development server is not a reliable performance reference for a production build.

## Verify the setup

Use equivalent reference/candidate builds. Inspect the independent findings as well as screenshots; a matching image can still contain a new accessibility violation.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
