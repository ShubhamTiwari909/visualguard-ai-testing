---
title: "Accept intentional local changes"
description: "Mark a visual change as intentional from the report or the accept command, so the same change passes in later runs while new changes and page health problems still show."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/cli/commands/accept.ts", "packages/visualguard/src/core/accepted.ts", "packages/visualguard/src/cli/commands/report.ts", "packages/visualguard/report-app/src/actions.tsx", "packages/visualguard/src/config/schema.ts", "packages/visualguard/src/core/run.ts"]
sidebar: {"order": 8}
---

When you change a page on purpose, VisualGuard still reports the difference. Accepting the change records that it is intentional. Later runs that show the same change mark the page `accepted` instead of `review` or `regression`, so it no longer fails the run.

Accept a change after you have looked at it in the report and agree it is correct. Acceptance is local: it is stored in a file you commit with your code.

## Before you start

- Have a finished run with at least one job in `review` or `regression`. See [Inspect and share reports](/guides/reports/).
- Look at the change in the report first. Acceptance says "this exact change is fine", so be sure it is.
- Run commands from your application's root folder, where the config file and `visualguard.accepted.json` live.

## 1. Check that the change can be accepted

A job can be accepted only when:

- its status is `review` or `regression`, and
- it has both screenshots.

Jobs with `pass`, `accepted` or `error` cannot be accepted. An `error` job has nothing to compare, so fix the capture problem first.

## 2. Accept from the report

Open the run with the report command:

```bash
npx visualguard report
```

Select the job, check the views, then click **Accept change**. You should see the button change to **Accepting…**, then the report reloads and the job shows as `accepted`.

The button only appears when the report is opened with `npx visualguard report`. If you opened `index.html` as a file, you see **Copy accept command** instead. It copies a command like this one, for you to run in a terminal:

```bash
npx visualguard accept /pricing --viewport mobile
```

## 3. Accept from the command line

The `accept` command works on the latest run by default:

```bash
# One page, every viewport
npx visualguard accept /pricing --note "New pricing layout, approved by design"

# Several pages with a pattern, mobile only
npx visualguard accept "/blog/**" --viewport mobile

# Every job marked review in run 7
npx visualguard accept --all --run 7
```

You should see each accepted job and a summary:

```text
  ✓  /pricing  desktop
  ✓  /pricing  mobile

  Accepted 2 changes in visualguard.accepted.json. Commit this file; matching screenshots will pass from now on.
```

| Argument or flag | What it does | Default |
| --- | --- | --- |
| `[routes...]` | Routes or patterns to accept, such as `/pricing` or `'/blog/**'`. They match the route names shown in the report. | none |
| `--all` | Accepts every job marked `review` in the run. It never accepts `regression` jobs. | off |
| `--viewport <name>` | Accepts only this viewport. Repeatable. | every viewport |
| `--run <id>` | Uses another run: its folder name, the start of it, or the run number. | the latest run |
| `--note <text>` | Saves a reason with the acceptance. It is shown in the report. | none |
| `-c, --config <path>` | Uses another config file. | discovered config |

You must name routes or pass `--all`. To accept a `regression`, name its route explicitly. This keeps a bulk accept from hiding a regression by accident.

The command also updates the saved run: its `manifest.json` and report now show the job as `accepted`.

Quote patterns that contain `*`, so your shell does not expand them. Examples use macOS or Linux shells; on Windows use WSL.

## 4. Commit the accepted file

Acceptances are saved in `visualguard.accepted.json` in the root folder. Commit it, so your team and CI use the same acceptances.

```json
{
  "version": 1,
  "accepted": [
    {
      "job": "pricing__mobile",
      "route": "/pricing",
      "viewport": "mobile",
      "hash": "3f9c…",
      "change": {
        "size": { "width": 390, "height": 2412 },
        "regions": [{ "box": { "x": 16, "y": 640, "width": 358, "height": 220 }, "diffPixels": 18734 }],
        "deltas": ["style .plan-card margin-top: 24px → 32px"]
      },
      "acceptedAt": "2026-10-20T09:31:12.000Z",
      "note": "New pricing layout, approved by design",
      "run": "0007_2026-10-20T09-15-02Z"
    }
  ]
}
```

Each entry stores:

- `job`, `route` and `viewport`: which page the acceptance is for.
- `hash`: a fingerprint of both screenshots.
- `change`: the shape of the change: page size, any layout shift, the changed regions and the page-structure changes.
- `acceptedAt`, `note` and `run`: when, why and from which run.

