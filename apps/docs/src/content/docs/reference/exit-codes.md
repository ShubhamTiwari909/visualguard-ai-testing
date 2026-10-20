---
title: "Exit codes and failure policy"
description: "Distinguish visual failure, usage errors, environment errors and incomplete evidence."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/core/errors.ts", "packages/visualguard/src/core/status.ts"]
sidebar: {"order": 4}
---

| Exit | Category | What to do |
| --- | --- | --- |
| `0` | Evidence meets the selected failure policy. | Inspect review statuses if your policy allows them; this is not automatic human approval. |
| `1` | A failing visual/check status or incomplete merged execution. | Open saved evidence; investigate regressions/errors or missing shards. |
| `2` | Invalid config or command usage. | Fix the reported path/value/argument and retry. |
| `3` | Environment failure, such as unavailable browser/URL/provider prerequisites. | Run doctor and fix the dependency/network environment. |

`--fail-on regression` fails regressions and errors. `review` also fails review statuses; `any` currently selects the same failing statuses as `review`. Incomplete evidence always fails. A finished worker/upload is a lifecycle state, not a visual pass. [Read statuses](/concepts/results/).

Operational policy assessment errors fail even without `--enforce`; `--enforce` additionally requires policy satisfaction. Follow the command's actual installed help and error output.
