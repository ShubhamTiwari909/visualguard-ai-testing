---
title: "Public package entry points"
description: "Use supported exports without relying on internal dashboard endpoints or source files."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["packages/visualguard/src/index.ts", "packages/visualguard/src/dashboard.ts", "packages/visualguard/src/playwright/index.ts"]
sidebar: {"order": 6}
---

| Import | Supported purpose |
| --- | --- |
| `visualguard` | Configuration/load/resolve helpers; run APIs; public result/event types; status helpers; terminal/JSON reporters. |
| `visualguard/playwright` | Extended Playwright `test`, fixture/check options and checkpoint integration. |
| `visualguard/dashboard` | Packaged dashboard runtime and documented dashboard project API. |
| `visualguard/package.json` | Published package metadata, useful for identifying an artifact with a mismatched CLI version label. |

Importing the library does not start capture. Call `createRun(...).start()` and select API reporters/cancellation explicitly. [Run from code](/guides/programmatic-api/) for a complete example; [Playwright guide](/guides/playwright/) shows fixture behavior.

The source barrel/declaration files define exact exported names/types. Internal `apps/platform/server/*` and dashboard HTTP endpoints are implementation details unless explicitly documented as supported. Do not build an external integration around an inferred endpoint compatibility promise. CLI commands provide the documented operational flows.
