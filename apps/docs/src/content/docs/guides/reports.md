---
title: "Inspect and share reports"
description: "Open the HTML report for a run, read job statuses, switch between image views, use search, filters and keyboard shortcuts, and share or clean up saved runs."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/cli/commands/report.ts", "packages/visualguard/src/core/runs.ts", "packages/visualguard/src/core/status.ts", "packages/visualguard/src/reporters/html.ts", "packages/visualguard/src/server/report-server.ts", "packages/visualguard/report-app/src/App.tsx", "packages/visualguard/report-app/src/Compare.tsx", "packages/visualguard/report-app/src/JobDetail.tsx", "packages/visualguard/report-app/src/actions.tsx", "packages/visualguard/report-app/src/data.ts"]
sidebar: {"order": 7}
---

Every test run saves its screenshots, a results file and an HTML report in a run folder. This page shows what is in that folder, how to open the report, how to read each view, and how to share a run with someone else.

Use the report after every run that is not all `pass`. It shows exactly what changed, where, and why VisualGuard thinks it matters.

## Before you start

- Finish at least one run, for example with `npx visualguard test`. See the [quickstart](/start/quickstart/).
- Run commands from the same folder you ran the test from. The report command finds runs through the same config and output folder.

## 1. Find the run folder

Runs are saved under `output.dir`, which is `.visualguard` by default:

```text
.visualguard/
  runs/
    index.json                         list of saved runs
    0007_2026-10-20T09-15-02Z/         one run
      manifest.json                    every result, in JSON
      index.html                       the HTML report
      jobs/
        pricing__desktop/              one page at one viewport
          production.png
          production.dom.json          page structure, used to explain changes
          staging.png
          staging.dom.json
          diff.png                     only when the job did not pass
          regions/
            0.production.png           crops of each changed region
            0.staging.png
            0.diff.png
  cache/ai/                            saved AI answers, reused for identical changes
```

- The run folder name is a 4-digit run number and the start time in UTC. In GitHub Actions and GitLab CI, the run number comes from the CI pipeline number.
- The job folder name is the route and the viewport, joined by `__`. The home page `/` becomes `index`, and `/blog/hello` becomes `blog_hello`.
- With `--debug`, each job also has `trace.production.zip` and `trace.staging.zip`. Open them with `npx playwright show-trace`.
- In baseline and scan runs, `production.png` is a copy of the saved screenshot.

The [artifacts reference](/reference/artifacts/) describes these files in more detail.

## 2. Open the report

```bash
npx visualguard report
```

You should see:

```text
  VisualGuard report · run #7

  Local   http://127.0.0.1:53412
  File    .visualguard/runs/0007_2026-10-20T09-15-02Z/index.html

  Press Ctrl+C to stop.
```

Your browser opens the **Local** address. The report is served only on your own machine (`127.0.0.1`). Keep the command running while you use the report, and press Ctrl+C when you are done.

| Flag | What it does | Default |
| --- | --- | --- |
| `-c, --config <path>` | Uses this config file to find the output folder. | discovered config |
| `--run <id>` | Opens another run. Pass the folder name, the start of it, or the run number such as `7` or `#7`. | the latest run |
| `--port <n>` | Serves on this port. | a random free port |
| `--no-open` | Does not open a browser. In CI, the browser never opens. | opens |
| `--no-serve` | Writes `index.html`, prints its `file://` address, and exits. | serves |

```bash
npx visualguard report --run 5
npx visualguard report --no-serve
```

:::note
`report` has no `--output-dir` flag. If you ran the test with `--output-dir`, set `VISUALGUARD_OUTPUT_DIR` to the same folder, or set `output.dir` in the config.
:::

## 3. Read the statuses

Each job gets one status:

| Status | Meaning |
| --- | --- |
| `pass` | Within the allowed change, or the difference was judged to be noise with no other problem. |
| `accepted` | Matches a change someone accepted as intentional. |
| `review` | A difference or a check result needs a person to look at it. |
| `regression` | A clear problem, such as a broken page, or a change classified as a regression. |
| `error` | The page could not be captured or compared. |

The terminal prints a summary like `12 passed · 2 review · 1 regression · 0 errors`, followed by the run folder.

The `--fail-on` flag of `test` decides which statuses make the command fail with a non-zero exit code:

| `--fail-on` | Fails on |
| --- | --- |
| `regression` (default) | `regression`, `error` |
| `review` | `review`, `regression`, `error` |
| `any` | the same as `review` |

A merged run with missing shards always fails. See [Read result statuses](/concepts/results/) for how statuses are decided.

## 4. Find the job you need

The top of the report shows the run number, the site addresses, the start time and duration, and the AI provider. If AI was used, it also shows how many analyses and tokens the run used.

Below that are status buttons, one per status, with a count. Click one to show only those jobs. Click several to combine them. Click again to remove a filter.

The list on the left shows every job, sorted with errors first, then regressions, reviews, accepted and passed jobs. Each line shows the route, the viewport and a short summary, such as `2.4% changed · 3 regions` or `Identical`. Type in **Search routes** to filter by route, viewport or name.

## 5. Compare the screenshots

Select a job to see its details. The two sides are labelled by mode:

| Run type | Left side | Right side |
| --- | --- | --- |
| Compare | Production | Staging |
| Baseline or scan | Baseline | Current |
| Monitor | Previous | Current |

Pick a view with the **Comparison mode** buttons or a number key:

