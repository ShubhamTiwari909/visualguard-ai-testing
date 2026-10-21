---
title: "Testing CLI options"
description: "Look up every option, default and choice for the VisualGuard testing commands, from zero-config scans to test, report, analyze, fix and merge."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/cli/program.ts",
    "packages/visualguard/src/cli/commands/test.ts",
    "scripts/docs/generate-reference.mjs",
  ]
sidebar: { "order": 1 }
---

This page lists every option of the testing commands: the commands that capture, compare, report, analyse and fix screenshots on your own machine or in CI. Use it when you know which command you need and want its exact flags and defaults. For a shorter overview of all commands, see the [command reference](/reference/cli/).

## Before you start

- Install VisualGuard and Playwright in your app. The [quickstart](/start/quickstart/) gives a complete setup.
- Run commands from your app's root folder, with `npx --no-install` (npm) or `pnpm exec` (pnpm) in front of `visualguard`.
- The tables are generated from the source code. An older installed release may lack newer options, so also check `npx --no-install visualguard COMMAND --help`.

## How to read this page

Each command below has its own section with three parts:

1. A one-line description of what the command does.
2. A `--help` line that shows the command's arguments. `<name>` means the argument is required, `[name]` means it is optional, and `...` means you can give several.
3. A table with every option. **Default** shows the value used when you leave the option out. `not set` means a switch is off, or the value comes from your config file or a built-in default. **Choices** lists the only allowed values.

Command-line options win over environment variables, which win over the config file. See [environment variables](/reference/environment/) and [configuration fields](/reference/configuration/).

## Commands at a glance

| Command                 | What it is for                                                                                          | Example                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `visualguard [urls...]` | Try VisualGuard without a config: scan one site, or compare two.                                        | `visualguard https://example.com https://staging.example.com`                                 |
| `init`                  | Write `visualguard.config.ts`, and with `--workflow` a GitHub workflow.                                 | `visualguard init --production https://example.com --staging http://localhost:3000 --ai none` |
| `doctor`                | Check your setup before the first run or after an upgrade.                                              | `visualguard doctor`                                                                          |
| `test`                  | The main command: capture, compare and report. Add a project name or ID to save the run to a dashboard. | `visualguard test --only "/blog/**" --viewport desktop`                                       |
| `merge`                 | Combine shard runs into one report and exit code.                                                       | `visualguard merge downloaded-artifacts`                                                      |
| `monitor`               | Compare production with its own previous capture to catch content or third-party changes.               | `visualguard monitor https://example.com`                                                     |
| `report`                | Open the HTML report of a saved run.                                                                    | `visualguard report --run 0042`                                                               |
| `analyze`               | Add or redo AI analysis on a saved run without new screenshots.                                         | `visualguard analyze --provider gemini --no-cache`                                            |
| `accept`                | Record intentional changes so later runs accept them.                                                   | `visualguard accept /pricing --note "New pricing layout"`                                     |
| `comment`               | Post the result summary on the pull request from CI.                                                    | `visualguard comment --dry-run`                                                               |
| `fix`                   | Propose and check code fixes for regressions. Needs `fix.enabled`.                                      | `visualguard fix /pricing`                                                                    |
| `watch`                 | Re-test routes against your dev server each time you save.                                              | `visualguard watch /pricing --staging http://localhost:3000`                                  |
| `auth`                  | Save a logged-in browser session for captures.                                                          | `visualguard auth staging --until-url "**/dashboard"`                                         |

`report`, `analyze`, `accept`, `comment` and `fix` work on a saved run. `--run` accepts a run ID, an ID prefix or a run number; without it they use the latest run.

## Related pages

- [Exit codes](/reference/exit-codes/) explain what `--fail-on` changes.
- [Run artifacts](/reference/artifacts/) list the files each run writes.
- [Capture and report problems](/troubleshooting/capture/) help when a command fails.
- [Dashboard CLI options](/reference/cli/dashboard/) cover `visualguard dashboard` and its subcommands.

<!-- generated-reference -->

## visualguard

AI visual regression agent: compare production and staging, explain every difference.

```sh
visualguard [urls...] --help
```

