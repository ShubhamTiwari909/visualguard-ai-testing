---
title: "Tune differences and noise"
description: "Learn how VisualGuard compares two screenshots, how much change it allows, how it ignores rendering noise and areas that change on every load, how to quarantine a flaky check, and when to change each diff setting."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-27"
sourcePaths:
  [
    "packages/visualguard/src/config/schema.ts",
    "packages/visualguard/src/diff/compute.ts",
    "packages/visualguard/src/diff/noise.ts",
    "packages/visualguard/src/diff/regions.ts",
    "packages/visualguard/src/diff/shift.ts",
    "packages/visualguard/src/core/run.ts",
    "packages/visualguard/src/core/provenance.ts",
    "packages/visualguard/src/mapping/classify.ts",
    "packages/visualguard/src/core/quarantine.ts",
  ]
sidebar: { "order": 6 }
---

After both screenshots are taken, VisualGuard compares them pixel by pixel. The `diff` settings decide when two pixels count as different, how much difference is allowed before a page needs review, and how changed areas are grouped in the report.

Change these settings only after you have looked at a real false difference in the report. The defaults catch small regressions and ignore most rendering noise.

## Before you start

- Make captures repeatable first. Most false differences come from moving content, not from diff settings. See [Make captures repeatable](/guides/stable-captures/).
- Have a recent run with a difference you want to understand. See [Inspect and share reports](/guides/reports/).
- Have a working config file. See [Configure your project](/guides/configuration/).

## How a comparison works

For each job (one page at one viewport), VisualGuard:

1. Places both screenshots on one canvas, as large as the bigger image. If the sizes differ, the smaller one is padded and the size difference is recorded.
2. Compares every pixel. A pixel differs when its colour changes by more than `threshold`. Anti-aliased edges are ignored by default.
3. Checks the total. If the number of different pixels is within the allowed change, the job passes and nothing else happens.
4. Builds a noise map, if the job did not pass. It loads the reference page a second time and ignores areas that differ between the two loads. Then it checks the total again.
5. Looks for a layout shift. When content was inserted or removed, everything below moves. VisualGuard reports this as one "shift" region instead of many changes.
6. Groups the remaining changed pixels into rectangles called regions. It writes a diff image and crops of each region.
7. Decides the job's status, usually `review` or `regression`, using the regions and the page structure. Small differences that are only rendering noise pass instead (see below). AI can add an explanation. See [Read result statuses](/concepts/results/).

### Rendering noise passes automatically

Some differences are real pixels but nothing a person could see. VisualGuard passes them as rendering noise, with a finding that says so:

- **Tiny changes with no page change.** At most 0.1% of the page differs, in small areas, and the page structure and styles are the same on both sides. This is usually font smoothing or image decoding.
- **Sub-pixel position changes.** Every changed area is explained by elements moving, each by less than one CSS pixel in total, through `transform`, `translate`, `left`/`top`/`right`/`bottom`/`inset`, `margin` or `padding`. A changed area with no page change, or one with many changes, is not covered. Moving text by 0.4px repaints the smoothed edge of every letter, so up to 0.5% of the page may differ, still only in small areas. The finding reads `… from a position change under 1px: treated as rendering noise`.

A change of 1px or more, any other style change, a text change, or a large changed area is never treated as noise.

## 1. Set the allowed change

Two kinds of setting work together. `threshold` decides whether one pixel counts as changed. `maxDiffPixels` and `maxDiffRatio` decide how many changed pixels are allowed in total.

| Option               | What it does                                                                                                                  | Default |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| `threshold`          | Colour tolerance for one pixel, from 0 to 1. `0` means any colour change counts. Higher values ignore smaller colour changes. | `0.1`   |
| `maxDiffPixels`      | The job passes if at most this many pixels differ.                                                                            | `20`    |
| `maxDiffRatio`       | The job also passes if at most this share of all pixels differ, from 0 to 1. `0` turns this rule off.                         | `0`     |
| `ignoreAntialiasing` | Ignores pixels that look like smoothed edges of text and shapes.                                                              | `true`  |

A job passes when **either** rule is met: the count is within `maxDiffPixels`, or the share is within `maxDiffRatio` (when that is above 0).

```ts
diff: {
  threshold: 0.1,
  maxDiffPixels: 20,
  maxDiffRatio: 0,
},
```

