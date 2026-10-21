---
title: "Public package entry points"
description: "Use supported exports without relying on internal dashboard endpoints or source files."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths:
  [
    "packages/visualguard/src/index.ts",
    "packages/visualguard/src/dashboard.ts",
    "packages/visualguard/src/playwright/index.ts",
    "packages/visualguard/src/sdk.ts",
  ]
sidebar: { "order": 6 }
---

| Import                     | Supported purpose                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visualguard`              | `runVisualGuard` script/CI SDK; configuration/load/resolve helpers; low-level run APIs; public result/event types; status helpers; terminal/JSON reporters. |
| `visualguard/playwright`   | Extended Playwright `test`, fixture/check options and checkpoint integration.                                                                               |
| `visualguard/dashboard`    | Packaged dashboard runtime and documented dashboard project API.                                                                                            |
| `visualguard/package.json` | Published package metadata, useful for identifying an artifact with a mismatched CLI version label.                                                         |

Importing the library does not start capture. Await `runVisualGuard(options)` for the script/CI SDK, or use `createRun(...).start()` for the low-level API. See [SDK setup and examples](/guides/programmatic-api/) and the [Playwright guide](/guides/playwright/).

The source barrel/declaration files define exact exported names/types. Internal `apps/platform/server/*` and dashboard HTTP endpoints are implementation details unless explicitly documented as supported. Do not build an external integration around an inferred endpoint compatibility promise. CLI commands provide the documented operational flows.

## Configuration and environment

| Export                             | Input and result                                      | When to use it                                                               |
| ---------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `defineConfig(config)`             | Returns the config with authoring types               | Export a config from TypeScript; runtime validation happens when loaded.     |
| `loadEnvFiles(cwd, env?)`          | Loads `.env`, then `.env.local`; returns loaded paths | Before config loading in a custom caller. Existing environment values win.   |
| `loadConfig({ cwd, configPath? })` | Asynchronously returns `{ config, configPath }`       | Find, import and validate an executable config.                              |
| `parseConfig(raw, source?)`        | Returns validated config with defaults                | Validate a plain object you already have.                                    |
| `resolveConfig(config, options)`   | Returns resolved paths, URLs and runtime settings     | Pass `cwd`, optional `configPath`, environment and overrides before running. |

Calling `defineConfig` alone does not validate inputs or start anything. A low-level API caller must load its own environment files. The SDK loads files into a copied environment by default; config modules still read the real process environment. See [SDK environment behavior](/guides/programmatic-api/#8-environment-overrides-and-cancellation) and [configuration precedence](/guides/configuration/).

## Runs, results and reporters

| Export                                                                          | Purpose                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runVisualGuard(options?)`                                                      | Resolves file/inline config, runs capture, writes HTML/JUnit by default, and returns `{ manifest, runDir, exitCode, passed, artifacts }`. Does not set process exit status. |
| `RunVisualGuardOptions`, `VisualGuardResult`, `SDKReports`, `SDKMonitorOptions` | TypeScript contracts for SDK inputs, returned evidence/verdict, and report selection.                                                                                       |
| `createRun(resolved, options?)`, `Run`                                          | Create a run, then await `.start()` for `{ manifest, runDir }`. Options include an abort signal and explicit reporters.                                                     |
| `planJobs`, `buildJobs`                                                         | Plan capture jobs from resolved settings/routes. Planning can involve discovery; use CLI `test --list` for ordinary inspection.                                             |
| `summarize(jobs)`                                                               | Count every result status, including zero counts.                                                                                                                           |
| `exitCodeFor(manifest, failOn)`                                                 | Evaluate `regression`, `review` or `any` failure policy; incomplete evidence also fails.                                                                                    |
| `readRunIndex(outputDir)`                                                       | Read the saved run list beneath the configured output directory.                                                                                                            |
| `findRun(outputDir, id?)`                                                       | Resolve an indexed run and its folder; omitting the ID selects the latest.                                                                                                  |
| `readManifest(runDir)`                                                          | Read one run's manifest.                                                                                                                                                    |
| `terminalReporter`, `jsonReporter`                                              | Create public reporter implementations.                                                                                                                                     |
| `VisualGuardError`, `ConfigError`, `EnvironmentError`, `ExitCode`               | Identify errors and process outcomes.                                                                                                                                       |
| `VERSION`                                                                       | Embedded build version; inspect package metadata too when investigating a version-label mismatch.                                                                           |

The package also exports URL helpers (`joinURL`, `expandRoutes`, `routeSlug`) and TypeScript contracts for config, routes, capture hooks, jobs, manifests, reporters and events. Use the installed declarations for exact signatures. [Run from code](/guides/programmatic-api/) gives a runnable example; [custom reporters](/guides/reporters/) explains callbacks and awaited final output.

For daily Node.js monitoring, pass `monitor: true` or typed `SDKMonitorOptions`
to `runVisualGuard`. This selects rolling monitor semantics and baseline health
comparison, rather than baseline-mode snapshot refreshes. `result.snapshotDir`
identifies the folder to persist. See [monitor options and migration](/guides/programmatic-api/#6a-daily-monitor-runs)
for exact directory rules, deliberate resets and cloud integration boundaries.

## Dashboard entry point

The separate `visualguard/dashboard` entry point exposes `startDashboard`, `createDashboardHandler`, `copyDashboardAssets`, `scaffoldDashboard`, `createDashboardProject`, `importDashboardRun`, `publishDashboardRun`, `pullApprovedBaseline`, `exportDashboard`, `restoreDashboard` and `runPolicyCommand`.

These operate on real dashboard storage, servers or files. Prefer the [dashboard CLI](/reference/cli/dashboard/) for setup, backup and publishing unless you are embedding the runtime. A started server must be closed by its caller. Use a dedicated test data directory when experimenting; importing the runtime does not provision a cloud database, sign-in provider or capture browser.

Dashboard-requested capture still follows the [release boundary and host requirements](/dashboard/run-tests/). Importing a newer-looking API name does not make source-only behavior available in an older installed artifact.
