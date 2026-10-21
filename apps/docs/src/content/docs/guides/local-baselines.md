---
title: "Create local baselines"
description: "Create reviewed local reference images and compare later runs without silently replacing them."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "docs/RELIABILITY-CHANGES.md"]
sidebar: { "order": 6 }
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep its candidate demo running on port 4101. For your own app, replace that address below with its running URL. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

To compare one candidate application against stored screenshots, create a separate `visualguard.baseline.ts` configuration:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  mode: "baseline",
  baseURL: { staging: "http://127.0.0.1:4101" },
  routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } },
  baseline: { dir: "visualguard/baselines", missing: "error" },
  ai: { provider: "none" },
});
```

Create a reference only after checking that the current appearance is expected:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines --no-ai
```

After changing the application, compare without the update flag:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --no-ai
npx --no-install visualguard report --config visualguard.baseline.ts
```

Keep rendering settings consistent. Store local baselines according to your repository/artifact policy. Local baseline creation is different from the later shared **approved baseline registry** described in [the related setup guide](/dashboard/overview/). Do not update baselines automatically just to make CI pass.

## Missing or incompatible references

Missing baselines now fail by default. Create/update them explicitly:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines
# Inside Playwright tests:
npx playwright test --update-snapshots
```

For intentionally permissive local onboarding, set `baseline.missing: "create"`. In the CLI this permits an uninitialised reference result; screenshots are only persisted through an explicit update request. The Playwright fixture creates its baseline in this mode. Keep the default `error` in CI.

New baselines include `.meta.json`, `.dom.json`, `.health.json` and PNG files. Commit metadata and sidecars together. Existing CLI baselines can be read with `baseline.legacy: "allow"`; regenerate them to acquire metadata, then remove that override. Fixture baseline IDs have changed to include project/rendering identity, so regenerate fixture baselines explicitly. Metadata mismatches require using the original rendering settings or regeneration, even when `legacy: "allow"` is configured.

No persisted cookies, headers or source contents are added to baseline metadata. Verification still uses the current project's hooks and authentication settings, because functions and credentials are not serialised. Keep those callbacks/settings consistent with the original capture.

## Verify the setup

Create the reference once, change the candidate, and compare without the update flag. Confirm a missing/incompatible reference fails visibly rather than silently passing.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.baseline.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/dashboard/approved-baselines/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
