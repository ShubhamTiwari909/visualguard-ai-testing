---
title: "Command reference"
description: "Find the exact arguments, options and defaults for the current VisualGuard command families."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "packages/visualguard/src/cli/program.ts"]
sidebar: {"order": 1}
---

| Command                        | Purpose                                                          |
| ------------------------------ | ---------------------------------------------------------------- |
| `visualguard <url> [url2]`     | Scan one site or compare two URLs without setup.                 |
| `visualguard init`             | Create configuration and optionally a CI workflow.               |
| `visualguard doctor`           | Diagnose setup, browser, configuration and reachability.         |
| `visualguard test`             | Run the configured live comparison or baseline check.            |
| `visualguard analyze`          | Re-analyze saved captures with a provider/model or bypass cache. |
| `visualguard report`           | Open/serve a report; select a run or write static HTML only.     |
| `visualguard accept [routes]`  | Record intentional changes for later runs.                       |
| `visualguard fix [routes]`     | Propose, apply and verify repairs.                               |
| `visualguard watch [routes]`   | Re-test local source changes.                                    |
| `visualguard monitor [url]`    | Compare a site with its previous capture or generate a schedule. |
| `visualguard auth <env>`       | Save an authenticated browser session.                           |
| `visualguard merge <paths...>` | Validate and combine shard results.                              |
| `visualguard comment`          | Post/update a sticky GitHub PR comment; supports `--dry-run`.    |

Common `test` flags:

| Flags                                        | Purpose                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `--config`, `--production`, `--staging`      | Select configuration and override environment URLs.                            |
| `--route`, `--only`, `--viewport`            | Replace routes, filter route globs or select configured viewports; repeatable. |
| `--browser`, `--output-dir`, `--concurrency` | Select the browser, artifact directory and capture parallelism.                |
| `--provider`, `--model`, `--no-ai`           | Select or disable AI analysis.                                                 |
| `--a11y`, `--perf`                           | Enable independent checks for this run.                                        |
| `--update-baselines`                         | Explicitly update references in baseline mode.                                 |
| `--shard`, `--run-group`                     | Partition jobs and identify one execution.                                     |
| `--ci`, `--json`, `--junit`, `--debug`       | Plain CI output, JSON stdout, JUnit output or Playwright traces.               |
| `--list`, `--fail-on`                        | Inspect planned jobs without capture or select failure policy.                 |

Run `npx --no-install visualguard <command> --help` for command-specific options. Exit codes: `0` success, `1` failed jobs/incomplete results, `2` configuration/usage error, `3` environment error.

## Full option reference

- [Testing and local baseline commands](/reference/cli/testing/) include zero-config, init, doctor, capture, reports, AI, fixes, auth, watch, monitor, comments and merge.
- [Dashboard commands](/reference/cli/dashboard/) include startup, project management, publishing, private runners, approved references, policies, backup and scaffolding.
- [Environment variables](/reference/environment/) explain which process reads a value.

Run `npx --no-install visualguard COMMAND --help` for the installed artifact. Reference tables are generated from the inspected source registration, not a promise that an older package has those options.
