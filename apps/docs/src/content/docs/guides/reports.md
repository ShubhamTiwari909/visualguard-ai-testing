---
title: "Inspect and share reports"
description: "Open saved comparison evidence, use report views and preserve the complete run folder."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md"]
sidebar: {"order": 6}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

Each route/viewport job receives a status:

| Status       | Meaning                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `pass`       | Within visual tolerance, or classified as noise without independent blocking findings. |
| `accepted`   | Matches an intentional change previously accepted by a reviewer.                       |
| `review`     | A difference or independent check needs review.                                        |
| `regression` | A deterministic failure or AI-classified regression.                                   |
| `error`      | Capture or processing failed.                                                          |

`--fail-on regression` is the default. `--fail-on review` also fails on reviews; `any` currently has the same failing statuses as `review`. Errors always fail, as do explicitly incomplete merged runs.

Every run writes `.visualguard/runs/<run>/` with `manifest.json`, available screenshots, DOM snapshots, diff images/region crops and `index.html`. The report supports search, status filters, light/dark themes, deep links and keyboard navigation (`j`/`k` for jobs, `1`–`4` for image views, `/` for search).

```bash
npx --no-install visualguard report
npx --no-install visualguard report --run <run-id>
npx --no-install visualguard report --no-serve  # write the HTML and print its location
```

HTML embeds application JS/CSS but references screenshot files: **share the entire run directory**. Static reports can open from disk; acceptance and fix actions require the local served report. `output.keepRuns` defaults to 10. Add `.visualguard/` to `.gitignore` (`init` does this).

## Verify the setup

Open the exact saved run, verify its route/viewport, and inspect all image views. If sharing evidence, copy the whole run folder and check it from a separate location.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
