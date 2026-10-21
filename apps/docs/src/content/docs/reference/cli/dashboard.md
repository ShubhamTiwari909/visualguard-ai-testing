---
title: "Dashboard CLI options"
description: "Look up every option of visualguard dashboard and its subcommands: startup, runners, projects, import and publish, approved baselines, policies, backups and hosting files."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/cli/commands/dashboard.ts",
    "apps/platform/server/runtime.ts",
    "apps/platform/server/test-runner.ts",
    "scripts/docs/generate-reference.mjs",
  ]
sidebar: { "order": 2 }
---

This page lists every option of `visualguard dashboard` and its subcommands. Use it when you start a dashboard, connect a runner, create projects, upload runs, pull approved baselines, check policies, back up evidence or generate hosting files. For a shorter overview of all commands, see the [command reference](/reference/cli/).

## Before you start

- Use the same VisualGuard release on the dashboard server, private runners and test machines.
- Know which credential each command needs. Publishing needs a project upload token (`VISUALGUARD_UPLOAD_TOKEN`). A private runner needs a separate runner credential (`VISUALGUARD_RUNNER_TOKEN`). See [publishing](/dashboard/publishing/) and [private runners](/dashboard/private-runners/).
- [Dashboard setup](/dashboard/local/) explains the settings file and storage choices.

## How to read this page

Each command below has a one-line description, a `--help` line with its arguments and a table of options. `<name>` means the argument is required and `[name]` means it is optional. **Default** shows the value used when you leave the option out; `not set` means the option is off or falls back to an environment variable or local storage.

Startup options (`--port`, `--host`, `--data-dir`, `--file`, `--env-file`) belong to `visualguard dashboard` itself. When you combine them with a subcommand, put them **before** the subcommand:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard project create my-app --name "My Application"
```

Commands with a `--server` option talk to a running dashboard over HTTP. Without `--server`, most of them read and write the local database that the current settings select.

## Commands at a glance

| Command                      | What it is for                                                                                                | Example                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `dashboard`                  | Start the dashboard server. It listens on `127.0.0.1:4400` by default.                                        | `visualguard dashboard --env-file .env.visualguard --port 4400`                                                |
| `dashboard runner`           | Keep a private runner open that captures tests requested with **Run test**. Needs `VISUALGUARD_RUNNER_TOKEN`. | `visualguard dashboard runner --project my-app --server https://YOUR_DASHBOARD_HOST`                           |
| `dashboard project create`   | Create a project with a stable ID. Does nothing if it already exists.                                         | `visualguard dashboard project create my-app --name "My Application"`                                          |
| `dashboard import`           | Import a saved run folder into the local database.                                                            | `visualguard dashboard import .visualguard/runs/RUN_ID --project my-app`                                       |
| `dashboard publish`          | Upload a saved run folder to a dashboard server. Needs `VISUALGUARD_UPLOAD_TOKEN`.                            | `visualguard dashboard publish .visualguard/runs/RUN_ID --project my-app --server https://YOUR_DASHBOARD_HOST` |
| `dashboard baseline pull`    | Download an approved baseline set into a new, read-only folder.                                               | `visualguard dashboard baseline pull main --project my-app --out .visualguard/approved-v1 --version 1`         |
| `dashboard policy assess`    | Print the policy result for one exact commit. `--enforce` makes it exit `2` unless satisfied.                 | `visualguard dashboard policy assess --project my-app --revision SHA --enforce`                                |
| `dashboard policy reconcile` | Recheck and publish GitHub checks. Pass exactly one of `--pr` or `--all`.                                     | `visualguard dashboard policy reconcile --project my-app --pr 42`                                              |
| `dashboard export`           | Write a compressed, portable evidence file without account secrets. The file must not exist yet.              | `visualguard dashboard export team-evidence.vgbackup.gz`                                                       |
| `dashboard restore`          | Merge a portable evidence file without overwriting existing evidence.                                         | `visualguard dashboard restore team-evidence.vgbackup.gz`                                                      |
| `dashboard assets`           | Copy the prebuilt dashboard UI for static or serverless hosting.                                              | `visualguard dashboard assets --out public`                                                                    |
| `dashboard init`             | Generate a Cloud Run or Vercel deployment folder.                                                             | `visualguard dashboard init --target cloud-run --out visualguard-dashboard`                                    |

:::note
When the installed dashboard supports built-in capture, it can run **Run test** itself using the signed-in user's login if no private runner is connected. `VISUALGUARD_BUILT_IN_RUNNER` and `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` control this. If host capture is unavailable, use a connected `dashboard runner`. See [environment variables](/reference/environment/).
:::

## Related pages

- [Dashboard problems](/troubleshooting/dashboard/) cover connection, token and runner errors.
- [Approved baselines](/dashboard/approved-baselines/) explain the review and promotion flow behind `baseline pull`.
- [Visual policies](/dashboard/visual-policies/) explain what `policy assess` checks.
- [Storage and backups](/deployment/storage-and-backups/) explain when `export` is not enough.

<!-- generated-reference -->

## visualguard dashboard

Run a dashboard, manage projects, import/publish evidence, or generate hosting files

```sh
visualguard dashboard --help
```

| Option                   | Default | Meaning                                          |
| ------------------------ | ------- | ------------------------------------------------ |
| `--port <number>`        | not set | HTTP port (default: PORT or 4400)                |
| `--host <host>`          | not set | Listener address; external access requires login |
| `--data-dir <directory>` | not set | Local data directory                             |
| `--file <sqlite-file>`   | not set | Open a local SQLite database file                |
| `--env-file <file>`      | not set | Load dashboard environment settings from a file  |