| Option                | Default        | Meaning                                                             |
| --------------------- | -------------- | ------------------------------------------------------------------- |
| `-v, --version`       | not set        | output the version number                                           |
| `-c, --config <path>` | not set        | config file path (viewports, stabilisation and AI settings)         |
| `--only <glob>`       | not set        | filter routes; repeatable                                           |
| `--viewport <name>`   | not set        | run only this viewport; repeatable                                  |
| `--concurrency <n>`   | not set        | pages captured in parallel                                          |
| `--fail-on <level>`   | `"regression"` | what makes the exit code non-zero Choices: regression, review, any. |
| `--ci`                | not set        | no prompts, colours or spinners                                     |
| `--json`              | not set        | print the manifest JSON to stdout                                   |
| `--junit <path>`      | not set        | write a JUnit XML report                                            |
| `--debug`             | not set        | save Playwright traces                                              |
| `--a11y`              | not set        | also report new accessibility violations (axe-core)                 |
| `--perf`              | not set        | also report slower loads, more layout shift and heavier pages       |
| `--provider <name>`   | not set        | AI provider Choices: gemini, ollama, none.                          |
| `--model <id>`        | not set        | AI model id                                                         |
| `--no-ai`             | not set        | skip AI analysis (heuristics only)                                  |

## visualguard init

set up VisualGuard: writes visualguard.config.ts

```sh
visualguard init --help
```

| Option               | Default | Meaning                                      |
| -------------------- | ------- | -------------------------------------------- |
| `-y, --yes`          | not set | accept defaults without prompting            |
| `--production <url>` | not set | production URL                               |
| `--staging <url>`    | not set | staging or preview URL                       |
| `--ai <provider>`    | not set | AI provider Choices: gemini, ollama, none.   |
| `--force`            | not set | overwrite an existing config file            |
| `--workflow`         | not set | also write .github/workflows/visualguard.yml |

## visualguard doctor

check Playwright, the config, the URLs and the AI provider

```sh
visualguard doctor --help
```

| Option                | Default | Meaning          |
| --------------------- | ------- | ---------------- |
| `-c, --config <path>` | not set | config file path |

## visualguard test

capture production and staging, diff every route, and report the differences

```sh
visualguard test [project] --help
```

| Option                 | Default        | Meaning                                                                                |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `-c, --config <path>`  | not set        | config file path                                                                       |
| `--browser <name>`     | not set        | browser engine Choices: chromium, firefox, webkit.                                     |
| `--output-dir <path>`  | not set        | run artifact directory                                                                 |
| `--production <url>`   | not set        | override the production base URL                                                       |
| `--staging <url>`      | not set        | override the staging base URL, e.g. http://localhost:3000                              |
| `--route <path>`       | not set        | test only this path; repeatable, replaces configured routes                            |
| `--only <glob>`        | not set        | filter routes, e.g. --only "/blog/**"; repeatable                                      |
| `--viewport <name>`    | not set        | run only this viewport; repeatable                                                     |
| `--concurrency <n>`    | not set        | pages captured in parallel                                                             |
| `--a11y`               | not set        | also report new accessibility violations (axe-core)                                    |
| `--perf`               | not set        | also report slower loads, more layout shift and heavier pages                          |
| `--provider <name>`    | not set        | AI provider Choices: gemini, ollama, none.                                             |
| `--model <id>`         | not set        | AI model id                                                                            |
| `--no-ai`              | not set        | skip AI analysis (heuristics only)                                                     |
| `--fail-on <level>`    | `"regression"` | what makes the exit code non-zero Choices: regression, review, any.                    |
| `--ci`                 | not set        | no prompts, colours or spinners                                                        |
| `--json`               | not set        | print the manifest JSON to stdout                                                      |
| `--junit <path>`       | not set        | write a JUnit XML report                                                               |
| `--debug`              | not set        | save Playwright traces                                                                 |
| `--list`               | not set        | print the resolved URL pairs and exit without capturing                                |
| `--run-group <id>`     | not set        | shared identity for all shards of one execution                                        |
| `--dashboard <url>`    | not set        | dashboard origin (or VISUALGUARD_DASHBOARD_URL); otherwise use local dashboard storage |
| `--environment <name>` | `"staging"`    | dashboard environment label                                                            |
| `--run-name <name>`    | not set        | custom dashboard run name (requires a project)                                         |
| `--branch <name>`      | not set        | dashboard branch label                                                                 |
| `--commit <sha>`       | not set        | dashboard source revision                                                              |
| `--pr <number>`        | not set        | dashboard pull request number                                                          |
| `--deployment <id>`    | not set        | dashboard deployment label                                                             |
| `--update-baselines`   | not set        | baseline mode: save this run's screenshots as the baselines                            |
| `--shard <i/n>`        | not set        | run one part of the jobs, e.g. 1/4; combine the parts with `visualguard merge`         |

