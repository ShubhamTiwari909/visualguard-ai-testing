---
title: "Use inside Playwright tests"
description: "Add visual checkpoints with matching reference interaction state and attached evidence."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md", "docs/RELIABILITY-CHANGES.md", "packages/visualguard/src/playwright/index.ts"]
sidebar: {"order": 8}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

## 1. Install the fixture dependency

```sh
npm install --save-dev @playwright/test
npx playwright install chromium
```

Use a Playwright Test version matching the Playwright library already selected by your project. Keep the existing Playwright configuration if it is compatible. Otherwise create `playwright.config.ts` at the application root:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:4101', viewport: { width: 1280, height: 800 } },
});
```

Keep both quickstart servers running. Create `tests/visual.spec.ts`:

```ts
import { test } from 'visualguard/playwright';

test('storefront', async ({ page, visualguard }) => {
  await page.goto('/');
  await visualguard.check(page, { name: 'storefront-home' });
});
```

Run `npx playwright test tests/visual.spec.ts`. Inspect VisualGuard's screenshot/result attachments in the Playwright report. The deliberate quickstart color change can require review; configure `failOn` deliberately.

## 2. Match an interactive reference state

The following is a separate application-specific example. It requires a `/shop` page with Cart and the selectors shown; adapt them to your real application before running it.

Install `@playwright/test` alongside VisualGuard and configure Playwright's `use.baseURL` for staging. Import the extended test fixture:

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

`check` compares the current page with the same path on production. `referenceSetup` brings the fresh production page to the matching interactive state. If no production URL is configured, it uses fixture baselines under `baseline.dir/playwright`; explicitly create/update them with `npx playwright test --update-snapshots`.

The fixture shares classification, AI/cache, acceptance and configured checks with the CLI, and attaches screenshots plus `result.json` evidence. Configure `config`, `configPath` and `failOn` through `visualguardOptions`; each check accepts `name`, `waitFor`, `mask`, `hide`, `failOn` and `referenceSetup`.

`collectHealth: true` instruments the provided `page` before navigation. Events that occurred before instrumentation on an externally created page cannot be recovered. AI sessions are per test; the test-owned clock stays under test control, and the fixture does not automatically replay the current page for a second noise capture. See the [fixture capability table](docs/RELIABILITY-CHANGES.md#playwright-fixture-capability-contract).

## Fixture capability boundaries

| Capability                                      | CLI                                                | Fixture                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DOM classification and independent-check policy | Shared implementation                              | Shared implementation                                                                                                     |
| AI, request cache, analysis budgets, acceptance | Supported                                          | Supported; session per test                                                                                               |
| Second-capture noise map                        | Live reference/current in baseline mode            | Fresh production reference when available; no automatic replay of a test-owned current page                               |
| Accessibility/performance                       | Capture pipeline                                   | Enabled configured checks at check time; performance preservation before navigation on provided page                      |
| Console/request events                          | Attached before navigation                         | Set `visualguardOptions.collectHealth: true` for the provided `page`; externally created pages cannot recover past events |
| Clock control                                   | Installed before navigation and paused for capture | Existing test clock stays test-owned; CSS/media/stability handling applies                                                |
| Interactive reference state                     | Global hooks                                       | Per-check `referenceSetup` plus global hooks                                                                              |
| Missing baseline                                | Error by default                                   | Error by default; explicit update or `missing: "create"`                                                                  |
| Output                                          | Run manifest and reporters                         | Test attachments and `result.json`                                                                                        |

```ts
import { test } from "visualguard/playwright";

test.use({ visualguardOptions: { collectHealth: true } });
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

## Verify the setup

Open Playwright attachments for the named checkpoint and confirm both sides represent the same interaction state.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/compatibility/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
