---
title: "Use a local Ollama model"
description: "Start a local vision model and connect VisualGuard without a Gemini key."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 10}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

Install/start Ollama following its [official setup](https://docs.ollama.com/quickstart), then download a compatible vision model such as [Qwen2.5-VL](https://ollama.com/library/qwen2.5vl):

```sh
ollama pull qwen2.5vl
```

Leave its local service running; use `ollama serve` if the app has not already started it. From the application root:

```sh
export OLLAMA_HOST=http://127.0.0.1:11434
npx --no-install visualguard test --config visualguard.config.ts \
  --provider ollama --model qwen2.5vl
```

The downloaded local model requires sufficient machine resources but no Gemini API key. Requests use the selected Ollama host. Return to deterministic-only testing with `--no-ai`.

## Environment files on Windows

Instead of the POSIX `export` line, add `OLLAMA_HOST=http://127.0.0.1:11434` to an ignored application-root `.env.local`. The test command loads that file. Keep the Ollama service running in its own terminal.

## Verify the setup

Check the selected local provider and actual analysis in the report. If the service/model is unavailable, inspect the fallback reason before assuming AI succeeded.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
