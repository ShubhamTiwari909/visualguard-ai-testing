---
title: "Promote approved baselines"
description: "Promote reviewed evidence, pull a pinned version and preserve immutable baseline lineage."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "docs/LOCAL-SETUP.md", "docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 12}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

1. Capture/publish complete evidence with its actual full source SHA and compatible rendering identities.
2. Review the exact checks. In **Approved baselines**, select the project/set `main`, candidate run, actual landed revision and promotion reason. Confirm the source change landed before promoting.
3. Pull the immutable approved version with the project's upload token in `.env.local`:

```sh
npx --no-install visualguard dashboard baseline pull main \
  --project storefront --version 1 --out .visualguard/approved-v1 \
  --server https://YOUR_DASHBOARD_HOST
```

4. Set the baseline config's `baseline.dir` to `.visualguard/approved-v1` and keep rendering settings consistent. A plain baseline test then works offline. Project-bound tests can publish the resulting comparison.

Promotion records the maintainer's landed-revision attestation, not automatic Git ancestry verification. Versions are immutable; restore creates another version. Tampering, incompatible rendering, stale references, incomplete coverage or missing exact approval block the relevant operation. `--update-baselines` cannot overwrite an approved snapshot. For Playwright fixture snapshots, use the downloaded parent directory; its fixture references are under `playwright/`.

## Step-by-step source fixture trial

The following source-specific example requires the running repository fixtures and source dashboard from [source setup](/contributing/local-setup/). Run its `node packages/...` commands at the repository root, not in an npm consumer application.

1. Ensure the candidate run is complete and has its actual full source revision, reliable captures and current exact-evidence approvals for all checks.
2. Open **Approved baselines**, select `storefront` and set `main`, then open the set and choose the reviewed candidate.
3. Enter the actual landed revision and reason, and confirm the source change has landed. For the repository fixture trial, use the checked-out fixture revision; this is only a local demonstration. For real work, wait for the actual change to land.
4. Create version 1. Promotion records a maintainer's attestation; it does not independently prove Git ancestry or a GitHub merge.
5. Pull to a **new** directory:

```sh
node packages/visualguard/dist/cli.js dashboard baseline pull main \
  --project storefront --version 1 --out .visualguard/approved-v1
```

Use the same workspace/database settings. For a hosted/login dashboard, add `--server` and supply the project's upload token. Create `output/approved-demo.json`:

```json
{
  "mode": "baseline",
  "baseURL": { "staging": "http://127.0.0.1:4101" },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" },
  "baseline": { "dir": ".visualguard/approved-v1", "missing": "error" }
}
```

Compare and publish a fresh run:

```sh
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/approved-demo.json \
  --branch main --commit "$(git rev-parse HEAD)" --no-ai
```

Unchanged staging should match the approved snapshot. Once pulled, a plain `test --config output/approved-demo.json --no-ai` compares offline, without the dashboard/token/database. Keep the same browser, OS, viewport, locale/theme and stabilization settings. Tampered/incompatible approved evidence is rejected; `--update-baselines` cannot overwrite it.

Further promotions create immutable versions. Restoring an older version creates another version, not rewritten history. New candidates must be based on the current approved reference. Evidence referenced by baselines is protected from ordinary destructive cleanup.

## Preserve the approval chain

An approved baseline is the team's recorded expected appearance. Named sets such as `main` or `release-1` contain numbered immutable versions, with the selected checks, image/DOM digests (content fingerprints), rendering identity, source run/revision, review context, actor and reason.

A maintainer selects complete, reliable, reviewed evidence, records its actual landed revision and promotes it. Promotion rejects missing/currently invalid approvals, incompatible evidence and other required failures. The landed-revision confirmation is a maintainer's attestation, not automatic Git ancestry verification.

Runners can download an exact version and compare against it offline. This supports reproducible CI and keeps browser execution in the customer's environment. Approved snapshots reject tampering/incompatible rendering and cannot be overwritten through ordinary local baseline-update flags.

Later promotions create new versions. Restoring an older appearance creates another version with its origin recorded rather than changing history. References used by current evidence/baselines influence deletion protection.

**Example:** approve the new checkout appearance, publish `main` version 2, and compare the next PR with those exact expected screenshots.

## Verify and troubleshoot

Inspect the set/version, source run/revision and rendering identity after promotion. Pull to a new directory, compare offline with matching settings, and verify ordinary baseline updates cannot overwrite the approved evidence. Missing approvals, stale candidates, incompatible metadata or modified bytes require fixing the evidence/reference, not suppressing checks.

[Configure a visual policy](/dashboard/visual-policies/) for the next exact-revision comparison.
