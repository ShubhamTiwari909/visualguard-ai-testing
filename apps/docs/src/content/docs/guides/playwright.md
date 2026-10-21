---
title: "Use inside Playwright tests"
description: "Add VisualGuard checkpoints to Playwright tests, compare interactive states with production or stored baselines, and read the attached evidence."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/playwright/index.ts",
    "packages/visualguard/src/core/provenance.ts",
    "packages/visualguard/package.json",
  ]
sidebar: { "order": 8 }
---

This page shows how to call VisualGuard from inside your own [Playwright Test](https://playwright.dev/docs/intro) files. The CLI captures pages straight after they load. The Playwright fixture lets you click, type and open menus first, then check the page in exactly that state. Use it for states a URL alone cannot reach, such as an open cart, a filled form or a modal.

Each check compares the test's page with the same page on production, or with a stored baseline image when there is no production URL. It uses the same comparison, findings, accepted changes and optional AI as the CLI, and attaches the evidence to the Playwright report.

## Before you start

- Install VisualGuard and Chromium as in [Install VisualGuard](/start/install/).
- Have a running candidate version of your app for the tests to open, and either a production URL or a plan to store baselines.
- Your test files must be ES modules or TypeScript. `visualguard/playwright` is published as an ES module only.
- Run commands from your app's root folder.

## 1. Install Playwright Test

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

VisualGuard supports `@playwright/test` 1.45 or newer. If your project already uses Playwright, keep its version and config.

You should see `npx playwright --version` print a version of 1.45 or higher.

## 2. Point Playwright at the version you are testing

The test's own page is the **candidate**. Set Playwright's `baseURL` to it, for example a local dev server or a staging URL. Create `playwright.config.ts` if you do not have one:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:4101",
    viewport: { width: 1280, height: 800 },
  },
});
```

VisualGuard reads the reference from `visualguard.config.ts`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "http://127.0.0.1:4100", // the reference
    staging: "http://127.0.0.1:4101", // optional: helps map paths when they have a prefix
  },
});
```

