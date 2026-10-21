---
title: "Command reference"
description: "See every VisualGuard command and subcommand with a one-line purpose, the global flags, and where to find each command's full option table."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "README.md",
    "packages/visualguard/src/cli/program.ts",
    "packages/visualguard/src/cli/main.ts",
    "packages/visualguard/src/cli/commands/dashboard.ts",
    "packages/visualguard/src/core/errors.ts",
  ]
sidebar: { "order": 1 }
---

This page lists every `visualguard` command in one place, with a one-line purpose and a link to its full option table. Use it to find the right command, then open the detailed table for its flags and defaults.

## Before you start

- Install VisualGuard in your app first. See [installation](/start/install/).
- Run commands from your app's root folder. Put `npx --no-install` (npm) or `pnpm exec` (pnpm) in front of `visualguard` so the locally installed version runs.
- The tables on these pages come from the source code. An older installed release may not have every option, so check its `--help` too.

## Get help for any command

Add `--help` (or `-h`) to any command or subcommand:

```bash
npx --no-install visualguard --help
npx --no-install visualguard test --help
npx --no-install visualguard dashboard project create --help
```

You should see the command's arguments, options and defaults. The top-level help also prints a few examples.

## Global flags

| Flag            | What it does                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `-v, --version` | Prints the CLI build label. Compare with package-manager metadata if the values differ; see [release availability](/releases/). |
| `-h, --help`    | Prints help for the command it follows.                                                                                         |

Options belong to the command they follow. `visualguard test --viewport mobile` passes `--viewport` to `test`, not to the top-level command.

## Testing commands

Full option tables: [Testing CLI options](/reference/cli/testing/).

