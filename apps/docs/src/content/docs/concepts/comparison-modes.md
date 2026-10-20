---
title: "Choose a comparison mode"
description: "Compare two running sites, saved baselines, quick one-URL scans, a monitored live site or interactive Playwright states."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/PRODUCT-FEATURES.md", "packages/visualguard/src/config/schema.ts", "packages/visualguard/src/cli/commands/zero-config.ts", "packages/visualguard/src/cli/commands/monitor.ts"]
sidebar: {"order": 2}
---

Every comparison needs a **reference**: the appearance you expect. VisualGuard can get that reference in several ways. This page explains each one, when to use it, and how it decides what the "right" picture is.

## Before you start

- Read [how VisualGuard works](/concepts/how-it-works/) for the overall workflow.
- **Reference** means the expected appearance. **Candidate** means the version you are checking. In the config these are `production` and `staging`, but neither has to be a real public deployment.

## The modes at a glance

| Mode | Reference comes from | Start with | Best for |
| --- | --- | --- | --- |
| Two running sites | A second live site, such as production | `visualguard test` (default `mode: "compare"`) | Checking a branch or preview against production |
| Local baselines | Screenshots you saved and reviewed | `visualguard test` with `mode: "baseline"` | Pages with no stable second site |
| Zero-config scan | Your previous scan of the same site, or a second URL | `visualguard https://example.com` | Trying VisualGuard quickly, exploring a site |
| Monitoring | The live site's own previous capture | `visualguard monitor` | Catching CMS edits or broken third-party scripts, such as nightly |
| Playwright fixture | A matching state in a Playwright test, or stored snapshots | `visualguard/playwright` | Pages that need clicks, forms or a login first |
| Approved team baselines | A versioned, reviewed set from the dashboard | `visualguard dashboard baseline pull` | Teams that approve references together |

## Compare two running sites

This is the default. VisualGuard opens the same paths on two sites and compares them. Either site can be deployed or local, such as production against `http://127.0.0.1:3000`.

```ts
baseURL: {
  production: "https://shop.example.com",
  staging: "http://127.0.0.1:3000",
},
routes: ["/", "/checkout"],
```

If a page moved, map the two paths in one route. This compares production's `/pricing` with staging's `/plans`:

```ts
routes: [{ path: "/pricing", staging: "/plans" }],
```

**Example:** check that a checkout redesign changes the button colour as intended, without hiding the payment form.

## Compare against local baselines

Here the reference is a set of screenshots you saved earlier. VisualGuard captures only the candidate (`baseURL.staging`) and compares it with those files.

1. Set `mode: "baseline"` in the config. Screenshots are stored in `baseline.dir` (default `visualguard/baselines`).
2. Review the page, then save the reference on purpose: `visualguard test --update-baselines`.
3. Later runs compare against those files: `visualguard test`.

Each saved screenshot keeps notes on how it was made, such as browser, platform and settings. VisualGuard refuses a missing or incompatible reference instead of quietly using the wrong image. A missing baseline is an error by default (`baseline.missing: "error"`).

Commit the baseline folder so the team shares it. See [create local baselines](/guides/local-baselines/).

**Example:** a component gallery has no public production site, so the team keeps reviewed reference images in its repository.

:::note
Local baselines are different from **approved team baselines** in the dashboard. Local baselines are files you update with a command. Approved baselines are versioned and changed only through review and promotion. See [promote approved baselines](/dashboard/approved-baselines/).
:::

## Start with one URL or two URLs

You can run VisualGuard with no config file at all:

```bash
npx --no-install visualguard https://example.com
npx --no-install visualguard https://example.com https://staging.example.com
```

| You pass | What happens |
| --- | --- |
| One URL, first time | VisualGuard finds pages (up to 25), captures them and saves snapshots. Nothing is compared yet. |
| One URL, again | It compares with the saved snapshots, then **replaces them** with this run's captures. |
| Two URLs | It compares the first site (reference) with the second (candidate). |
| A URL with a path, such as `/pricing` | It tests only that page. |

Snapshots from one-URL scans are saved under `.visualguard/snapshots/` in a folder named after the site. If `GEMINI_API_KEY` is set and there is no config file, the scan uses Gemini automatically.

This mode is for exploring. Each scan updates its own reference, so it is not an approval step. Use explicit routes and baselines when you need controlled coverage. See [zero-config scans](/guides/zero-config-scans/).

## Monitor a live site over time

`visualguard monitor` compares a live site with its own previous capture. It is useful for changes that do not come from your code, such as a CMS edit or a broken third-party script.

- The first run saves the reference in `monitor.dir` (default `.visualguard/monitor`). Keep that folder between runs, for example with a CI cache.
- By default (`monitor.update: "unless-regression"`), a page that regressed keeps its old snapshot, so it is reported again until fixed.
- `visualguard monitor --reset` replaces every stored snapshot with the current capture.
- `visualguard monitor --workflow` writes a scheduled GitHub workflow (default `0 3 * * *`, daily at 03:00 UTC).

See [monitor a site over time](/guides/monitoring/).

## Check an interactive Playwright state

Some states only exist after an action: a login, an open dialog, a filled form. The `visualguard/playwright` fixture checks the page inside your existing Playwright test, at the moment you choose.

```ts
import { test } from "visualguard/playwright";

test("open cart", async ({ page, visualguard }) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "Cart" }).click();
  await visualguard.check(page, {
    name: "cart-open",
    referenceSetup: async (reference) => {
      await reference.getByRole("button", { name: "Cart" }).click();
    },
  });
});
```

`referenceSetup` brings the reference page to the same state. The fixture can also use stored snapshots instead. This runs inside your own Playwright tests; it is not a separate catalogue of named journeys. See [use inside Playwright tests](/guides/playwright/).

**Example:** compare the expanded shopping cart after adding an item, not only the first view of `/shop`.

## Choose the first reference deliberately

The reference decides what "correct" means, so pick it on purpose:

- A one-URL scan saves snapshots on its first run and updates them on every later run. Do not treat that as approval.
- Baseline mode changes its reference only when you pass `--update-baselines`.
- Monitoring updates its reference after each run, except for regressed pages by default.
- Approved team baselines change only through review and promotion in the dashboard.

When you need controlled reference updates, [create reviewed local baselines](/guides/local-baselines/) or use [approved baselines](/dashboard/approved-baselines/).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Baseline mode fails with a missing baseline | Save one first with `visualguard test --update-baselines`, after checking the page looks right. |
| Baseline mode says the reference is incompatible | The browser, platform or settings changed. Regenerate the baselines on the same setup as your test runs. |
| A one-URL scan never reports changes | The first scan only saves snapshots. Run it again after the site changes. |
| A moved page shows as missing | Map the paths: `{ path: "/pricing", staging: "/plans" }`. |
| Monitoring forgets its reference in CI | Persist `.visualguard/monitor` between runs, such as with a CI cache. |

More help: [capture and report problems](/troubleshooting/capture/).

## Next steps

- [Read result statuses](/concepts/results/): understand what each comparison reports.
- [Select routes](/guides/routes/): choose and discover the pages to test.
- [Create local baselines](/guides/local-baselines/): set up baseline mode step by step.
