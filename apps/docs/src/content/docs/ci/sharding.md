---
title: "Shard and merge complete evidence"
description: "Split a comparison scope across workers and reject incomplete or incompatible merges."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md", "docs/RELIABILITY-CHANGES.md"]
sidebar: {"order": 4}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

Use the same unique execution group, configuration, source revision and job scope on every shard:

```bash
npx visualguard test --ci --shard 1/2 --run-group ci-execution-123
npx visualguard test --ci --shard 2/2 --run-group ci-execution-123
# Download/copy the shard run directories into a common folder first.
npx visualguard merge downloaded-shards --ci --junit merged-junit.xml
```

GitHub Actions derives the group from the run ID/attempt automatically; other systems can set `VISUALGUARD_RUN_GROUP`. Jobs are sorted and distributed round-robin. Merge rejects mixed groups/settings/revisions, duplicate shards/jobs, legacy provenance and incomplete coverage. `--allow-partial` explicitly produces a diagnostic report with an incomplete banner and a failing exit code.

## Reliability and migration rules

Use one unique group value for each execution, shared by all its shards:

```sh
npx visualguard test --shard 1/2 --run-group my-ci-execution-123
npx visualguard test --shard 2/2 --run-group my-ci-execution-123
npx visualguard merge downloaded-artifacts
```

GitHub Actions uses its run ID and attempt automatically. Other CI systems can set `VISUALGUARD_RUN_GROUP`. Legacy runs without provenance must be recaptured. `merge --allow-partial` creates an explicitly incomplete diagnostic report and returns a failing exit code.

## Add shards only after one worker works

Give every worker the same config, source revision and unique execution identity. Vary only shard index and artifact name. Upload each whole run folder even on visual failure. Download all shard run directories beneath the common merge folder before invoking merge; the merge folder is not a remote artifact URL.

## Verify and troubleshoot

Merge the complete set and inspect every expected route/viewport. Then deliberately omit one shard in a disposable run: default merge must fail. Mixed identities, duplicate jobs, wrong revisions or incompatible metadata need a fresh consistent execution. `--allow-partial` creates diagnostic incomplete evidence and still fails; do not use it to satisfy CI policy.

[Read failure policy](/reference/exit-codes/) before interpreting a merge result.
