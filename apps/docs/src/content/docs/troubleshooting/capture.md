---
title: "Capture and report problems"
description: "Diagnose unreachable apps, wrong states, noise and missing saved evidence."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

| Symptom | Diagnostic | Fix and verification |
| --- | --- | --- |
| Connection refused / timeout | Open both configured URLs from the worker's network context. | Start the actual servers, correct host/port, rerun doctor and `test --list`. |
| Login/blank/error screenshot | Inspect actual final page, app auth and request failures. | Renew environment-specific storage state, use reachable application routes, recapture and inspect the saved image. |
| Expected change missing | Inspect selected route/viewport, masks/hides, noise area and tolerances. | Narrow the relevant suppression setting, verify against a known change and unchanged control. |
| Random pixels every run | Compare fonts, time, media, networking and dynamic data. | Apply bounded stabilization/masks; repeat unchanged capture. Do not hide meaningful UI. |
| Baseline missing/incompatible | Read the metadata identity and selected baseline path. | Create references explicitly or use matching rendering settings; preserve sidecars. Do not force updates just for CI. |
| Report opens another run | Config/output or selected run differs. | Use the same `--config` and a real `--run` ID; inspect its manifest. |
| Report images missing after sharing | Only index.html was copied. | Share the complete run directory and verify image files are available. |
| AI analysis absent | Report shows deterministic fallback, budget exhaustion or an unanalyzed job. | Inspect provider/model/key/host and budgets; explicit `--provider` overrides AI-none config. |

A nonzero test exit can be valid regression evidence. [Read exit codes](/reference/exit-codes/), then open the saved report separately. The report process stays running until Ctrl+C.
