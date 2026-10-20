---
title: "Dashboard CLI options"
description: "Inspect dashboard startup and every registered project, upload, runner, baseline and policy option."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["packages/visualguard/src/cli/commands/dashboard.ts"]
sidebar: {"order": 2}
---

Use the same installed release for your server/worker workflow. The tables below reflect source registration. [Dashboard setup](/dashboard/local/) and [publishing](/dashboard/publishing/) explain prerequisites and credential scopes.

<!-- generated-reference -->

## visualguard dashboard

Run a dashboard, manage projects, import/publish evidence, or generate hosting files

```sh
visualguard dashboard --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--port <number>` | not set | HTTP port (default: PORT or 4400) |
| `--host <host>` | not set | Listener address; external access requires login |
| `--data-dir <directory>` | not set | Local data directory |
| `--file <sqlite-file>` | not set | Open a local SQLite database file |
| `--env-file <file>` | not set | Load dashboard environment settings from a file |

## visualguard dashboard runner

Connect a private browser runner for dashboard-requested tests

```sh
visualguard dashboard runner --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Dashboard project ID |
| `--server <url>` | not set | Dashboard origin |
| `--once` | not set | Poll once, execute pending work if present, then exit |
| `--poll <milliseconds>` | `"3000"` | Polling interval (1000–30000) |
| `--work-dir <directory>` | not set | Private directory for runner evidence |

## visualguard dashboard policy

Assess visual regression policy and reconcile exact-revision GitHub checks

```sh
visualguard dashboard policy --help
```

## visualguard dashboard policy assess



```sh
visualguard dashboard policy assess --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Project ID |
| `--revision <sha>` | not set | Exact source commit |
| `--run <id>` | not set | Assess a specific stored run |
| `--server <url>` | not set | Dashboard origin; otherwise use local storage |
| `--enforce` | not set | Exit with failure unless the policy is satisfied |

## visualguard dashboard policy reconcile



```sh
visualguard dashboard policy reconcile --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Project ID |
| `--pr <number>` | not set | Verify and publish the live PR head |
| `--all` | not set | Refresh every tracked PR for this project |
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

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Project ID |
| `--out <directory>` | not set | New baseline directory (must not exist) |
| `--version <number>` | not set | Pin an earlier immutable version; defaults to current |
| `--server <url>` | not set | Dashboard origin; otherwise use the local database |

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

| Option | Default | Meaning |
| --- | --- | --- |
| `--name <name>` | not set | Project display name (defaults to its ID) |
| `--server <url>` | not set | Dashboard origin (or VISUALGUARD_DASHBOARD_URL); otherwise use the configured local database |

## visualguard dashboard import

Import a saved run into the configured database

```sh
visualguard dashboard import <run-directory> --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Project slug |
| `--name <name>` | not set | Project display name |
| `--environment <name>` | `"staging"` | Environment label |
| `--run-name <name>` | not set | Custom dashboard run name |
| `--branch <name>` | not set | Branch label |
| `--commit <sha>` | not set | Source revision |
| `--pr <number>` | not set | Pull request number |
| `--deployment <id>` | not set | Deployment label |

## visualguard dashboard publish

Publish using VISUALGUARD_UPLOAD_TOKEN

```sh
visualguard dashboard publish <run-directory> --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | not set | Project slug |
| `--server <url>` | not set | Dashboard origin |
| `--environment <name>` | `"staging"` | Environment label |
| `--run-name <name>` | not set | Custom dashboard run name |
| `--branch <name>` | not set | Branch label |
| `--commit <sha>` | not set | Source revision |
| `--pr <number>` | not set | Pull request number |
| `--deployment <id>` | not set | Deployment label |

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

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <directory>` | not set | Output directory |

## visualguard dashboard init

Generate a minimal Cloud Run or Vercel project

```sh
visualguard dashboard init --help
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--target <host>` | not set | vercel or cloud-run |
| `--out <directory>` | `"visualguard-dashboard"` | New deployment project directory |
| `--package <tarball>` | not set | Use a local release-candidate package |


Dashboard startup options such as `--env-file` and `--data-dir` belong before the subcommand. Use `visualguard dashboard --env-file FILE publish ...`, not an application `.env.local` assumption. Source-only host recovery is documented separately and is not a package CLI endpoint.
