---
title: "Control AI policy and cost"
description: "Set intent, advisory behavior, request budgets, deadlines and cache policy."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["README.md"]
sidebar: {"order": 11}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

Without AI, VisualGuard maps changed regions to DOM elements and reports style/text/presence/layout changes. Removed controls, new overlaps, clipping, low contrast, broken images and overflow can produce deterministic regressions. Other changes usually require review.

Enable Gemini in your configuration and put its key in your environment or ignored `.env.local`:

```ts
ai: {
  provider: "gemini",
  // Set model to a pinned model ID available to your account for repeatable CI.
  analyze: "uncertain",       // "all" also explains deterministic regressions
  thinking: "low",           // "off" | "low" | "default"
  imageDetail: "medium",      // "low" | "medium" | "high"
  advisory: true,             // attach analysis while preserving deterministic status
  maxCallsPerRun: 30,
  maxGenerationAttempts: 60,  // includes structured-answer repair attempts
  maxNetworkAttempts: 120,    // includes built-in provider retries
  maxTokens: 200_000,
  timeoutMs: 120_000,
  cacheTTLHours: 24,
  intent: {
    title: "Update pricing copy",
    description: "Layout and checkout controls should remain unchanged.",
    changedFiles: ["app/pricing/page.tsx"],
  },
},
```

For a locally hosted model, use `ai: { provider: "ollama", model: "qwen2.5vl" }` and a running Ollama server with the model installed. Use `provider: "none"` or `test --no-ai` for deterministic analysis.

AI classifies differences as regression, intentional, content or noise. With advisory mode off (the default), sufficiently confident noise may turn a review into a pass. AI cannot downgrade deterministic regressions or waive independent health/check reviews. Change intent provides context; it does not authorize bypassing checks. Self-reported confidence is not a calibrated probability.

Analysis sends prepared screenshot images and DOM context to the selected provider. Fix proposals may also send source excerpts after consent. Missing credentials or provider failures fall back to deterministic analysis. The default Gemini model is a moving alias; returned model revisions are retained when available.

```bash
# Analyze saved artifacts without capturing the site again.
npx visualguard analyze --run <run-id> --provider gemini
npx visualguard analyze --run <run-id> --provider gemini --no-cache
```

Caches hash the complete prepared request, validate stored answers and expire by default after 24 hours. Analysis and later repair share saved token/attempt usage. Each invocation has its own deadline. Reports and fix artifacts expose usage; limits stop subsequent work, but an in-flight request can exceed the token limit and some failed requests do not return billable usage.

## Verify the setup

Use a deliberately small budget and inspect saved usage/fallback metadata. Confirm advisory mode preserves deterministic statuses and that no API key appears in the configuration or report.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
