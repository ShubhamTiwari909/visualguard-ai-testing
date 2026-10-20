---
title: "Accept intentional local changes"
description: "Record intentional visual changes while preserving independent health and quality findings."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md"]
sidebar: {"order": 7}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

```bash
npx visualguard accept /pricing --note "Approved pricing redesign"
npx visualguard accept --all  # accept jobs marked review
```

The served report also has an **Accept change** action. Acceptance is recorded in `visualguard.accepted.json` (configurable with `output.acceptedFile`) for sharing through version control.

The default `output.acceptMatch: "similar"` permits the same accepted change despite minor rendering variation; `"exact"` requires identical image hashes. Different/additional changes are flagged again. **Acceptance cannot hide a new independent health, accessibility or performance failure/review.**

## Verify the setup

Repeat the same accepted change and inspect the accepted record; introduce a new change or independent finding and verify it remains visible. Local acceptance does not grant dashboard approval.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