## visualguard merge

combine the runs of `test --shard` jobs into one run, report and exit code

```sh
visualguard merge <paths...> --help
```

| Option                | Default        | Meaning                                                                  |
| --------------------- | -------------- | ------------------------------------------------------------------------ |
| `-c, --config <path>` | not set        | config file path                                                         |
| `--fail-on <level>`   | `"regression"` | what makes the exit code non-zero Choices: regression, review, any.      |
| `--allow-partial`     | not set        | emit an incomplete report when shards or jobs are missing (nonzero exit) |
| `--ci`                | not set        | no colours                                                               |
| `--json`              | not set        | print the merged manifest JSON to stdout                                 |
| `--junit <path>`      | not set        | write a JUnit XML report                                                 |

## visualguard monitor

compare the live site with its own previous capture, e.g. nightly, to catch CMS edits and broken third-party scripts

```sh
visualguard monitor [url] --help
```

| Option                  | Default        | Meaning                                                                              |
| ----------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `-c, --config <path>`   | not set        | config file path                                                                     |
| `--browser <name>`      | not set        | browser engine Choices: chromium, firefox, webkit.                                   |
| `--output-dir <path>`   | not set        | run artifact directory                                                               |
| `--production <url>`    | not set        | override the production base URL                                                     |
| `--staging <url>`       | not set        | override the staging base URL, e.g. http://localhost:3000                            |
| `--route <path>`        | not set        | test only this path; repeatable, replaces configured routes                          |
| `--only <glob>`         | not set        | filter routes, e.g. --only "/blog/**"; repeatable                                    |
| `--viewport <name>`     | not set        | run only this viewport; repeatable                                                   |
| `--concurrency <n>`     | not set        | pages captured in parallel                                                           |
| `--a11y`                | not set        | also report new accessibility violations (axe-core)                                  |
| `--perf`                | not set        | also report slower loads, more layout shift and heavier pages                        |
| `--provider <name>`     | not set        | AI provider Choices: gemini, ollama, none.                                           |
| `--model <id>`          | not set        | AI model id                                                                          |
| `--no-ai`               | not set        | skip AI analysis (heuristics only)                                                   |
| `--fail-on <level>`     | `"regression"` | what makes the exit code non-zero Choices: regression, review, any.                  |
| `--ci`                  | not set        | no prompts, colours or spinners                                                      |
| `--json`                | not set        | print the manifest JSON to stdout                                                    |
| `--junit <path>`        | not set        | write a JUnit XML report                                                             |
| `--debug`               | not set        | save Playwright traces                                                               |
| `--reset`               | not set        | replace every stored snapshot with this run's captures                               |
| `--workflow [schedule]` | not set        | write .github/workflows/visualguard-monitor.yml (cron, default "0 3 * * *") and exit |

## visualguard report

open the HTML report for the latest run (or --run <id>)

```sh
visualguard report --help
```

| Option                | Default | Meaning                                           |
| --------------------- | ------- | ------------------------------------------------- |
| `-c, --config <path>` | not set | config file path                                  |
| `--run <id>`          | not set | run id, id prefix or run number (default: latest) |
| `--port <n>`          | not set | port to serve on (default: random)                |
| `--no-open`           | not set | don't open a browser                              |
| `--no-serve`          | not set | only write index.html and print its path          |

## visualguard analyze

run AI analysis on an existing run without capturing again

```sh
visualguard analyze --help
```

| Option                | Default        | Meaning                                                             |
| --------------------- | -------------- | ------------------------------------------------------------------- |
| `-c, --config <path>` | not set        | config file path                                                    |
| `--run <id>`          | not set        | run id, id prefix or run number (default: latest)                   |
| `--provider <name>`   | not set        | AI provider Choices: gemini, ollama.                                |
| `--model <id>`        | not set        | AI model id                                                         |
| `--no-cache`          | not set        | ignore cached answers                                               |
| `--only <glob>`       | not set        | analyze only matching routes; repeatable                            |
| `--fail-on <level>`   | `"regression"` | what makes the exit code non-zero Choices: regression, review, any. |
| `--ci`                | not set        | no colours                                                          |
| `--json`              | not set        | print the updated manifest JSON to stdout                           |

