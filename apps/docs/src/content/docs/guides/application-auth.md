---
title: "Capture authenticated application pages"
description: "Save browser sessions and use environment-specific authentication and hooks for repeatable captures."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "README.md"]
sidebar: {"order": 8}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

For logged-in application pages, use the existing capture authentication workflow, for example `npx --no-install visualguard auth staging --config visualguard.config.ts`, and the corresponding production setup. Add the saved state paths as an `environments` property inside your existing `defineConfig({ ... })` object so captures use them:

```ts
  environments: {
    production: { storageState: ".visualguard/auth/production.json" },
    staging: { storageState: ".visualguard/auth/staging.json" },
  },
```

This is a property fragment, not a second config file. Keep the existing URLs, routes and viewport settings. Application login cookies belong to the runner, not dashboard account login.

## Capture and prepare each environment

```bash
npx visualguard auth production
npx visualguard auth staging --until-url '**/dashboard'
```

Log in in the browser and save the session, then configure each environment:

```ts
environments: {
  production: { storageState: ".visualguard/auth/production.json" },
  staging: {
    storageState: ".visualguard/auth/staging.json",
    headers: { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET ?? "" },
  },
},
hooks: {
  beforeCapture: async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
  },
},
```

`beforeNavigate` and `beforeCapture` receive the Playwright page, environment, route, URL and viewport. Use them to prepare page state consistently. Session files contain credentials and should remain private; keep keys and bypass tokens in environment variables.

## Verify the setup

Log in to each environment separately, save state and confirm screenshots show the authenticated page rather than a login redirect. Renew expired state on the runner. Never commit session files.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
