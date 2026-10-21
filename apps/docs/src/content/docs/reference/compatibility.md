---
title: "Compatibility and validated scope"
description: "Check package/source boundaries, operating systems, storage capabilities and fixture limitations."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/RELIABILITY-CHANGES.md"]
sidebar: { "order": 7 }
---

| Area           | Policy                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node           | Declared minimum 22.12.0; CI matrix covers Node 22 and 24                                                                        |
| Playwright     | Declared optional peer range ≥1.45.0; full repository tests use the pinned development version from package.json                 |
| Chromium       | Full repository test matrix on Linux/macOS/Windows                                                                               |
| Firefox/WebKit | Focused Linux CI smoke tests; this is narrower than the Chromium suite                                                           |
| Baselines      | Browser/platform/project/settings compatibility checked; regenerate on mismatch                                                  |
| Manifests      | Schema version 1 with additive provenance/policy/usage fields; older reports remain readable, older shard runs are not mergeable |
| Report sharing | Upload the entire run directory; HTML inlines application JS/CSS but references image files                                      |

CI workflow coverage describes configured checks, not a claim that every remote workflow has already passed. Live Gemini quality, the declared minimum Playwright version, and Firefox/WebKit behavior beyond smoke coverage require their own measured runs.

## CLI and fixture capability differences

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

## Documentation verification scope

The fresh npm first-comparison guide is exercised with Chromium on macOS/Node 24.13.0, including local SQLite history/restart. The existing private-runner smoke exercises real capture/progress and scoped credentials. PostgreSQL/MongoDB/Google/cloud-provider articles are source-reviewed; they were not certified through live provider deployments in this documentation change. Historical validation records describe their own date/revision and must not be treated as current all-platform certification.

Docs development requires Node 22.22+; the published CLI declares 22.12+. Keep browser/platform/theme/viewport identity consistent across baseline creation and capture. [Release availability](/releases/) lists known artifact differences.