| View | Key | What it shows | Use it to |
| --- | --- | --- | --- |
| Side by side | `1` | Both screenshots next to each other. | See the overall layout and size differences. |
| Slider | `2` | One image over the other, with a handle you drag left and right. | Spot small moves and colour changes at one place. |
| Onion skin | `3` | One image over the other, with an opacity slider. | Check alignment and spacing. |
| Diff | `4` | The diff image, with changed pixels highlighted. Not available when the job passed. | Find every changed pixel at a glance. |

Two checkboxes change the display:

- **Regions** (`r`) draws boxes around each changed region.
- **Actual size** (`z`) shows the screenshot at its real pixel size instead of fitting the window.

Below the screenshots, you can find:

- **Findings**: the reasons for the status, such as `Broken image` or `Ignored 2 areas that change on every load`.
- **AI analysis**, when AI ran: a title and summary, **Likely cause**, **Affected** and **Suggested fix**.
- **Changed regions**: crops of each region from both sides and the diff, with the elements and style properties that changed. Click a region to highlight it in the screenshots.
- **Page health**: for each side, the HTTP status, capture time and attempts, console errors, failed requests and broken images. With performance and accessibility checks on, it also shows load times, page weight and failing accessibility rules.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `j` or `↓` | Next job |
| `k` or `↑` | Previous job |
| `1` to `4` | Side by side, Slider, Onion skin, Diff |
| `r` | Show or hide regions |
| `z` | Actual size on or off |
| `/` | Jump to the search box |
| `Esc` | Leave the search box |

The address bar updates as you move, for example `#/jobs/pricing__desktop?view=diff`. Copy it to link someone to one job and view. The **Dark theme** and **Light theme** button is remembered in your browser.

## 6. Act on a job

A job with status `review` or `regression` and both screenshots has actions:

| Action | When you see it | What it does |
| --- | --- | --- |
| **Accept change** | The report is opened with `npx visualguard report`. | Records the change in `visualguard.accepted.json` and marks the job `accepted`. See [Accept intentional local changes](/guides/accepting-changes/). |
| **Generate fix** | Same, and `fix.enabled` is `true`. | Proposes a code change, shows the diff, and applies it only after you confirm. See [Fixes](/guides/fixes/). |
| **Copy accept command** | The report is opened as a file. | Copies the matching `npx visualguard accept` command to run in a terminal. |

## 7. Share a run

`index.html` contains the report app and the results, but the screenshots are separate files next to it. **Share the whole run folder**, not just `index.html`.

```bash
cd .visualguard/runs
zip -r run-0007.zip 0007_2026-10-20T09-15-02Z
```

The person who receives it unzips the folder and opens `index.html` in a browser. It works without VisualGuard installed, but the action buttons only show **Copy accept command**.

Examples use macOS or Linux shells; on Windows use WSL, or compress the folder in File Explorer.

:::caution
A run folder contains screenshots and page text from both sites. If the sites show private data, treat the folder as private.
:::

In CI, upload the run folder as a build artifact. Set `report.publicURL` to where you publish reports, so pull request comments link to them. See [GitHub Actions](/ci/github-actions/). To keep runs in a shared place with review history, see the [dashboard](/dashboard/overview/).

## 8. Control how many runs are kept

| Setting | What it does | Default |
| --- | --- | --- |
| `output.dir` | Where runs are saved. | `.visualguard` |
| `output.keepRuns` | After each run, the oldest runs beyond this number are deleted. | `10` |
| `report.html` | Writes `index.html` into each run folder. `npx visualguard report` writes it anyway when you open a run. | `true` |

`init` adds `.visualguard/` to `.gitignore`. Keep it there: runs are local evidence, not source code.

## Example: reviewing a pull request run

Sam's test run ends with `14 passed · 1 review · 0 regressions`. Sam runs `npx visualguard report`, clicks the **review** status button, and opens `/pricing · mobile`. The **Diff** view shows one region around the plan cards. **Changed regions** lists a `margin-top` change on `.plan-card`, which Sam made on purpose. Sam clicks **Accept change**, and the job turns `accepted`.

## Verify the report

- The run number in the report header matches the one in your terminal.
- The job you expect is in the list, with the right route and viewport.
- All four views show images for a changed job. The **Diff** view is greyed out only for passing jobs.
- After sharing, open the copied folder from another location and check that screenshots load.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No runs found in .visualguard` | Run a test first, or run `report` from the same folder. If you used `--output-dir`, set `VISUALGUARD_OUTPUT_DIR`. |
| `Run "…" not found` or `is ambiguous` | Pass a longer part of the run folder name, or the run number. |
| Screenshots are broken in a shared report | Only `index.html` was shared. Share the whole run folder. |
| No **Accept change** button | The report was opened as a file, or the job is `pass`, `accepted` or `error`. Use `npx visualguard report`, or the copied command. |
| A run you need was deleted | It was older than `output.keepRuns`. Raise the number, or copy runs you want to keep. |
| `The report app is missing from this install of VisualGuard.` | Reinstall the package. See [Installation troubleshooting](/troubleshooting/installation/). |
| The browser does not open | It never opens in CI. Use `--no-open` and open the printed **Local** address yourself. |

For more, see [Capture and reports troubleshooting](/troubleshooting/capture/).

## Next steps

- [Accept intentional local changes](/guides/accepting-changes/): record expected changes so they pass next time.
- [Tune differences and noise](/guides/diff-and-noise/): understand regions and the diff image.
- [Reporters](/guides/reporters/): add JUnit, GitHub summaries and webhooks.
- [Artifacts reference](/reference/artifacts/): every file in a run folder.
