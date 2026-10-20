---
title: "Run visual tests in CI"
description: "Install reproducibly, await the tested environments and preserve evidence when comparisons fail."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md"]
sidebar: {"order": 1}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

The essential CI commands are:

```bash
npx playwright install --with-deps chromium
npx visualguard test --ci --junit visualguard-junit.xml
```

Upload the entire run directory and JUnit file even when the test exits nonzero. `init` can generate a GitHub workflow with report artifacts and a sticky PR comment. GitHub runs can append a job summary; `visualguard comment --link <artifact-url>` updates the PR comment and needs a token with PR write permission. Fork PR tokens may lack that permission.

For preview deployments, pass their URL through `VISUALGUARD_STAGING_URL` or `--staging`. The webhook integration (`report.webhook` / `VISUALGUARD_WEBHOOK_URL`) POSTs a JSON run summary with a ready-to-use `text` field. `report.publicURL` provides report links; it does not host the report.

### GitHub Action

The repository's [composite Action](action/README.md) installs the selected browser, runs the test, uploads artifacts, optionally comments and propagates failures. Select a release tag or commit containing the desired behavior.

Inputs include `working-directory`, `browser`, `output-directory`, `artifact-name`, `junit-path`, `args`, `fail-on`, `staging-url`, `gemini-api-key`, `comment`, `github-token` and `exec`. Browser/output inputs override configuration and match installation/artifact paths. Use distinct artifact names in matrix jobs. The Action exposes `report-url` and `outcome`; configure an AI provider as well as supplying credentials when AI is desired.

### Sharding

Use the same unique execution group, configuration, source revision and job scope on every shard:

```bash
npx visualguard test --ci --shard 1/2 --run-group ci-execution-123
npx visualguard test --ci --shard 2/2 --run-group ci-execution-123
# Download/copy the shard run directories into a common folder first.
npx visualguard merge downloaded-shards --ci --junit merged-junit.xml
```

GitHub Actions derives the group from the run ID/attempt automatically; other systems can set `VISUALGUARD_RUN_GROUP`. Jobs are sorted and distributed round-robin. Merge rejects mixed groups/settings/revisions, duplicate shards/jobs, legacy provenance and incomplete coverage. `--allow-partial` explicitly produces a diagnostic report with an incomplete banner and a failing exit code.

## Required sequence

1. Check out the code whose UI is actually deployed, install its committed lockfile and select Node 22.12+.
2. Install the Playwright browser/system dependencies used by the config.
3. Start application servers or wait for deployed reference/candidate URLs to be ready. A port opening alone is not proof the expected build is served.
4. Supply actual environment URLs and optional scoped upload/AI credentials through CI secret storage.
5. Run with `--ci`, preserve the original test exit outcome, and upload the entire run directory plus JUnit file even on failure.
6. If publishing to a dashboard, include the true captured commit/branch/PR metadata. Inspect its stored result independently from the upload outcome.

## Verify and troubleshoot

Run an intentional regression in a trial PR. The job should preserve screenshots and return the selected failure policy. If it passes unexpectedly, inspect route coverage, masks, active URL/commit and `--fail-on`. [Use the complete GitHub example](/ci/github-actions/) before adding sharding.
