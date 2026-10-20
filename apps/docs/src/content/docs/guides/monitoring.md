---
title: "Monitor a site over time"
description: "Preserve monitor references between scheduled runs and understand reset and update policy."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md"]
sidebar: {"order": 15}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

```bash
# Compare your dev server with production as source files change.
npx --no-install visualguard watch --staging http://localhost:3000

# Compare production with its previous capture.
npx --no-install visualguard monitor https://example.com

# Generate a scheduled GitHub workflow; this writes a workflow file.
npx --no-install visualguard monitor --workflow "0 */6 * * *"
```

Watch mode re-tests routes connected to changed files through page imports; untraceable/shared changes re-test the full scope. It uses `fix.verify.server.url` or the staging override for the local site.

Monitor saves its first reference under `.visualguard/monitor/<host>/`. The default `monitor.update: "unless-regression"` retains references for regressed pages until repaired or explicitly reset with `--reset`; `"always"` rolls every page forward. Persist the monitor directory between CI runs. Webhooks can deliver summaries to Slack, n8n or another receiver.

## Verify the setup

Persist the monitor directory, run twice and inspect which reference each run used. Review `--reset` before replacing references; the generated workflow still needs an actual CI schedule and network access.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