## visualguard dashboard runner

Connect a private browser runner for dashboard-requested tests

```sh
visualguard dashboard runner --help
```

| Option                   | Default  | Meaning                                               |
| ------------------------ | -------- | ----------------------------------------------------- |
| `--project <id>`         | not set  | Dashboard project ID                                  |
| `--server <url>`         | not set  | Dashboard origin                                      |
| `--once`                 | not set  | Poll once, execute pending work if present, then exit |
| `--poll <milliseconds>`  | `"3000"` | Polling interval (1000–30000)                         |
| `--work-dir <directory>` | not set  | Private directory for runner evidence                 |

## visualguard dashboard policy

Assess visual regression policy and reconcile exact-revision GitHub checks

```sh
visualguard dashboard policy --help
```

## visualguard dashboard policy assess

```sh
visualguard dashboard policy assess --help
```

| Option             | Default | Meaning                                          |
| ------------------ | ------- | ------------------------------------------------ |
| `--project <id>`   | not set | Project ID                                       |
| `--revision <sha>` | not set | Exact source commit                              |
| `--run <id>`       | not set | Assess a specific stored run                     |
| `--server <url>`   | not set | Dashboard origin; otherwise use local storage    |
| `--enforce`        | not set | Exit with failure unless the policy is satisfied |

## visualguard dashboard policy reconcile

```sh
visualguard dashboard policy reconcile --help
```

| Option           | Default | Meaning                                       |
| ---------------- | ------- | --------------------------------------------- |
| `--project <id>` | not set | Project ID                                    |
| `--pr <number>`  | not set | Verify and publish the live PR head           |
| `--all`          | not set | Refresh every tracked PR for this project     |
| `--server <url>` | not set | Dashboard origin; otherwise use local storage |

## visualguard dashboard baseline

Download immutable approved references

```sh
visualguard dashboard baseline --help
```

## visualguard dashboard baseline pull

```sh
visualguard dashboard baseline pull <set> --help
```

| Option               | Default | Meaning                                               |
| -------------------- | ------- | ----------------------------------------------------- |
| `--project <id>`     | not set | Project ID                                            |
| `--out <directory>`  | not set | New baseline directory (must not exist)               |
| `--version <number>` | not set | Pin an earlier immutable version; defaults to current |
| `--server <url>`     | not set | Dashboard origin; otherwise use the local database    |

## visualguard dashboard project

Manage dashboard projects

```sh
visualguard dashboard project --help
```

## visualguard dashboard project create

Create a project if its ID is not already present

```sh
visualguard dashboard project create <id> --help
```

Aliases: `add`.

| Option           | Default | Meaning                                                                                      |
| ---------------- | ------- | -------------------------------------------------------------------------------------------- |
| `--name <name>`  | not set | Project display name (defaults to its ID)                                                    |
| `--server <url>` | not set | Dashboard origin (or VISUALGUARD_DASHBOARD_URL); otherwise use the configured local database |

## visualguard dashboard import

Import a saved run into the configured database

```sh
visualguard dashboard import <run-directory> --help
```

| Option                 | Default     | Meaning                   |
| ---------------------- | ----------- | ------------------------- |
| `--project <id>`       | not set     | Project slug              |
| `--name <name>`        | not set     | Project display name      |
| `--environment <name>` | `"staging"` | Environment label         |
| `--run-name <name>`    | not set     | Custom dashboard run name |
| `--branch <name>`      | not set     | Branch label              |
| `--commit <sha>`       | not set     | Source revision           |
| `--pr <number>`        | not set     | Pull request number       |
| `--deployment <id>`    | not set     | Deployment label          |

## visualguard dashboard publish

Publish using VISUALGUARD_UPLOAD_TOKEN

```sh
visualguard dashboard publish <run-directory> --help
```

| Option                 | Default     | Meaning                   |
| ---------------------- | ----------- | ------------------------- |
| `--project <id>`       | not set     | Project slug              |
| `--server <url>`       | not set     | Dashboard origin          |
| `--environment <name>` | `"staging"` | Environment label         |
| `--run-name <name>`    | not set     | Custom dashboard run name |
| `--branch <name>`      | not set     | Branch label              |
| `--commit <sha>`       | not set     | Source revision           |
| `--pr <number>`        | not set     | Pull request number       |
| `--deployment <id>`    | not set     | Deployment label          |

## visualguard dashboard export

Export portable evidence without account secrets

```sh
visualguard dashboard export <file> --help
```

## visualguard dashboard restore

Merge a portable backup without overwriting evidence

```sh
visualguard dashboard restore <file> --help
```

## visualguard dashboard assets

Copy prebuilt UI for static/serverless hosting

```sh
visualguard dashboard assets --help
```

| Option              | Default | Meaning          |
| ------------------- | ------- | ---------------- |
| `--out <directory>` | not set | Output directory |

## visualguard dashboard init

Generate a minimal Cloud Run or Vercel project

```sh
visualguard dashboard init --help
```

| Option                | Default                   | Meaning                               |
| --------------------- | ------------------------- | ------------------------------------- |
| `--target <host>`     | not set                   | vercel or cloud-run                   |
| `--out <directory>`   | `"visualguard-dashboard"` | New deployment project directory      |
| `--package <tarball>` | not set                   | Use a local release-candidate package |

Dashboard startup options such as `--env-file` and `--data-dir` belong before the subcommand. Use `visualguard dashboard --env-file FILE publish ...`, not an application `.env.local` assumption. Source-only host recovery is documented separately and is not a package CLI endpoint.
