---
title: "Run your first visual test"
description: "Run a complete local comparison without AI, accounts or a database, then inspect the saved evidence."
audience: "developer"
docType: "tutorial"
channel: "published"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/cli/commands/test.ts"]
sidebar: {"order": 4}
---

## What you will set up

Two local pages with a deliberate button-color change, one VisualGuard config and an HTML evidence report. You can replace the demo URLs with your own application environments afterward. No database, dashboard or AI key is required.

## Before you start

Use [Node 22.12+ and browser prerequisites](/start/requirements/). Open the root of an existing application, or make a disposable folder and run `npm init -y`. Use a separate terminal for the demo servers and comparisons. Commands below work as individual lines; the JavaScript/config files work on Windows too.

## 1. Install dependencies

At that application's root:

```sh
npm install --save-dev --save-exact visualguard@3.2.3
npm install --save-dev playwright
npx playwright install chromium
npx --no-install visualguard --version
```

On Linux, use `npx playwright install --with-deps chromium` instead to include required system libraries. Keep compatible existing Playwright dependencies; do not create a second lockfile. pnpm users use `pnpm add -D -E visualguard@3.2.3`, `pnpm add -D playwright`, `pnpm exec playwright install chromium`, then `pnpm exec visualguard` in place of `npx --no-install visualguard`.

## Check the installed release

The published **3.2.3** artifact currently prints **3.2.2** from `visualguard --version`. This is a packaged version-label mismatch, not evidence that installation silently downgraded. Run `npm ls visualguard --depth=0` (or `pnpm list visualguard --depth=0`) to verify the installed package is 3.2.3. Keep the package version and reported CLI version in bug reports. See [release notes](/releases/).

## 2. Start two application versions

If you already have two reachable application servers, keep them running and use their actual URLs in step 3. Otherwise create `demo-sites.mjs` at the application root with this complete file:

```js
import { createServer } from 'node:http';

for (const [port, color] of [[4100, '#146c43'], [4101, '#b42318']]) {
  createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html lang="en"><head>
      <meta charset="utf-8"><title>Storefront demo</title>
      <style>body{font:20px system-ui;padding:64px}button{background:${color};color:white;padding:16px 24px;border:0;border-radius:8px}</style>
      </head><body><h1>Storefront</h1><p>Your order is ready.</p>
      <button>Continue to checkout</button></body></html>`);
  }).listen(port, '127.0.0.1', () => console.log(`Demo: http://127.0.0.1:${port}`));
}
```

In **terminal A**, at the application root:

```sh
node demo-sites.mjs
```

Leave it running. Open `http://127.0.0.1:4100` and `http://127.0.0.1:4101`; the button colors must differ. If a port is occupied, stop the other local process or change the port in this file and in the config together. These are application servers, not dashboard servers.

## 3. Create the configuration

In **terminal B**, at the same application root, create `visualguard.config.ts` with the full contents below. If you already used init, edit its existing file rather than creating another config.

```ts
import { defineConfig } from 'visualguard';

export default defineConfig({
  baseURL: {
    production: 'http://127.0.0.1:4100',
    staging: 'http://127.0.0.1:4101',
  },
  routes: ['/'],
  viewports: { desktop: { width: 1280, height: 800 } },
  ai: { provider: 'none' },
  output: { dir: '.visualguard' },
});
```

`production` is the reference and `staging` is the candidate. Use your real URLs if you skipped the demo. Add `.visualguard/`, `.env.local` and any saved authentication files to `.gitignore`. TypeScript config works in JavaScript applications; no application TypeScript build is needed. [The installation guide](/start/install/) also explains the interactive initializer.

## 4. Check and capture

In terminal B:

```sh
npx --no-install visualguard doctor --config visualguard.config.ts
npx --no-install visualguard test --config visualguard.config.ts --list
npx --no-install visualguard test --config visualguard.config.ts --no-ai
```

Doctor should find the installed browser/config and reachable URLs. The list command should show `/` at the desktop viewport. A changed page may produce **review** or **regression** depending on its findings. A nonzero test exit can be a valid failed visual result; continue to the report in a separate command. [Exit codes](/reference/exit-codes/) distinguish test failure from invalid configuration or an environment problem.

## 5. Open the report

```sh
npx --no-install visualguard report --config visualguard.config.ts
```

Open the printed report URL if your browser does not open automatically. Inspect reference, candidate and diff views, then read the findings. Evidence is under `.visualguard/runs/RUN_ID/`; share the whole run folder when appropriate, since screenshots are separate files. `report` keeps a local server running. Stop it with Ctrl+C before reusing that terminal.

## Verify the setup

- Both local demo URLs load, and the reference/candidate button colors differ.
- Doctor reports working prerequisites and the list command identifies the expected comparison.
- The saved run contains screenshots, findings and an HTML report.
- Change the second demo color to match the first, restart terminal A, stop the report server, and run the comparison again. Inspect the new result instead of assuming it passed.

## Troubleshooting

**Connection refused:** start terminal A, check ports and use the same host spelling as the config. **Browser executable missing:** rerun the Playwright browser install from this application. **No difference:** check the two URLs and the staging color; ensure both servers were restarted after edits. **Report missing:** use the same config/output directory, and inspect the test error before opening a report. More fixes are in [capture troubleshooting](/troubleshooting/capture/).

## Next steps and cleanup

Add [real routes](/guides/routes/), [stable capture settings](/guides/stable-captures/), [CI](/ci/overview/) or a [local dashboard](/dashboard/local/). Stop demo/report processes with Ctrl+C. Local evidence remains in `.visualguard`; remove a disposable project only after saving any evidence you need.