## visualguard accept

accept changes as intentional so they stop failing (writes visualguard.accepted.json)

```sh
visualguard accept [routes...] --help
```

| Option                | Default | Meaning                                           |
| --------------------- | ------- | ------------------------------------------------- |
| `-c, --config <path>` | not set | config file path                                  |
| `--run <id>`          | not set | run id, id prefix or run number (default: latest) |
| `--viewport <name>`   | not set | only this viewport; repeatable                    |
| `--all`               | not set | accept every change marked review in the run      |
| `--note <text>`       | not set | why the change is intentional                     |

## visualguard comment

post or update the VisualGuard comment on the pull request (CI)

```sh
visualguard comment --help
```

| Option                | Default | Meaning                                                 |
| --------------------- | ------- | ------------------------------------------------------- |
| `-c, --config <path>` | not set | config file path                                        |
| `--run <id>`          | not set | run id, id prefix or run number (default: latest)       |
| `--link <url>`        | not set | link to the full report, e.g. the uploaded artifact URL |
| `--pr <number>`       | not set | pull request number (default: from the GitHub event)    |
| `--repo <owner/name>` | not set | repository (default: GITHUB_REPOSITORY)                 |
| `--dry-run`           | not set | print the comment instead of posting it                 |

## visualguard fix

propose, apply and visually verify fixes for regressions (asks before every change)

```sh
visualguard fix [routes...] --help
```

| Option                | Default | Meaning                                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------------ |
| `-c, --config <path>` | not set | config file path                                                                     |
| `--run <id>`          | not set | run id, id prefix or run number (default: latest)                                    |
| `--viewport <name>`   | not set | only this viewport; repeatable                                                       |
| `--include-review`    | not set | also try changes marked review                                                       |
| `--allow-dirty`       | not set | allow uncommitted changes in the working tree                                        |
| `-y, --yes`           | not set | apply without asking (only when fix.requireConfirmation is false or you're sure)     |
| `--auto`              | not set | no prompts: fix on a new branch in a separate git worktree and commit verified fixes |
| `--pr`                | not set | with --auto: push the branch and open a pull request                                 |
| `--base <branch>`     | not set | with --pr: base branch (default: the current branch)                                 |
| `--branch <name>`     | not set | with --auto: branch name (default: visualguard/fix-<run>-<id>)                       |
| `--in-place`          | not set | with --auto: use the current checkout instead of a worktree (CI)                     |
| `--keep-worktree`     | not set | with --auto: keep the worktree for inspection                                        |
| `--provider <name>`   | not set | AI provider Choices: gemini, ollama, none.                                           |
| `--model <id>`        | not set | AI model id                                                                          |
| `--no-ai`             | not set | skip AI analysis (heuristics only)                                                   |

## visualguard watch

re-test changed routes against your local dev server whenever you save

```sh
visualguard watch [routes...] --help
```

| Option                | Default | Meaning                                                                  |
| --------------------- | ------- | ------------------------------------------------------------------------ |
| `-c, --config <path>` | not set | config file path                                                         |
| `--staging <url>`     | not set | local URL to test (default: fix.verify.server.url, then baseURL.staging) |
| `--viewport <name>`   | not set | run only this viewport; repeatable                                       |
| `--provider <name>`   | not set | AI provider Choices: gemini, ollama, none.                               |
| `--model <id>`        | not set | AI model id                                                              |
| `--no-ai`             | not set | skip AI analysis (heuristics only)                                       |

## visualguard auth

log in once in a browser window and save the session for captures

```sh
visualguard auth <env> --help
```

| Option                | Default | Meaning                                                                |
| --------------------- | ------- | ---------------------------------------------------------------------- |
| `-c, --config <path>` | not set | config file path                                                       |
| `--url <url>`         | not set | page to open (default: the environment's base URL)                     |
| `--out <path>`        | not set | where to save the session (default: .visualguard/auth/<env>.json)      |
| `--until-url <glob>`  | not set | save automatically when the page reaches this URL, e.g. '**/dashboard' |
