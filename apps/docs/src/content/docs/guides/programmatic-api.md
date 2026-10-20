---
title: "Run VisualGuard from code"
description: "Create and cancel a run, select reporters and interpret status through the public API."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md", "packages/visualguard/src/index.ts"]
sidebar: {"order": 16}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

```ts
import { createRun, exitCodeFor, parseConfig, resolveConfig, terminalReporter } from "visualguard";

const config = resolveConfig(
  parseConfig({
    baseURL: { production: "https://example.com", staging: "http://localhost:3000" },
    routes: ["/", "/pricing"],
  }),
  { cwd: process.cwd() },
);

const controller = new AbortController();
const { manifest, runDir } = await createRun(config, {
  signal: controller.signal,
  reporters: [
    terminalReporter(),
    {
      name: "dashboard",
      async onRunEnd(result, context) {
        console.log(context.runDir, result.summary);
      },
    },
  ],
}).start();

console.log(runDir);
process.exitCode = exitCodeFor(manifest, "regression");
```

Custom reporters implement `onEvent` and/or `onRunEnd`. CLI users can add them through `reporters` in configuration; API callers supply them in run options. The package exports configuration helpers, run/event/result types, status helpers and terminal/JSON reporters. Programmatic runs select reporters explicitly; the CLI's HTML/JUnit/webhook setup is not automatically implied by this example. `RunOptions.signal` enables cancellation.

## Verify the setup

Execute the complete example with reachable URLs and an installed Playwright browser. Check `runDir`, the returned manifest and `exitCodeFor`; cancel a disposable run to confirm caller-owned cleanup.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
