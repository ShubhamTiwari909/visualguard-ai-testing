---
title: "Configure your project"
description: "Create a complete configuration and understand file discovery and override precedence."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

Create `visualguard.config.ts` in your project root:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: "http://localhost:3000",
  },
  routes: [
    "/",
    { path: "/pricing", staging: "/plans" },
    {
      path: "/checkout",
      waitFor: "[data-testid=order-summary]",
      mask: ["[data-testid=order-id]"],
    },
    { path: "/blog/[slug]", params: [{ slug: "hello-world" }] },
  ],
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
  browser: { name: "chromium", locale: "en-US", colorScheme: "light" },
  stabilize: {
    freezeTime: "2026-01-01T00:00:00Z",
    hide: [".cookie-banner"],
    mask: ["[data-testid=live-price]"],
  },
  diff: { threshold: 0.1, maxDiffPixels: 20 },
  ai: { provider: "none" },
});
```

Alternatively, replace `routes` with discovery settings:

```ts
routes: {
  discover: ["nextjs", "sitemap", "crawl"],
  extra: [{ path: "/blog/[slug]", params: [{ slug: "hello-world" }] }],
  include: ["/**"],
  exclude: ["/admin/**"],
  limit: 50,
  crawlDepth: 2,
},
```

Configuration fragments in this README belong inside `defineConfig({ ... })`. `.ts`, `.mts`, `.js`, `.mjs` and `.cjs` configuration files are supported; select another file with `--config <path>`.

| Group                             | Controls                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `routes`, `viewports`, `browser`  | URLs, discovery, dimensions, touch/mobile settings, locale, timezone, theme, scale and browser timeouts. |
| `environments`, `hooks`           | Per-environment headers/storage state and page preparation callbacks.                                    |
| `stabilize`, `screenshot`, `diff` | Capture stability, full-page/max-height settings, pixel thresholds, regions, shifts and noise mapping.   |
| `ai`, `fix`                       | Providers, analysis policy/budgets, editable source scope, proposals and verification.                   |
| `baseline`, `monitor`, `output`   | Reference storage, update policy, acceptance and run retention.                                          |
| `checks`, `report`, `reporters`   | Independent checks, HTML/JUnit/webhooks and custom integrations.                                         |
| `concurrency`                     | Number of jobs captured concurrently.                                                                    |

A base path is preserved: `https://example.com/app` plus `/pricing` becomes `https://example.com/app/pricing`. Base URL query parameters are applied to each route.

### Overrides and environment variables

CLI overrides take precedence over environment variables, then configuration, then defaults. `.env` and `.env.local` are loaded from the working directory; existing shell/CI variables win.

| Variable                                                | Purpose                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `VISUALGUARD_PRODUCTION_URL`, `VISUALGUARD_STAGING_URL` | Override environment base URLs, including PR previews.  |
| `VISUALGUARD_AI_PROVIDER`                               | Select `gemini`, `ollama` or `none`.                    |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY`                     | Gemini credentials; `GEMINI_API_KEY` takes precedence.  |
| `OLLAMA_HOST`                                           | Address of your Ollama server.                          |
| `VISUALGUARD_BROWSER`, `VISUALGUARD_OUTPUT_DIR`         | Override the selected browser and run output directory. |
| `VISUALGUARD_RUN_GROUP`                                 | Shared identity for shards of one execution.            |
| `VISUALGUARD_WEBHOOK_URL`                               | Destination for run-summary webhooks.                   |

## Deliberately select JSON

JSON is supported when explicitly selected, but `init` generates TypeScript. If you deliberately prefer JSON, create `visualguard.config.json` instead of running the initializer, using the same config fields as plain JSON without the import/export or `defineConfig` wrapper. For example:

```json
{
  "baseURL": {
    "production": "https://your-app.example.com",
    "staging": "http://127.0.0.1:3000"
  },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" }
}
```

Run it with `npx --no-install visualguard test --config visualguard.config.json --no-ai`. Automatic discovery finds supported JavaScript/TypeScript filenames, not this JSON filename. The remaining examples use the generated `.ts` file; replace their `--config` path only if you chose JSON. Keep one intended config to avoid testing different settings accidentally.

## Verify the setup

Run doctor and `test --list` with the same config path. Verify both URLs, every route/viewport pair and the active provider before capture.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
