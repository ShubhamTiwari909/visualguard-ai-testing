---
title: "Run VisualGuard from code"
description: "Load your existing config, run a comparison from JavaScript, handle cancellation and interpret the saved result."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/index.ts", "packages/visualguard/src/config/load.ts", "packages/visualguard/src/config/resolve.ts", "packages/visualguard/src/core/run.ts"]
sidebar: {"order": 18}
---

Use the public JavaScript API when you want to start a comparison from your own tool or script. Your application still needs Playwright and reachable target URLs. Importing VisualGuard does not start a test.

## Before you start

Complete the [quickstart](/start/quickstart/) and keep its two demo servers running. Work in that same application's root with `visualguard.config.ts` present. Node 22.12+ can run the `.mjs` example directly; no TypeScript build is required.

## 1. Create the script

Save this complete file as `visual-check.mjs` beside your config:

```js
import { loadConfig, resolveConfig, createRun, terminalReporter, exitCodeFor } from 'visualguard';

const { config, configPath } = await loadConfig({ cwd: process.cwd() });
const resolved = resolveConfig(config, { cwd: process.cwd(), configPath });
const controller = new AbortController();
const stop = () => controller.abort(new Error('Stopped by the user'));
process.once('SIGINT', stop);

try {
  const { manifest, runDir } = await createRun(resolved, {
    signal: controller.signal,
    reporters: [terminalReporter()],
  }).start();
  console.log('Saved evidence:', runDir);
  console.log('Summary:', manifest.summary);
  process.exitCode = exitCodeFor(manifest, 'regression');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', stop);
}
```

The loader finds the supported config file. The resolver fills defaults and applies environment/override rules. `createRun(...).start()` executes it and returns the run manifest plus evidence directory. The selected reporter prints progress.

## 2. Run it

```sh
node visual-check.mjs
```

Expect progress and a saved evidence path. Inspect its `manifest.json` and screenshot files. A review/regression is a comparison outcome, not necessarily an API error. The exit helper applies the failure policy to the result; a thrown setup/operation error is handled separately in this script.

## Environment loading

The CLI loads `.env` and `.env.local` before configuration. A custom API caller owns environment loading. If you need the same behavior, import `loadEnvFiles` from `visualguard` and call `loadEnvFiles(process.cwd())` before `loadConfig`. Existing process values win. Never log private keys or storage-state contents.

## Reporters and cancellation

API reporters are explicit. This example selects a terminal reporter, not the CLI's HTML/JUnit/webhook setup. Do not assume it creates a served interactive report. Use [the reporter guide](/guides/reporters/) to write your own result output, or use the CLI/report workflow if that is your goal.

The `AbortSignal` is passed to the run. Pressing Ctrl+C requests cancellation; the script removes its listener afterward. Your caller still owns external app servers and resources it started. Treat interrupted evidence as incomplete and inspect it before using it for release decisions.

## Check the setup

Run the changed quickstart pages, inspect the manifest, then repeat with matching pages. Check the exit policy and result summary independently. If you test cancellation, do it in a disposable run and confirm your app servers and caller-owned resources are cleaned up as intended.

## Troubleshooting

Use the correct application directory and config path. An unavailable browser or URL needs the same fix as a CLI test. If AI does not run, check explicit environment loading/provider selection. See [capture troubleshooting](/troubleshooting/capture/) and [public exports](/reference/api/).