:::caution
`threshold` is not "how many pixels may differ". Setting `threshold: 20` is an error, because the value must be between 0 and 1. Use `maxDiffPixels` for a pixel count.
:::

### When to change each one

| Situation                                                                  | What to change                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Tiny colour shifts in gradients or shadows show up as differences          | Raise `threshold` a little, for example to `0.15`.                             |
| You need to catch very subtle colour changes, such as a brand colour tweak | Lower `threshold`, for example to `0.05`.                                      |
| A handful of scattered pixels differ on every run                          | Raise `maxDiffPixels` a little, for example to `50`.                           |
| Very tall pages fail because of a few hundred noisy pixels                 | Set `maxDiffRatio` to a small share, for example `0.0005` (0.05% of the page). |

:::caution
Every allowance can also hide a real change. A one-word text change can be fewer than 100 pixels. Raise these values in small steps, and never raise them just to make a known regression pass. Accept intentional changes instead. See [Accept intentional local changes](/guides/accepting-changes/).
:::

## 2. Use the noise map

Some content changes on every page load: a random testimonial, an ad, a "people viewing now" counter. These changes are not caused by your deployment.

When a job does not pass, the noise map loads the reference side once more. In compare mode that is the production site; in baseline mode it is the current site. VisualGuard then compares the two loads of the same page. Areas that differ between them are grown to the element they sit in, and left out of the comparison.

| Option             | What it does                                                                             | Default |
| ------------------ | ---------------------------------------------------------------------------------------- | ------- |
| `noiseMap`         | Turns the noise map on or off.                                                           | `true`  |
| `noiseMapMaxRatio` | If the changing areas cover more than this share of the page, the noise map is not used. | `0.25`  |

The noise map is skipped in two cases, and the report says why:

- The page height changes between loads.
- More than `noiseMapMaxRatio` of the page changes between loads. A page that unstable needs [stabilizing](/guides/stable-captures/) instead.

When it works, the job shows a finding such as `Ignored 2 areas that change on every load of production (3,412 px)`. In the **Diff** view, the ignored areas are marked.

The noise map costs one extra page load, only for jobs that did not pass.

### When to turn it off

Set `noiseMap: false` when:

- The changing area is what you want to test, such as a rotating hero banner you just redesigned.
- Your pages are already stable, and you want to save the extra page load.

## 3. Quarantine a flaky check

Sometimes one check keeps failing for a reason you already know about, such as a third-party widget that renders differently on every load, while the fix is planned. Instead of loosening tolerances for every page, quarantine that one check for a limited time:

```ts
quarantine: [
  {
    route: "/pricing",
    viewport: "mobile", // optional: leave out to cover every viewport
    owner: "web-team",
    reason: "Carousel timing differs between loads; fix in WEB-482",
    expires: "2026-12-31",
  },
],
```

| Field      | What it does                                                                             |
| ---------- | ---------------------------------------------------------------------------------------- |
| `route`    | The route path, exactly as the check's route.                                            |
| `viewport` | Optional. Limits the entry to one viewport name.                                         |
| `owner`    | Required. Who is fixing the check. Shown with the result.                                |
| `reason`   | Required. Why the check is quarantined.                                                  |
| `expires`  | Required. A date such as `2026-12-31`. The entry applies until the end of that day, UTC. |

A quarantined check still runs and keeps its real status, so you keep seeing what happened:

- It does **not** fail the run or change the exit code, whatever `--fail-on` says. JUnit reports it as skipped.
- The terminal, the report and the pull request comment say it is quarantined, until when and by whom.
- A quarantine covers visual differences only. A check still fails if it has a capture **error** or a **health** problem, such as a broken image, a failed request, or a failing accessibility or performance check.
- After `expires`, the entry stops applying and every run warns: `Quarantine for /pricing (mobile) expired on 2026-12-31; it counts again.` An entry that matches no check in the run also warns, which usually means a typo.

Quarantine applies to `visualguard test`, `monitor`, `merge`, `analyze` and `runVisualGuard`. The `visualguard/playwright` fixture checks pages inside your own tests and does not read it.

:::caution
Quarantine hides failures. Keep the expiry close, fix the cause, then delete the entry. To record a change you intended, [accept it](/guides/accepting-changes/) instead.
:::

