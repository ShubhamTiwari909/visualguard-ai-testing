---
title: "Choose browsers and viewports"
description: "Configure responsive dimensions, browser engines, touch settings and consistent render identity."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 3}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

## Install the browser you select

```sh
npx playwright install chromium
npx playwright install firefox
npx playwright install webkit
```

Install only the engines you plan to use. Add `--with-deps` on Linux/CI when system libraries are missing. Keep Playwright and its browser binaries aligned.

## Configure named viewports

Merge these property fragments into your existing config:

```ts
viewports: {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
},
browser: {
  name: 'chromium',
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  deviceScaleFactor: 1,
},
```

Names use letters, numbers and hyphens. Width is 200–7680; height is 200–4320; scale factor is greater than zero and at most 4. Browser settings select one engine per CLI run. Compare the same OS/browser/theme/viewport rendering identity when using baselines.

```sh
npx --no-install visualguard test --viewport mobile --no-ai
npx --no-install visualguard test --browser firefox --viewport desktop --no-ai
```

Mobile emulation support is browser-dependent. Firefox does not support Playwright's `isMobile` emulation; use dimensions without `isMobile` for that engine. Touch/mobile flags are not a guarantee of testing real hardware.


## Verify the setup

List the planned comparisons, then inspect screenshots and manifest rendering metadata at both sizes.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
