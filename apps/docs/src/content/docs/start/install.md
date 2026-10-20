---
title: "Install VisualGuard"
description: "Install the pinned package and browser, initialize your application and inspect the generated configuration."
audience: "developer"
docType: "how-to"
channel: "published"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/cli/commands/init.ts"]
sidebar: {"order": 3}
---

Start in the application you want to test. You do not need to clone VisualGuard. For a complete runnable local demo, use [the quickstart](/start/quickstart/).

## Install the package and browser

Use Node.js **22.12+** and a working application with two reachable environments: production/reference and staging/candidate. The runner can test React, Next.js, Vue, static sites or any other browser-accessible application; it does not need to run on the same host as that application.

From your application directory:

```sh
cd /path/to/your-app
npm install --save-dev --save-exact visualguard@3.2.3
npm install --save-dev playwright
npx playwright install chromium
npx --no-install visualguard --version
```

If already installed, check the version and continue. Keep existing Playwright setup if it already satisfies the package's peer requirement. On Linux/CI, install Playwright's required system dependencies too. Keep VisualGuard's optional dependencies enabled: PostgreSQL, MongoDB and OIDC drivers are packaged that way, so do not use `--omit=optional` for a dashboard installation.

Add these entries to `.gitignore` if absent:

```text
.visualguard/
.env.local
.env.visualguard
.env.dashboard-admin
```

## Initialize your project

Start your application normally, for example with `npm run dev`. From that application's root, run the setup wizard:

```sh
npx --no-install visualguard init
```

This is the installed-package form of `npx --no-install visualguard init`. The wizard asks for:

1. Your production/reference URL and staging/candidate URL, such as `https://your-app.example.com` and `http://127.0.0.1:3000`.
2. Routes to test and viewport presets.
3. An AI provider; choose **None** for the first visual-only run.
4. Whether to add a GitHub Actions workflow; you can decline for local setup.

For setup without prompts, use real reachable application URLs:

```sh
npx --no-install visualguard init --yes \
  --production https://your-app.example.com \
  --staging http://127.0.0.1:3000 --ai none
```

Choose the wizard or the noninteractive command, not both. Noninteractive setup selects discovered routes and the desktop/mobile viewport presets; review the generated file before running tests. These URLs describe the application under test, not the dashboard. For a fully local comparison, use two application servers on different ports.

## Understand the generated configuration

On a fresh project, `init` creates **`visualguard.config.ts`**. Keep that file for the commands in this guide; do not rename it to `.json`. VisualGuard loads the TypeScript config directly, including in JavaScript applications, without a separate TypeScript compilation step.

The wizard can also add a `visual` script to `package.json` if absent, update `.gitignore`, save a supplied Gemini key in `.env.local`, and create the GitHub workflow if selected. It does not create a database, dashboard server or dashboard project. Keep existing files when already configured; `--force` deliberately overwrites the discovered config.

A minimal config using the same format is:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://your-app.example.com",
    staging: "http://127.0.0.1:3000",
  },
  routes: ["/"],
  viewports: {
    desktop: { width: 1280, height: 800 },
  },
  ai: { provider: "none" },
});
```

The generated file can have additional discovered routes, viewports, comments and stabilization settings. Edit its existing values rather than replacing it blindly with this smaller example. `init --ai none` sets the provider during setup; later tests use `--provider gemini` or `--provider ollama` when enabling AI.

## pnpm alternative

If your application uses pnpm, keep that package manager and lockfile. Use `pnpm add -D -E visualguard@3.2.3`, `pnpm add -D playwright`, `pnpm exec playwright install chromium`, and `pnpm exec visualguard init`. Replace later `npx --no-install visualguard` invocations with `pnpm exec visualguard`.

## Check the installed release

The published **3.2.3** artifact currently prints **3.2.2** from `visualguard --version`. This is a packaged version-label mismatch, not evidence that installation silently downgraded. Run `npm ls visualguard --depth=0` (or `pnpm list visualguard --depth=0`) to verify the installed package is 3.2.3. Keep the package version and reported CLI version in bug reports. See [release notes](/releases/).

## Verification

Run `npx --no-install visualguard --version` and confirm the intended installed version. Check that `visualguard.config.ts` is at the application root and uses your reachable URLs. [Run the full quickstart](/start/quickstart/) or [configure your own routes](/guides/configuration/).
