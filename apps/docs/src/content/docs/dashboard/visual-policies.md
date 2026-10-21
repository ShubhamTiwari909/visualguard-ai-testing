---
title: "Evaluate a visual policy"
description: "Assess current evidence, approved references and review requirements for an exact source revision."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/PRODUCT-FEATURES.md", "docs/LOCAL-SETUP.md", "apps/platform/server/policies.ts"]
sidebar: { "order": 13 }
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

A visual policy answers: **does the evidence for this exact revision meet this project's current visual requirements?**

Requirements can cover the target branch/environment, required screenshot checks, current approved baseline, evidence age, complete/reliable execution and exact visual approval for changed screenshots.

| Assessment | Meaning                                               |
| ---------- | ----------------------------------------------------- |
| Pending    | Required evidence is not yet available                |
| Satisfied  | Available evidence meets the current policy           |
| Blocked    | Evidence or a decision fails one or more requirements |

Policies are versioned with actor/reason. Temporary exceptions are scoped to an exact check/revision with a reason/expiry; they do not waive capture/coverage failures or explicit rejection.

Optional GitHub delivery verifies the live PR head/target and publishes a Check Run for that revision. Informative mode reports the assessment with a neutral conclusion; Required mode distinguishes success, failure and waiting evidence. A new head commit cannot inherit a previous head's evidence.

Webhooks require correctly signed original bytes. Reconciliation refreshes results after evidence, reviews, references, account permissions or freshness change. Operators must configure scheduled/on-demand reconciliation and credential rotation; the integration is not an automatic GitHub App connection/token-refresh service.

Checks are point-in-time observations. GitHub can retain an old conclusion during a dashboard/network outage, so monitoring/recovery matters before making checks required. VisualGuard does not configure branch protection, merge PRs or grant release permission independently of the customer's controls.

## Local source walkthrough

These source commands require the repository fixture/dashboard setup and matching environment from [source setup](/contributing/local-setup/). Installed package users use the `npx --no-install visualguard dashboard policy ...` commands in [GitHub delivery](/ci/github-checks/).

1. Open **Visual regression policy** and select `storefront`.
2. Start in **Informative** mode; select baseline `main`, target branch `main`, environment `staging`, an evidence lifetime and visual approval requirements. Empty required IDs inherit the baseline's checks. Leave GitHub repository blank for this local trial.
3. Save with a reason, select the freshly captured baseline comparison and choose **Assess current policy**. Complete unchanged evidence against the current reference should be satisfied without another change approval.
4. Compare the old production design instead with `--staging http://127.0.0.1:4100`, then assess that new run. Changed screenshots need exact approval; capture errors, missing coverage, wrong revisions, stale baselines and expired evidence cannot be fixed by a comment.

CLI assessment against the same local database:

```sh
node packages/visualguard/dist/cli.js dashboard policy assess \
  --project storefront --revision "$(git rev-parse HEAD)"
```

`--enforce` exits unsuccessfully unless satisfied. Operational errors always fail. For GitHub setup, exact PR-head capture and scheduled reconciliation, see the [final package guide](/dashboard/overview/). Named journeys remain deferred.

## Verify and troubleshoot

Start with informative mode and inspect an exact revision before making policy required. Test unchanged/current evidence, a rejected visual change, missing coverage and a new PR head. Pending means missing evidence; blocked means present evidence or decisions fail a requirement. Exceptions have explicit scope/reason/expiry and cannot bypass structural errors.

[Connect GitHub check delivery](/ci/github-checks/) only after local assessment behaves as expected. Branch protection remains your repository configuration.
