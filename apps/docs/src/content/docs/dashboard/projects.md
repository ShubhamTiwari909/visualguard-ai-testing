---
title: "Projects, names and identities"
description: "Create, select and maintain project identities without confusing names, aliases or storage."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## Create and bind a project

From your application root, against the running local dashboard:

```sh
npx --no-install visualguard dashboard project create storefront --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

Use the same actual server origin for both commands. In login mode, create the project in the UI as an authorized user and use its scoped upload token for capture/publishing.

## Understand each identity

The public project ID is the CLI-facing identifier. Display names can be edited independently; an exact unique permitted display name can also select the project. The internal storage key remains immutable. Renaming the public ID retains historical aliases as implemented; deleted identifiers stay reserved, so old credentials cannot silently acquire a new project.

Select a project in the sidebar or apply its Run history filter before editing settings or starting a test. Each project stores independent configuration and credentials. Repeated create requests for an existing ID preserve its history rather than resetting it.

## Rename or delete deliberately

Use the project's configuration/settings UI with maintainer/administrator authority. Renaming does not rewrite immutable engine evidence. Run names are separate labels and can be restored to their defaults. Concurrent stale edits require refresh.

Project deletion removes its configuration, requests, memberships and credentials, subject to current baseline/evidence protections. It is not a way to repair a missing-run filter. Confirm project and run counts and take the appropriate backup before destructive removal.

## Project or run is missing

If `npx visualguard test "My Application"` runs but `npx visualguard dashboard` shows another workspace, first check which storage each process selected:

| Process                                 | Settings it reads                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test PROJECT`                          | Runner process settings and `.env`/`.env.local`; with no dashboard URL, it writes to the runner's configured database or local SQLite storage |
| `test PROJECT --dashboard URL`          | Publishes through that running dashboard, which selects the database; the runner needs no database URL                                        |
| `dashboard --env-file .env.visualguard` | Explicitly loads that file, then starts the dashboard; existing process settings take precedence                                              |
| `dashboard` without `--env-file`        | Uses process settings or defaults; it does not automatically read `.env.visualguard` or the runner's `.env.local`                             |

Relative local SQLite storage also depends on the calling directory. Use the same application root and a single running dashboard for this workflow. To select the MongoDB workspace from section 7, stop the old dashboard and run in terminal A:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

In terminal B, run against that exact server:

```sh
npx --no-install visualguard test "My Application" \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The display name must already identify exactly one project in that dashboard. If it does not exist there yet, create it first with a valid ID, then use that ID for tests:

```sh
npx --no-install visualguard dashboard project create my-app \
  --name "My Application" --server http://127.0.0.1:4400
npx --no-install visualguard test my-app \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

To recover the previous execution without recapturing, find its saved run directory in the earlier test output (by default `.visualguard/runs/RUN_ID`) and upload it after creating/selecting the project:

```sh
npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID \
  --project my-app --server http://127.0.0.1:4400
```

Replace `RUN_ID` with the actual saved directory containing `manifest.json`. Pointing a new dashboard at MongoDB does not migrate runs from an earlier SQLite workspace. Login mode requires this project's upload token for both testing and publishing; these examples assume local-owner mode.

## Verify the setup

Create two projects and confirm their history/configuration remain separate. Verify the immutable identity and selected server/storage before interpreting an empty view.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/project-configuration/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
