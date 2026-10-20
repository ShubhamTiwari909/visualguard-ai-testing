---
title: "Deliver exact-revision GitHub checks"
description: "Connect server-side policy checks, signed webhooks and reconciliation for the current PR head."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/policy-github.ts"]
sidebar: {"order": 5}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

Start in **Informative** mode on **Visual regression policy**. Select target branch/environment, current baseline, freshness, required checks and visual approval requirements; save with a reason. Empty required IDs inherit the baseline coverage. Assess a fresh exact-revision comparison. Missing/partial evidence, stale baseline, capture failures, wrong revisions and withdrawn/rejected approval cannot be bypassed by comments. Temporary exact-check/exact-revision approval exceptions require a reason/expiry and do not waive structural/capture errors.

Optional server-side GitHub settings:

```dotenv
VISUALGUARD_GITHUB_TOKEN=SUPPORTED_CHECKS_WRITE_AND_PULL_REQUESTS_READ_CREDENTIAL
VISUALGUARD_GITHUB_REPOSITORIES=storefront=customer-org/customer-repo
VISUALGUARD_GITHUB_WEBHOOK_SECRET=UNIQUE_RANDOM_SECRET
```

Repository mappings use immutable internal project IDs. Configure `/api/github/webhook`, JSON content, the matching secret and Pull requests events. The host must preserve raw signed request bytes; an already parsed object is rejected. Validate this on Vercel/Cloud Run; use scheduled reconciliation when raw-body forwarding is unavailable. Supported Check Runs credentials differ from a normal GitHub CLI OAuth login; token refresh/expiry handling remains the deployment's responsibility. [GitHub Check Runs authentication](https://docs.github.com/en/rest/checks/runs#create-a-check-run).

Trusted CI must capture the actual PR **head SHA**, not the temporary merge SHA. Publish with that SHA, real PR number and environment, using the existing project-bound test flags or saved-run publishing. Do not expose server/admin credentials to the runner.

```sh
npx --no-install visualguard dashboard policy assess \
  --project storefront --revision CAPTURED_FULL_SHA --server https://YOUR_DASHBOARD_HOST
npx --no-install visualguard dashboard policy reconcile \
  --project storefront --pr 123 --server https://YOUR_DASHBOARD_HOST
```

Configure a trusted scheduler to run `policy reconcile --project storefront --all --server ...` at least every five minutes and after review/policy/baseline/access changes. Supply the project's upload token to these CLI commands through private environment/CI secrets. Hosting does not configure a scheduler; Cloud Scheduler/Vercel Cron needs an appropriate handler/job rather than an arbitrary CLI name.

Checks are point-in-time observations; GitHub may retain an old conclusion during an outage. Test failure/retry/expiry monitoring before making a check required. Informative uses neutral conclusions; Required distinguishes satisfied/blocked/pending. This feature does not change branch protection or merge PRs. Named journeys remain deferred.

## Verify and troubleshoot

Begin in informative mode. Confirm the repository mapping uses the internal immutable project identity, the server token supports the required Check Runs access, and signed webhook bytes survive hosting. Capture/publish the actual PR head and inspect the check's SHA. Push a new commit and verify old evidence is not inherited. Test stale evidence, revoked permissions, delivery retries and scheduled reconciliation before requiring a check.

A CLI exit, an Action comment and a server policy Check Run are separate outputs with separate credentials. An outage can leave a point-in-time GitHub conclusion visible; monitor and reconcile it. [Review visual policy rules](/dashboard/visual-policies/).
