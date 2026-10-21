---
title: "Add reporters and integrations"
description: "Choose CLI reports or API callbacks, write a custom reporter and preserve artifacts for automation."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths: ["packages/visualguard/src/core/run.ts", "packages/visualguard/src/core/events.ts", "packages/visualguard/src/cli/shared.ts", "packages/visualguard/src/sdk.ts"]
sidebar: {"order": 19}
---

A reporter consumes progress or completed results. It does not make a result pass or host the evidence for you. Choose the CLI integrations for ordinary automation, or a custom reporter when another tool needs the manifest.

## Before you start

Complete [your first comparison](/start/quickstart/). Use the same application root and config for every command. For API callbacks, first follow [Run from code](/guides/programmatic-api/).

## CLI output formats

```sh
npx --no-install visualguard test --config visualguard.config.ts --no-ai --ci --junit visualguard-junit.xml
```

This saves run evidence and writes JUnit to the selected path. Preserve the whole run folder and JUnit even if comparison exits nonzero. `--json` selects machine-readable manifest output; keep diagnostic stderr separate when your automation parses stdout. The normal CLI pipeline also sets up its configured HTML report and summary integrations.

These are property fragments to merge into your existing `defineConfig` object, not a separate file:

```ts
report: {
  html: true,
  junit: 'visualguard-junit.xml',
  githubSummary: true,
},
```

GitHub summaries need the job-provided `GITHUB_STEP_SUMMARY` environment. Setting `report.publicURL` supplies links; it does not upload or host your evidence.

## SDK output formats

With `runVisualGuard`, select output through the call's `reports` option:

```js
import { runVisualGuard } from 'visualguard';

const result = await runVisualGuard({
  reports: {
    html: true,
    junit: 'test-results/visualguard.xml',
    githubSummary: Boolean(process.env.GITHUB_STEP_SUMMARY),
  },
});
process.exitCode = result.exitCode;
```

HTML and JUnit are enabled by default; the default JUnit path is inside the saved
run directory. GitHub summaries must be enabled explicitly. The returned
`artifacts` object contains absolute paths. Custom JUnit paths resolve against
`cwd` and need a separate upload when outside `runDir`. Preserve all screenshot
and diff files alongside the HTML. The SDK selects its reporters through the call's
`reports` and `reporters` options; it does not apply config-file CLI reporter
settings. See the [SDK guide](/guides/programmatic-api/#5-reports-diffs-and-progress).

## Write a custom reporter

Create `visual-reporter.mjs` in your application's root:

```js
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const summaryReporter = {
  name: 'team-summary',
  onEvent(event) {
    if (event.type === 'job:end') console.error(event.job.route, event.job.status);
  },
  async onRunEnd(manifest, context) {
    await writeFile(join(context.runDir, 'team-summary.json'), JSON.stringify({
      id: manifest.id,
      summary: manifest.summary,
      incomplete: Boolean(manifest.incomplete),
    }, null, 2));
  },
};
```

In an executable config for CLI runs, import `summaryReporter` from `./visual-reporter.mjs` and set `reporters: [summaryReporter]` inside `defineConfig`. Keep all other existing config fields. With the SDK, import the same object and pass `runVisualGuard({ reporters: [summaryReporter] })`. Existing low-level callers can add it to the `createRun` options' reporters array.

`onEvent` is synchronous and receives `run:start`, `job:start`, `job:captured`, `job:end`, `run:end` or `warning`. Use `onRunEnd` for awaited final output; it receives the manifest and a context containing `runDir` and resolved config. Avoid slow network calls during capture events. Follow the public event types rather than inventing progress totals or assuming every event means a passing result.

## Webhooks

Add `report.webhook` with your actual trusted receiver URL, or set `VISUALGUARD_WEBHOOK_URL`. The CLI posts a run summary; the receiver handles authentication, retry processing and storage for its own deployment. Keep credentials out of public report URLs. Verify delivery at the receiver independently from the visual verdict. A webhook summary is not a complete backup of screenshots or accounts.

## Check the integration

Run one comparison and confirm `team-summary.json` appears under its actual evidence directory. Verify the recorded run ID/status counts. For CI, check the downloadable folder and JUnit after a deliberately failing visual test. For webhooks, inspect the receiver's redacted logs and match the intended run ID.

## Troubleshooting

No API HTML/JUnit output usually means you selected different reporters from the CLI. Missing files can mean you inspected an older run or used another output directory. Fix callback/receiver errors explicitly instead of treating delivery as an approval. [Find run artifacts](/reference/artifacts/) or [check CI output](/troubleshooting/ci/).