If you leave out `baseURL.production`, VisualGuard compares against stored baselines instead (see [step 5](#5-use-stored-baselines-instead-of-production)).

## 3. Write your first check

Import `test` from `visualguard/playwright` instead of `@playwright/test`. It is Playwright's normal `test`, with an extra `visualguard` fixture. `expect` is exported too.

Create `tests/visual.spec.ts`:

```ts
import { test, expect } from "visualguard/playwright";

test("storefront home", async ({ page, visualguard }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Storefront" })).toBeVisible();

  const result = await visualguard.check(page, { name: "home" });
  expect(result.status).not.toBe("error");
});
```

Run it:

```bash
npx playwright test tests/visual.spec.ts
```

You should see the test pass when the pages match. When they differ enough to fail, the test fails with a message such as:

```text
VisualGuard: "home" on / is a regression (3.41% of pixels changed)
  - main > button “Continue to checkout” is missing on staging
```

`check` returns the full result for that checkpoint (status, findings, regions and analysis), so you can make your own assertions on it.

## 4. Check an interactive state

To compare a state that needs clicks, do the clicks in your test, then do the same clicks on the reference with `referenceSetup`:

```ts
import { test } from "visualguard/playwright";

test.use({
  visualguardOptions: { collectHealth: true, failOn: "review" },
});

test("cart opened", async ({ page, visualguard }) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "Cart" }).click();

  await visualguard.check(page, {
    name: "cart-open",
    waitFor: "[data-testid=cart]",
    mask: ["[data-testid=order-id]"],
    referenceSetup: async (reference) => {
      await reference.getByRole("button", { name: "Cart" }).click();
    },
  });
});
```

How it works:

1. VisualGuard takes the screenshot of your test's page as it is now. It applies the usual stabilization (hide banners, disable animations, wait for fonts, images and a quiet network), then runs `hooks.beforeCapture` from your config.
2. It opens the same path on production in a separate, fresh browser context, with the same browser, viewport, locale, timezone and colour scheme as your test project. It applies `environments.production` settings and your `beforeNavigate` hook, loads the page, and then calls `referenceSetup` with that page.
3. It compares the two screenshots and their DOM snapshots, exactly like the CLI.

You should see both sides in the same state in the attached screenshots. Adapt the selectors above to your own app.

### check() options

| Option           | What it does                                                                                                                   | Default                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `name`           | Name of this checkpoint. Must be unique within the test. Used in attachments and baseline names.                               | `"page"`                       |
| `referenceSetup` | Async function that receives the fresh reference `Page` and brings it to the same state.                                       | none                           |
| `waitFor`        | Selector that must be visible on both sides before the screenshot.                                                             | none                           |
| `selector`       | Capture one section matching this CSS selector. `null` restores page capture. See [section capture](/guides/section-capture/). | inherits `screenshot.selector` |
| `mask`           | Selectors to cover with a solid box. Masked areas keep their size.                                                             | `[]`                           |
| `hide`           | Selectors to hide.                                                                                                             | `[]`                           |
| `failOn`         | What fails the test: `"regression"`, `"review"` or `"any"`. Overrides `visualguardOptions.failOn`.                             | `"regression"`                 |

### visualguardOptions

Set these with `test.use({ visualguardOptions: { ... } })`, at file level or inside a `describe` block.

| Option          | What it does                                                                                                                                         | Default                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `configPath`    | Path to the VisualGuard config file.                                                                                                                 | `visualguard.config.*` in the working folder |
| `config`        | Inline config merged over the file. Top-level keys replace the file's keys, so `config: { ai: { provider: "none" } }` replaces the whole `ai` block. | none                                         |
| `failOn`        | Default `failOn` for every check in scope.                                                                                                           | `"regression"`                               |
| `collectHealth` | Record console errors and failed requests on the test's page from the start of the test.                                                             | `false`                                      |

## 5. Use stored baselines instead of production

If `baseURL.production` is not set, each check compares with a stored image in `<baseline.dir>/playwright/` (by default `visualguard/baselines/playwright/`). Each image has a `.meta.json` file that records the browser, viewport and other rendering settings, plus `.dom.json` and `.health.json` sidecars.

Create or update the baselines on purpose with Playwright's own flag:

```bash
npx playwright test --update-snapshots
```

You should see each check pass with an annotation like `Updated baseline visualguard/baselines/playwright/….png`. Commit the baseline folder. Later runs compare against it.

Setting `VISUALGUARD_UPDATE_BASELINES=1` has the same effect.

Rules for baselines:

- **Missing baseline.** By default the check throws `Missing baseline …; update snapshots explicitly or set baseline.missing: "create".` With `baseline.missing: "create"`, the first run saves it and passes.
- **Different settings.** A baseline saved with another browser, viewport, theme or platform is not reused. The check throws `Baseline rendering settings do not match`. Baselines are named per test, checkpoint name, Playwright project, browser and viewport, so each project gets its own.
- **Approved baselines.** Baselines pulled from the dashboard cannot be updated locally. See [Approved baselines](/dashboard/approved-baselines/).

When a check saves or updates a baseline, it does not compare anything for that run.

## What is attached to the report

After each comparison, the test gets these attachments:

| Attachment                       | Content                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `visualguard <name>: result`     | `result.json`: status, findings, regions, analysis and AI usage. |
| `visualguard <name>: production` | The reference screenshot (production or baseline).               |
| `visualguard <name>: staging`    | The test page's screenshot.                                      |
| `visualguard <name>: diff`       | The diff image, when pixels differ.                              |

Open them with `npx playwright show-report`. All files also stay in the test's output folder under `test-results/…/visualguard/<name>/`.

## How the fixture differs from the CLI

| Capability                                     | CLI                               | Fixture                                                                                |
| ---------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| Comparison, DOM mapping and findings           | Shared                            | Shared                                                                                 |
| AI analysis, cache and budgets                 | One session per run               | One session per test; the cache is shared                                              |
| Accepted changes (`visualguard.accepted.json`) | Applied                           | Applied                                                                                |
| Accessibility and performance checks           | Run during capture                | Run at `check()` time if enabled in config                                             |
| Console errors and failed requests             | Recorded from page load           | Only with `collectHealth: true`; events before the fixture started cannot be recovered |
| Page clock                                     | Paused before the screenshot      | Left to your test                                                                      |
| Noise map (second load)                        | Yes                               | Only when comparing with live production                                               |
| Interactive state                              | Hooks only                        | `referenceSetup` per check, plus hooks                                                 |
| Missing baseline                               | Error by default                  | Error by default; `--update-snapshots` or `missing: "create"`                          |
| Output                                         | Run folder, manifest, HTML report | Playwright attachments and `result.json`                                               |

Fixture checks do not create a run in `.visualguard/runs`, so `visualguard report`, `accept` and `fix` do not see them.

## Example: a checkout summary across two projects

Your Playwright config has `desktop` and `mobile` projects. A test fills in the shipping form, then calls `visualguard.check(page, { name: "summary", referenceSetup })`, where `referenceSetup` fills the same form on production. Each project runs the check at its own viewport, and VisualGuard names the comparisons separately. When the mobile layout clips the total, that project fails with `VisualGuard: "summary" on /checkout is a regression`, and the attachments show the clipped total next to production.

## Verify the setup

1. Run one test and open `npx playwright show-report`.
2. Find the four `visualguard <name>: …` attachments. The `production` and `staging` images should show the same interactive state.
3. Open `result.json` and check `status` and `findings`.
4. Make a small visible change on the candidate only and run again. The test should fail, or the status should change, according to `failOn`.

## Troubleshooting

| Problem                                          | Fix                                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `Missing baseline …`                             | Run `npx playwright test --update-snapshots`, or set `baseline.missing: "create"`, or set `baseURL.production`.   |
| `Baseline rendering settings do not match`       | Run with the same browser, viewport and theme as when it was saved, or update the baselines.                      |
| `Approved snapshots cannot be updated locally`   | Pull a newer approved set instead, or use a separate baseline folder.                                             |
| Reference shows the wrong page                   | The reference uses the test page's path on `baseURL.production`. Check both base URLs, including any path prefix. |
| Reference shows a closed menu                    | Add the same clicks in `referenceSetup`.                                                                          |
| Reference shows a login form                     | Add `environments.production.storageState`. See [Authenticated pages](/guides/application-auth/).                 |
| `visualguard.check needs a browser-backed page.` | Pass the `page` fixture, not a page from a remote or non-browser context.                                         |
| Import error for `visualguard/playwright`        | Use ES modules or TypeScript in tests. The package has no CommonJS build.                                         |

See [Capture problems](/troubleshooting/capture/) for more.

## Next steps

- [Stable captures](/guides/stable-captures/): masks, hides and waits that reduce noise.
- [Local baselines](/guides/local-baselines/): how baseline folders and metadata work.
- [Control AI policy and cost](/guides/ai-policy-and-budgets/): AI analysis inside tests.
- [Compatibility](/reference/compatibility/): supported Playwright and Node versions.