## 4. Control how changes are grouped

These settings change how regions look in the report and how many reach the AI. They do not change whether a job passes.

| Option                | What it does                                                                                                       | Default        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------- |
| `detectShift`         | Finds content that moved up or down because something was inserted or removed, and reports it as one shift region. | `true`         |
| `regionCellSize`      | Changed pixels are grouped in square cells of this size, in pixels (4 to 64).                                      | `16`           |
| `regionMergeDistance` | Regions closer than this many pixels are merged into one.                                                          | `32`           |
| `regionPadding`       | Extra pixels around each region when cropping it for the report.                                                   | `24`           |
| `maxRegions`          | The most regions kept per job. The largest are kept.                                                               | `10`           |
| `engine`              | The comparison engine. Only `"pixelmatch"` is available.                                                           | `"pixelmatch"` |

Raise `regionMergeDistance` if one change, such as a new card, shows up as many small regions. Lower it if separate changes are merged into one big box.

Keep `detectShift` on. Without it, a new banner at the top makes every element below it a separate change.

:::note
Diff settings do not change the screenshots. Changing them does not make saved baselines out of date.
:::

## Example: a marketing site with a random hero

A marketing site picks one of three hero images at random. Its landing page is 22,000 pixels tall. Every run marked the page for review, and the report showed:

- the finding `Ignored 1 area that changes on every load of production`, and
- about 300 scattered pixels further down, in a gradient behind the footer.

The noise map already handled the hero. The team set `diff: { maxDiffRatio: 0.0005 }`. That allows about 0.05% of the page, around 15,000 pixels on a 1440-pixel-wide page. To keep a strict check on the hero, they also added a separate route with `?hero=1`, which their site uses to show a fixed image.

## Verify your tuning

Check both directions after each change:

1. **No false alarms.** Compare the site with itself:

   ```bash
   npx visualguard test --production http://localhost:3000 --staging http://localhost:3000 --no-ai
   ```

   You should see every job as `pass`. A page that stays `review` against itself has moving content: [stabilize it](/guides/stable-captures/), mask it, or, while a fix is on the way, quarantine it.

2. **Real changes still show.** Make a small visible change on staging, such as a changed button label. Run the normal test and open the report:

   ```bash
   npx visualguard test --no-ai
   npx visualguard report
   ```

   You should see that page as `review` or `regression`, with a region around the label.

If step 2 passes the page, your allowances are too loose.

## Troubleshooting

| Problem                                                                 | Fix                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `diff.threshold: … Hint: threshold is per-pixel colour tolerance (0–1)` | Use a value between 0 and 1. Use `maxDiffPixels` to allow a number of pixels.                                      |
| An expected change is missing from the report                           | Lower `maxDiffPixels`, set `maxDiffRatio` back to `0`, or check that a mask, hide or noise area does not cover it. |
| `Noise map not applied: the page size changes between loads`            | Content loads late and changes the height. Add a route `waitFor`, or stabilize the late content.                   |
| `Noise map not applied: …% of the page changes between loads`           | The page is not stable. See [Make captures repeatable](/guides/stable-captures/).                                  |
| One change shows as many small regions                                  | Raise `regionMergeDistance`.                                                                                       |
| Everything below a new element is marked as changed                     | Make sure `detectShift` is `true`.                                                                                 |
| `Quarantine for … expired on …; it counts again`                        | Fix the check and delete the entry, or, if the fix is still on the way, agree a new `expires` date with its owner. |
| `Quarantine for … matches no check in this run`                         | Check that `route` and `viewport` match the check exactly, including a leading `/`.                                |
| A quarantined check still fails the run                                 | It has a capture error or a health finding, which quarantine never covers. Open the report to see which.           |
| A page fails with a size difference                                     | The two pages have different heights. Look at the **Side by side** view to see which content is extra.             |

For other capture problems, see [Capture troubleshooting](/troubleshooting/capture/).

## Next steps

- [Inspect and share reports](/guides/reports/): read regions, the diff view and findings.
- [Accept intentional local changes](/guides/accepting-changes/): record a change instead of loosening tolerances or quarantining.
- [Make captures repeatable](/guides/stable-captures/): remove the cause of noise.
- [Configuration reference](/reference/configuration/): every `diff` field and its limits.
