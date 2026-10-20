---
title: "Read result statuses"
description: "Understand pass, review, regression, accepted, errors and incomplete evidence."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md", "packages/visualguard/src/core/status.ts"]
sidebar: {"order": 3}
---

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
npx visualguard report
npx visualguard report --run <run-id>
npx visualguard report --no-serve  # write the HTML and print its location
```

HTML embeds application JS/CSS but references screenshot files: **share the entire run directory**. Static reports can open from disk; acceptance and fix actions require the local served report. `output.keepRuns` defaults to 10. Add `.visualguard/` to `.gitignore` (`init` does this).

## Completion is not approval

A worker can finish successfully while its visual evidence contains regressions. A dashboard review records a decision about exact evidence without rewriting the original engine verdict. Independent health/accessibility/performance findings cannot be waived by matching an accepted screenshot. [Learn review decisions](/dashboard/reviews/).