| Command                          | Purpose                                                                                                                                            | Options                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `visualguard <url> [url2]`       | Scan one site, or compare two URLs, without a config file.                                                                                         | [Table](/reference/cli/testing/#visualguard)         |
| `visualguard init`               | Create `visualguard.config.ts`, and optionally a GitHub workflow.                                                                                  | [Table](/reference/cli/testing/#visualguard-init)    |
| `visualguard doctor`             | Check Node, Playwright, the browser, the config, both URLs and the AI provider.                                                                    | [Table](/reference/cli/testing/#visualguard-doctor)  |
| `visualguard test [project]`     | Capture production and staging (or baselines), compare every route and report the differences. With a project, also save the run to the dashboard. | [Table](/reference/cli/testing/#visualguard-test)    |
| `visualguard merge <paths...>`   | Combine the runs of `test --shard` jobs into one run, report and exit code.                                                                        | [Table](/reference/cli/testing/#visualguard-merge)   |
| `visualguard monitor [url]`      | Compare the live site with its own previous capture, for example every night.                                                                      | [Table](/reference/cli/testing/#visualguard-monitor) |
| `visualguard report`             | Open the HTML report for the latest run, or the one given with `--run`.                                                                            | [Table](/reference/cli/testing/#visualguard-report)  |
| `visualguard analyze`            | Run AI analysis on a saved run without capturing again.                                                                                            | [Table](/reference/cli/testing/#visualguard-analyze) |
| `visualguard accept [routes...]` | Mark changes as intentional so they stop failing. Writes `visualguard.accepted.json`.                                                              | [Table](/reference/cli/testing/#visualguard-accept)  |
| `visualguard comment`            | Post or update the VisualGuard comment on a GitHub pull request.                                                                                   | [Table](/reference/cli/testing/#visualguard-comment) |
| `visualguard fix [routes...]`    | Propose, apply and visually check source fixes for regressions. Asks before every change.                                                          | [Table](/reference/cli/testing/#visualguard-fix)     |
| `visualguard watch [routes...]`  | Re-test changed routes against your local dev server each time you save.                                                                           | [Table](/reference/cli/testing/#visualguard-watch)   |
| `visualguard auth <env>`         | Log in once in a browser window and save the session for captures.                                                                                 | [Table](/reference/cli/testing/#visualguard-auth)    |

## Dashboard commands

Full option tables: [Dashboard CLI options](/reference/cli/dashboard/).

| Command                                         | Purpose                                                                        | Options                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `visualguard dashboard`                         | Start the dashboard server.                                                    | [Table](/reference/cli/dashboard/#visualguard-dashboard)                  |
| `visualguard dashboard runner`                  | Connect a private browser runner that runs tests requested from the dashboard. | [Table](/reference/cli/dashboard/#visualguard-dashboard-runner)           |
| `visualguard dashboard project create <id>`     | Create a project if its ID does not exist yet. Alias: `add`.                   | [Table](/reference/cli/dashboard/#visualguard-dashboard-project-create)   |
| `visualguard dashboard import <run-directory>`  | Import a saved run straight into the configured database.                      | [Table](/reference/cli/dashboard/#visualguard-dashboard-import)           |
| `visualguard dashboard publish <run-directory>` | Upload a saved run to a dashboard server with `VISUALGUARD_UPLOAD_TOKEN`.      | [Table](/reference/cli/dashboard/#visualguard-dashboard-publish)          |
| `visualguard dashboard baseline pull <set>`     | Download an approved, read-only baseline set into a new folder.                | [Table](/reference/cli/dashboard/#visualguard-dashboard-baseline-pull)    |
| `visualguard dashboard policy assess`           | Check whether one exact commit meets the project's visual policy.              | [Table](/reference/cli/dashboard/#visualguard-dashboard-policy-assess)    |
| `visualguard dashboard policy reconcile`        | Refresh GitHub checks for one pull request or every tracked one.               | [Table](/reference/cli/dashboard/#visualguard-dashboard-policy-reconcile) |
| `visualguard dashboard export <file>`           | Export portable evidence without account secrets.                              | [Table](/reference/cli/dashboard/#visualguard-dashboard-export)           |
| `visualguard dashboard restore <file>`          | Merge a portable export without overwriting evidence.                          | [Table](/reference/cli/dashboard/#visualguard-dashboard-restore)          |
| `visualguard dashboard assets`                  | Copy the prebuilt dashboard UI for static or serverless hosting.               | [Table](/reference/cli/dashboard/#visualguard-dashboard-assets)           |
| `visualguard dashboard init`                    | Generate a minimal Cloud Run or Vercel deployment folder.                      | [Table](/reference/cli/dashboard/#visualguard-dashboard-init)             |

Dashboard startup options such as `--env-file` and `--data-dir` go before the subcommand:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard publish .visualguard/runs/RUN_ID --project my-app --server https://YOUR_DASHBOARD_HOST
```

## Common `test` flags

| Flags                                                                                        | What they do                                                                                   |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `--config`, `--production`, `--staging`                                                      | Choose the config file and override the two base URLs.                                         |
| `--route`, `--only`, `--viewport`                                                            | Replace the routes, filter routes by glob, or pick configured viewports. Each can be repeated. |
| `--browser`, `--output-dir`, `--concurrency`                                                 | Choose the browser, the folder for run files, and how many pages capture in parallel.          |
| `--provider`, `--model`, `--no-ai`                                                           | Choose or turn off AI analysis.                                                                |
| `--a11y`, `--perf`                                                                           | Also check accessibility and performance for this run.                                         |
| `--update-baselines`                                                                         | In baseline mode, save this run's screenshots as the new baselines.                            |
| `--shard`, `--run-group`                                                                     | Run one part of the jobs and name the shared execution.                                        |
| `--ci`, `--json`, `--junit`, `--debug`                                                       | Plain CI output, manifest JSON on stdout, a JUnit file, or Playwright traces.                  |
| `--list`, `--fail-on`                                                                        | Print the planned URL pairs without capturing, or choose what fails the run.                   |
| `--dashboard`, `--environment`, `--run-name`, `--branch`, `--commit`, `--pr`, `--deployment` | Send the run to a dashboard and label it.                                                      |

## Example

A first check on a pull request preview, with plain output and a JUnit file for CI:

```bash
npx --no-install visualguard test --staging https://pr-42.preview.example.com --ci --junit reports/visualguard.xml
```

You should see progress for each route and viewport, then a summary of the result statuses. The command exits `0` when nothing fails your `--fail-on` policy.

## Exit codes

| Code | Meaning                                                                          |
| ---- | -------------------------------------------------------------------------------- |
| `0`  | Success, or the result meets the failure policy. Help and version also exit `0`. |
| `1`  | Failing visual results, incomplete merged results, or an unexpected error.       |
| `2`  | Invalid config or command usage.                                                 |
| `3`  | Environment problem, such as a missing browser or unreachable URL.               |

See [exit codes](/reference/exit-codes/) for each command's rules.

## Troubleshooting

| Problem                                      | Fix                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npx` downloads a package                    | Run from the app root and use `npx --no-install`.                                                          |
| `error: unknown option`                      | The option belongs to another command, or your installed release does not have it. Check `COMMAND --help`. |
| Dashboard subcommand ignores `--env-file`    | Put startup options before the subcommand, as shown above.                                                 |
| CLI label differs from the installed version | Check the local binary and `npm ls visualguard --depth=0`; include both values in a bug report.            |

More help: [installation problems](/troubleshooting/installation/).

## Next steps

- [Look up configuration fields](/reference/configuration/) that commands read.
- [Look up environment variables](/reference/environment/) and which process reads them.
- [Read the baseline command workflows](/reference/cli/baselines/) before you update references.