Accepting the same job again replaces its older entry.

To store the file somewhere else, set `output.acceptedFile`. The path is relative to the folder you run commands from.

```ts
output: { acceptedFile: "visual-tests/accepted.json" },
```

## 5. Choose how strictly later runs match

On each run, VisualGuard checks every `review` or `regression` job against the entries for the same job. The `output.acceptMatch` setting decides what counts as the same change:

| Value | A later job is accepted when | Use it when |
| --- | --- | --- |
| `"similar"` (default) | Both screenshots are identical to the accepted ones, **or** the change has the same shape: the same width, nearly the same height, the same layout shift, exactly the same page-structure changes, and the same number of regions in the same places with a similar number of changed pixels. | Most projects. Small rendering noise, such as anti-aliasing, does not undo an acceptance. |
| `"exact"` | Both screenshots are byte-for-byte identical to the accepted ones. | Rendering is fully repeatable and you want the strictest rule. |

```ts
output: { acceptMatch: "exact" },
```

Anything else is flagged again: a different change, an extra region, or a region that moved. An accepted job shows a line such as `Accepted 20/10/2026, 09:31:12 (same change, re-rendered): New pricing layout`. The `(same change, re-rendered)` part means it matched by shape, not by identical screenshots.

:::caution
Acceptance covers visual changes only. It is never applied to a job that has a page health or check problem at `review` or `regression` level, such as an HTTP error, a broken image, horizontal overflow, or a new accessibility or performance finding. Those still need to be fixed.
:::

## When acceptance stops mattering

In compare mode, the production side does not have your change yet, so the acceptance keeps the job passing. After you deploy the change to production, both sides match and the job passes on its own. You can then delete the old entry from the file.

In baseline mode, you can also update the saved screenshots instead. See [Create local baselines](/guides/local-baselines/).

Acceptance is local to your repository. It does not approve a run in the dashboard. Dashboard reviews are separate; see [Reviews](/dashboard/reviews/).

## Example: a deliberate spacing change

Priya increases the space above the pricing cards. The next run marks `/pricing` as `review` on desktop and mobile. She opens the report, sees one region around the cards, and checks **Changed regions**: it lists only the `margin-top` change. She runs:

```bash
npx visualguard accept /pricing --note "More space above plan cards (PR 412)"
git add visualguard.accepted.json
git commit -m "Accept pricing spacing change"
```

CI runs the same comparison and marks both jobs `accepted`. A week later, a teammate accidentally changes the card colour. That run shows `/pricing` as `review` again, because the change no longer matches.

## Verify the acceptance

1. Run the test again without changing anything:

   ```bash
   npx visualguard test --no-ai
   ```

   You should see the accepted jobs counted as `accepted` in the summary, for example `12 passed · 2 accepted · 0 review · 0 regressions · 0 errors`.

2. Open `visualguard.accepted.json` and check that it has one entry per accepted job, with your note.

3. Optional: make another small change on the same page. Run again. You should see the page back in `review`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Name the routes to accept, or pass --all to accept every change marked review.` | Add a route or pattern, or `--all`. |
| `Nothing to accept in run #…` | No job in that run matches, or the matches are `pass`, `accepted` or `error`. Check the route name in the report, and use `--run` if you meant another run. |
| `--all` skipped a job | `--all` takes only `review` jobs. Name `regression` jobs explicitly. |
| An accepted page is flagged again | The change is different, the screenshots moved, or there is a new health problem. Open the report to compare. Accept again if the new change is also intended. |
| Accepted pages fail in CI but pass locally | Commit `visualguard.accepted.json`, and check that CI uses the same `output.acceptedFile`. With `acceptMatch: "exact"`, small rendering differences between machines break the match; use `"similar"`. |
| `Could not read visualguard.accepted.json` | The file is not valid JSON, often after a merge conflict. Fix the JSON, or delete the broken entries and accept again. |

For more, see [Capture and reports troubleshooting](/troubleshooting/capture/).

## Next steps

- [Create local baselines](/guides/local-baselines/): compare one site with saved screenshots.
- [Inspect and share reports](/guides/reports/): review changes before you accept them.
- [Tune differences and noise](/guides/diff-and-noise/): reduce false differences instead of accepting them.
- [CLI reference](/reference/cli/): every `accept` option.
