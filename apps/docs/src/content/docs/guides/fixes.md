---
title: "Propose and verify a repair"
description: "Inspect scoped repair proposals, control source access and verify changes before accepting them."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md"]
sidebar: {"order": 12}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

The configuration below is a property fragment. Its sample TypeScript verification command assumes your application has TypeScript; choose an existing project command or use an empty commands list. This repository keeps formatting/lint/type checks deferred during the current feature sequence.

Fixing is disabled by default. Enable it and define source scope plus a verification server:

```ts
fix: {
  enabled: true,
  include: ["app/**", "components/**", "styles/**"],
  // compareRef: "origin/main", // prioritize files changed since this ref
  verify: {
    server: { command: "npm run dev", url: "http://localhost:3000" },
    commands: ["npx tsc --noEmit"],
    commandTimeoutMs: 300_000,
  },
  maxAttempts: 2,
},
```

```bash
npx --no-install visualguard fix
npx --no-install visualguard fix /checkout --include-review
npx --no-install visualguard fix --run <run-id> --allow-dirty
```

The repair loop locates likely source files, proposes deterministic class/CSS repairs or AI search/replace edits, shows the diff, asks for confirmation, applies edits and verifies. It requires a Git repository and a clean working tree unless you explicitly use `--allow-dirty`. Editable scope excludes lockfiles, environment and configuration files. AI edits are restricted to supplied candidate files, and source upload requires consent or `fix.allowSourceUpload: true`.

Visual verification uses saved reference screenshots and capture policy from the selected run. Failed commands or visual mismatches revert edits. A final check covers the original run's routes/viewports to detect collateral changes; failures revert the batch. Uncaptured routes cannot be verified. Current authentication and hook callbacks must still match the original capture because credentials/functions are not serialized.

Proposals are checked for intervening file changes. Multi-file write failures attempt rollback; verification commands have bounded process termination. `fix-results.json`, `fixes/` and `fix-checks/` retain outcomes, available usage and verification evidence under the source run. Without a server, interactive edits are labelled `unverified`.

The served report offers **Generate fix → review diff → Apply and verify**. Proposals expire and concurrent report applications are blocked.

### Automatic Git workflow

`fix --auto` requires a verification server, creates a branch/worktree and commits only verified fixes. `--pr` additionally pushes and opens a PR; `--in-place` uses the current checkout. AI source-upload consent must already exist or be configured. Use plain interactive `fix` when you want edits without automatic commits or pushes.

## Verify the setup

Inspect the diff and saved verification evidence before retaining a repair. Verify rollback on a failing check in a disposable Git branch. A proposal or an unverified edit is not proof of correctness.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
