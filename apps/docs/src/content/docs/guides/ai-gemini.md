---
title: "Add Gemini analysis"
description: "Configure optional Gemini credentials, select a model and confirm analysis actually ran."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 9}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

1. Create a Gemini API key using [Google's API-key instructions](https://ai.google.dev/gemini-api/docs/api-key).
2. Add the key to an ignored `.env.local` in the **application root**, or its CI secret manager:

```dotenv
GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
```

3. From that application root, run:

```sh
npx --no-install visualguard test --config visualguard.config.ts --provider gemini
npx --no-install visualguard report --config visualguard.config.ts
```

Do not append `--no-ai`. `--provider gemini` overrides the sample config's `ai.provider: none`; just removing `--no-ai` would not enable that config's AI. The test loads `.env`/`.env.local`, with existing process variables taking precedence. The key belongs to the visual-test runner, not the dashboard database or Google sign-in client.

Check the saved analysis/provider information in the report. Missing/invalid keys, quota, model access or network errors can cause deterministic fallback, so a completed report alone is not proof an AI request succeeded. By default, AI targets uncertain changes; use `ai.analyze: "all"` to explain deterministic regressions too. `ai.advisory: true` adds explanation without changing deterministic statuses. These are properties to merge into the existing `ai` configuration, not separate top-level settings.

To select an account-supported model explicitly, add `--model YOUR_MODEL_ID`. Configure token/call/time budgets for repeatable CI rather than assuming unlimited model access. AI does not authorize team approvals or bypass capture problems.

## Verify the setup

Inspect provider/model/analysis metadata in the actual report; a successful capture with deterministic fallback is not proof of an AI request. Keep an explicit no-AI path working.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
