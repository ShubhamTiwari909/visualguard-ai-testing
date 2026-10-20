---
title: "Troubleshooting"
description: "Find your symptom, learn its likely cause, apply the exact fix and confirm that it worked."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["CONTRIBUTING.md", "packages/visualguard/src/core/errors.ts", "packages/visualguard/src/cli/commands/doctor.ts", "apps/platform/server/test-executions.ts"]
sidebar: {"order": 1}
---

Use this section when VisualGuard does not do what you expect. Find the symptom you see in the table below, then open the matching page. Each problem on those pages lists the likely cause, the exact fix and how to confirm the fix worked.

## Before you start

- Run commands from your app's root folder, the folder that holds `package.json` and `visualguard.config.ts`.
- Keep the full error text. Most VisualGuard errors print a message on one line and a hint on the next line.
- Examples use macOS/Linux shells; on Windows use WSL.

## Find your symptom

| What you see | Where to look |
| --- | --- |
| Node is too old, `npx` downloads another package, or the config file is not found | [Installation and version](/troubleshooting/installation/) |
| `Playwright's chromium browser is not installed.` on your computer or CI worker | [Installation and version](/troubleshooting/installation/) |
| The package says 3.2.3 but the CLI prints 3.2.2 | [Installation and version](/troubleshooting/installation/) |
| Connection refused, timeouts, login pages or blank screenshots | [Capture and reports](/troubleshooting/capture/) |
| Random pixel changes every run, or a real change is not detected | [Capture and reports](/troubleshooting/capture/) |
| Missing or incompatible baselines | [Capture and reports](/troubleshooting/capture/) |
| The report opens the wrong run or shows broken images | [Capture and reports](/troubleshooting/capture/) |
| `AI off`, `AI skipped`, `AI analysis failed` or a budget message in the report | [Capture and reports: AI analysis](/troubleshooting/capture/) |
| `visualguard fix` says a fix was rejected, reverted, failed or `unverified` | [Capture and reports: automatic fixes](/troubleshooting/capture/) |
| The dashboard shows another workspace, or your runs are missing | [Dashboard, login and runners](/troubleshooting/dashboard/) |
| `Cannot bind dashboard project` or `Dashboard publishing failed` | [Dashboard, login and runners](/troubleshooting/dashboard/) |
| **Run test** fails: `Chromium is not installed on the dashboard host`, `Connect a runner for this project before running a test`, `The dashboard is running another test; try again shortly` or `Runner disconnected or timed out` | [Dashboard, login and runners](/troubleshooting/dashboard/) |
| Login loops, Google callback errors, database connection errors | [Dashboard, login and runners](/troubleshooting/dashboard/) |
| Works locally but fails in CI, missing secrets, missing PR comments, shard merge errors | [CI, previews and sharding](/troubleshooting/ci/) |

## Collect the basics first

Most problems come from a version mismatch, the wrong folder or the wrong settings file. Run these commands in the same terminal and folder where the failure happened:

```bash
node --version
npm ls visualguard --depth=0
npx --no-install visualguard --version
npx --no-install playwright --version
npx --no-install visualguard doctor --config visualguard.config.ts
```

You should see Node 22.12 or newer, one installed `visualguard` version, and a `doctor` list where every line is marked as OK. `doctor` checks Node, Playwright, the browser, your config, both URLs, the AI provider, the output folder and `.gitignore`.

:::note
The published npm package 3.2.3 prints `3.2.2` from `visualguard --version`. This is a known label problem in that build. Trust `npm ls visualguard --depth=0` and include both numbers in any report.
:::

## Read the exit code

The exit code tells you which kind of problem you have. Check it with `echo $?` right after the command.

| Exit code | Meaning | Where to start |
| --- | --- | --- |
| `0` | The result meets your failure policy. | Nothing failed. Still open the report if your policy allows `review` results. |
| `1` | A visual regression, a capture error, missing shards or an unexpected error. | Open the report and the [capture page](/troubleshooting/capture/). |
| `2` | Invalid config or command usage. | Read the message, fix the value or flag, and run again. |
| `3` | Environment problem, such as a missing browser, an unreachable URL or dashboard. | Run `doctor` and see [installation](/troubleshooting/installation/) or [capture](/troubleshooting/capture/). |

The [exit codes reference](/reference/exit-codes/) lists the exact rules for every command.

## Share a support report safely

A useful report contains:

- the installed version from `npm ls` and the CLI version label;
- Node, Playwright and browser versions, plus your operating system;
- the exact command, the working folder and the full error text;
- what you expected and what happened instead;
- the smallest route and viewport that shows the problem.

Remove secrets before you share anything. Do not paste environment files, API keys, upload or runner tokens, session cookies, database URLs or `storageState` files. Screenshots, DOM snapshots and fix proposals can contain private page text or source code, so review them first.

## Next steps

- [Check the requirements](/start/requirements/) if `doctor` reports a missing tool.
- [Learn what each result status means](/concepts/results/) before you treat a failure as a bug.
- [Look up every environment variable](/reference/environment/) when a setting seems to be ignored.
