---
title: "Read result statuses"
description: "Understand pass, accepted, review, regression and error, what fails a run, and where each run's evidence is saved."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "README.md",
    "packages/visualguard/src/core/status.ts",
    "packages/visualguard/src/core/types.ts",
    "packages/visualguard/report-app/src/App.tsx",
    "packages/visualguard/report-app/src/Compare.tsx",
  ]
sidebar: { "order": 3 }
---

After each run, every comparison gets a status. The status tells you whether something changed and whether a person needs to look. This page explains each status, which statuses fail your build, and where the evidence is saved.

## Before you start

- You need a finished run to follow along. [Run your first visual test](/start/quickstart/) creates one.
- A **job** is one page at one screen size (or one checkpoint in a Playwright test). Each job gets its own status. See the [glossary](/concepts/glossary/).

## The five statuses

| Status       | What it means                                                                                                                                   | What to do                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pass`       | No meaningful change. Differences are within tolerance, or were judged to be noise, and no independent check found a problem.                   | Nothing.                                               |
| `accepted`   | The change matches one a person already marked as intentional.                                                                                  | Nothing, unless the change was accepted by mistake.    |
| `review`     | Something changed, or an independent check found something, and a person should decide.                                                         | Open the report and decide: fix it or accept it.       |
| `regression` | A clear failure. Either the built-in analysis found one (such as a removed control or new overlap) or AI classified the change as a regression. | Fix the page, or investigate why it changed.           |
| `error`      | The capture or processing failed, so there is no valid result.                                                                                  | Read the error. Often a URL, login or browser problem. |

`review` is the most common status for a real visual change. VisualGuard does not guess whether you meant to change something. It shows you the evidence and asks.

## Which statuses fail a run

The `--fail-on` option decides which statuses make the command exit with code `1`:

| `--fail-on`            | Fails on                                | Typical use                                         |
| ---------------------- | --------------------------------------- | --------------------------------------------------- |
| `regression` (default) | `regression`, `error`                   | Local runs and most CI setups                       |
| `review`               | `review`, `regression`, `error`         | Strict CI where every change needs acceptance first |
| `any`                  | Currently the same statuses as `review` | Same as `review`                                    |

Two rules always apply:

- `error` always fails.
- A merged run that is missing shards or jobs is **incomplete** and always fails.

The exit codes are `0` (meets your policy), `1` (failing status or incomplete), `2` (config or command mistake) and `3` (environment problem). See [exit codes](/reference/exit-codes/).

```bash
npx --no-install visualguard test --fail-on review
```

## Where the evidence is saved

Every run writes a folder: `.visualguard/runs/RUN_ID/`. It contains:

| File                         | What it holds                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `manifest.json`              | The full record: settings, every job's status and findings, and links to every file |
| Screenshots                  | The reference and candidate captures that were available                            |
| DOM snapshots                | The page structure used to explain changes                                          |
| Diff images and region crops | The changed areas, highlighted                                                      |
| `index.html`                 | The HTML report                                                                     |

VisualGuard keeps the last 10 runs by default and deletes older ones. Change this with `output.keepRuns`. Add `.visualguard/` to `.gitignore`; `init` does this for you. See [run artifacts](/reference/artifacts/).

:::caution[Share the whole run folder]
`index.html` contains the report's code but links to the screenshot files beside it. Copy or upload the **entire** run folder, not just `index.html`.
:::

## Open the report

```bash
npx --no-install visualguard report
npx --no-install visualguard report --run RUN_ID
npx --no-install visualguard report --no-serve
```

The first command serves the latest run's report on a local port and opens your browser. `--run` picks an older run by its ID, an ID prefix or its run number. `--no-serve` only writes the HTML file and prints its location.

A report opened straight from disk works for reading. The **Accept change** and fix buttons need the served report from `visualguard report`, because they call a local server.

### Using the report

The report has search, status filters, light and dark themes, and links to each job. Each job offers four comparison views: **Side by side**, **Slider**, **Onion skin** and **Diff**.

| Key               | Action                                 |
| ----------------- | -------------------------------------- |
| `j` or Down arrow | Next job                               |
| `k` or Up arrow   | Previous job                           |
| `1` to `4`        | Side by side, Slider, Onion skin, Diff |
| `r`               | Show or hide changed regions           |
| `z`               | Toggle actual size                     |
| `/`               | Focus search                           |

See [inspect and share reports](/guides/reports/).

## Example: reading a pull request run

A run on a pull request has three jobs. `/` desktop is `pass`. `/pricing` desktop is `review`: the price text changed, which was the point of the pull request. `/checkout` mobile is `regression`: the **Pay** button now overlaps the footer. With the default `--fail-on regression`, the run exits with `1` because of the checkout job. The developer fixes the overlap, then runs `visualguard accept /pricing --note "New prices"` so the intended text change stops showing as `review`.

## Completion is not approval

Three things are easy to mix up:

- **A finished run** only means the capture completed. Its evidence can still contain regressions.
- **The engine's status** (`pass`, `review` and so on) is the original verdict and is never rewritten.
- **A dashboard review** records a person's decision about that exact evidence. It sits beside the original status rather than replacing it.

Independent findings, such as health, accessibility or performance problems, cannot be waived by accepting a matching screenshot. See [review exact visual evidence](/dashboard/reviews/).

## Troubleshooting

| Problem                                           | Fix                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every job is `review` because of tiny differences | Make captures stable first, then tune thresholds. See [stable captures](/guides/stable-captures/) and [diff and noise](/guides/diff-and-noise/). |
| A job is `error`                                  | Open the report or terminal output for the message. Run `visualguard doctor`.                                                                    |
| The run passes but you wanted reviews to fail CI  | Use `--fail-on review`.                                                                                                                          |
| The report opens but images are missing           | The folder was copied without its image files. Share the whole run folder.                                                                       |
| **Accept change** does nothing                    | Open the report with `visualguard report`, not from disk.                                                                                        |
| An older run has disappeared                      | Only the last `output.keepRuns` runs (default 10) are kept. Raise the number.                                                                    |

More help: [capture and report problems](/troubleshooting/capture/).

## Next steps

- [Inspect and share reports](/guides/reports/): get the most out of the HTML report.
- [Accept intentional changes](/guides/accepting-changes/): stop a known change from showing again.
- [Exit codes](/reference/exit-codes/): use results in scripts and CI.
