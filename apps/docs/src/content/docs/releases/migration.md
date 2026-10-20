---
title: "Migration notes"
description: "Migrate reference metadata, repair verification, shards and AI policy without weakening evidence."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/RELIABILITY-CHANGES.md", "packages/visualguard/CHANGELOG.md"]
sidebar: {"order": 2}
---

### Baselines

Missing baselines now fail by default. Create/update them explicitly:

```sh
npx --no-install visualguard test --update-baselines
# Inside Playwright tests:
npx playwright test --update-snapshots
```

For intentionally permissive local onboarding, set `baseline.missing: "create"`. In the CLI this permits an uninitialised reference result; screenshots are only persisted through an explicit update request. The Playwright fixture creates its baseline in this mode. Keep the default `error` in CI.

New baselines include `.meta.json`, `.dom.json`, `.health.json` and PNG files. Commit metadata and sidecars together. Existing CLI baselines can be read with `baseline.legacy: "allow"`; regenerate them to acquire metadata, then remove that override. Fixture baseline IDs have changed to include project/rendering identity, so regenerate fixture baselines explicitly. Metadata mismatches require using the original rendering settings or regeneration, even when `legacy: "allow"` is configured.

No persisted cookies, headers or source contents are added to baseline metadata. Verification still uses the current project's hooks and authentication settings, because functions and credentials are not serialised. Keep those callbacks/settings consistent with the original capture.

### Automatic fixing and verification

Set `fix.verify.server` before using `fix --auto`. Interactive application without a server remains labelled `unverified`. Source proposals are checked against the exact file contents read during generation; regenerate after an intervening edit.

Verification uses saved artifacts from the selected run. After individual repairs, the complete original job set is checked: repaired routes must match their saved expected look at every captured viewport (accepted variants retain their accepted staging look); other routes must retain their pre-fix staging look. This conservative scope can reject an intentional collateral change. Recapture/review that change in a new run. Routes/viewports absent from the original run cannot be verified; run the complete intended scope before automatic fixing.

`fix-results.json` records cumulative known AI usage, batch outcomes and final verification directories (stored under the source run so retention keeps evidence together). `fixes/` records per-attempt proposals and verification results. These artifacts contain source edits and should be shared with the same care as code reviews.

### Sharding

Use one unique group value for each execution, shared by all its shards:

```sh
npx --no-install visualguard test --shard 1/2 --run-group my-ci-execution-123
npx --no-install visualguard test --shard 2/2 --run-group my-ci-execution-123
npx --no-install visualguard merge downloaded-artifacts
```

GitHub Actions uses its run ID and attempt automatically. Other CI systems can set `VISUALGUARD_RUN_GROUP`. Legacy runs without provenance must be recaptured. `merge --allow-partial` creates an explicitly incomplete diagnostic report and returns a failing exit code.

### AI policy and budgets

```ts
ai: {
  provider: "gemini",
  model: "<pinned model ID available to your account>",
  advisory: true,
  maxCallsPerRun: 30,          // job analyses
  maxGenerationAttempts: 60, // includes JSON repair generations
  maxNetworkAttempts: 120,   // includes provider retries/fallback settings
  maxTokens: 200_000,
  timeoutMs: 120_000,
  cacheTTLHours: 24,
  intent: {
    title: "Update pricing copy",
    description: "The layout and checkout flow should stay the same.",
    changedFiles: ["app/pricing/page.tsx"],
  },
}
```

The default Gemini model remains a moving alias. Pin a model for reproducible CI; cached records expire after 24 hours by default. A returned model revision is displayed when available. Confidence is self-reported and does not imply a calibrated probability.

The ledger stops future requests once known token usage exceeds the limit; a completed or concurrently in-flight generation can take usage past the limit. Providers do not return billable usage for every failed request, so this is best-effort usage accounting, not an exact invoice. Built-in providers count internal retries. Custom providers without budget support can only be counted at their public generation boundary.

Analysis and a later fix share accumulated token/attempt limits through the saved run/fix usage. Each invocation has its own deadline. `RunOptions.signal` and `FixOptions.signal` support programmatic cancellation. The fixture shares an AI session within each test, rather than across separate Playwright worker processes.

## Upgrading dashboard identity and references

- Take a native operational database backup and stop older dashboard writers before upgrading. Upgrade all dashboard instances consistently; keep the runner and server on compatible releases. A code rollback does not restore an older database schema.
- Existing installations with users but no recorded admission policy must explicitly choose `VISUALGUARD_USER_ADMISSION=invite` or `legacy` before startup. Fresh hosted workspaces default to invite-only admission. Use SQLite, PostgreSQL or a transaction-capable MongoDB replica set/sharded deployment for the full team workflow; standalone MongoDB needs explicit legacy mode and does not support invitations, account linking, managed lifecycle changes, baseline mutations or administrator recovery.
- Preserve existing account IDs and use explicit Google linking with current-account proof. Matching email addresses do not merge identities. Keep a tested password administrator; changing bootstrap environment credentials does not reset an existing account.
- Rebuild/redeploy the dashboard package and generated hosting assets as well as updating the test runner. Verify direct navigation to all supported pages. The published 3.2.0 Vercel scaffold omits `/policies`; add its `/index.html` rewrite before redeploying, or regenerate from a release containing the scaffold correction. Updating the package alone does not update an old deployment folder.
- GitHub checks need server-side supported credentials, repository mappings, a webhook secret/raw-body forwarding and external scheduled reconciliation. Credential rotation and scheduler monitoring remain operator responsibilities. Start in Informative mode; checks are point-in-time observations, not continuous release authorization.
- Native database backups include new screenshot/DOM chunks and operational state. Portable evidence exports exclude authentication state and cannot replace a full recovery backup. Test a restore in a separate environment before relying on the upgrade.

See the [npm setup guide](/start/install/) for application/dashboard setup and the [local source guide](/contributing/local-setup/) for operator recovery. These are upgrade instructions, not a claim that a real Google/cloud deployment has been validated.

See [upgrade operations](/deployment/upgrades/) for backup/redeploy verification. Historical release validation records apply only to their recorded revision and environment.
