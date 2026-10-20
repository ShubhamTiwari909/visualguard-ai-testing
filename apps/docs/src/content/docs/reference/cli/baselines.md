---
title: "Baseline command workflows"
description: "Distinguish local reference updates, approved-baseline downloads and monitor snapshots."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

## Local references

Use a complete config with `mode: 'baseline'`, a staging URL, explicit routes/viewports and `baseline.dir`. Review the expected appearance before the explicit update:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines --no-ai
npx --no-install visualguard test --config visualguard.baseline.ts --no-ai
```

[The baseline guide](/guides/local-baselines/) contains the full config. Missing/incompatible references fail by default. Commit PNGs and metadata/DOM/health sidecars together.

## Approved team references

After exact-evidence review/promotion, pull a pinned set version to a new directory:

```sh
npx --no-install visualguard dashboard baseline pull main --project storefront --version 1 --out .visualguard/approved-v1 --server https://YOUR_DASHBOARD_HOST
```

Replace the server/set/version/project with real approved values and supply the scoped token through the documented loader. These immutable references cannot be overwritten with ordinary local update flags. [Follow the full promotion guide](/dashboard/approved-baselines/).

## Rolling monitor references

Monitoring has a separate persistence/update policy. First capture creates its monitor reference; `--reset` explicitly replaces it. [Read monitoring behavior](/guides/monitoring/) before scheduling it. Never use rolling scan/monitor behavior as an implicit human approval.
