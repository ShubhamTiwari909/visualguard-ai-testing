---
title: "Use a local Ollama model"
description: "Install Ollama, download a vision model and run VisualGuard's AI analysis on your own machine, without a cloud API key."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/ai/factory.ts",
    "packages/visualguard/src/ai/providers/ollama.ts",
    "packages/visualguard/src/ai/tasks/analyze-diff.ts",
    "packages/visualguard/src/cli/commands/doctor.ts",
    "packages/visualguard/src/cli/commands/analyze.ts",
  ]
sidebar: { "order": 10 }
---

This page shows how to run VisualGuard's AI analysis with [Ollama](https://ollama.com), a free tool that runs AI models on your own computer. Screenshots never leave your machine (or the server you point it at), and you do not need a cloud API key. Use it for confidential projects, offline work, or to avoid per-call costs.

AI is optional. VisualGuard always runs its own checks first, and a test never fails because the model was unavailable.

## Before you start

- Finish [Run your first visual test](/start/quickstart/) so you have a working `visualguard.config.ts`.
- Keep both application versions (production and staging) running.
- Have enough free disk space and memory for a vision model. The default model, `qwen2.5vl`, is several gigabytes. A machine with a recent GPU or Apple silicon answers much faster.
- Run every command from your app's root folder, where `visualguard.config.ts` lives.

To learn what the analysis adds and how it can change a page's status, read [What Gemini adds](/guides/ai-gemini/). It works the same way with Ollama.

## 1. Install and start Ollama

Install Ollama from the [official quickstart](https://docs.ollama.com/quickstart). The desktop app starts the local service for you. On a server without the app, start it yourself and leave this terminal open:

```bash
ollama serve
```

You should see the service listening on `127.0.0.1:11434`. Check it from another terminal:

```bash
curl http://127.0.0.1:11434/api/tags
```

You should get a small JSON response with a `models` list (empty for now).

## 2. Download a vision model

VisualGuard needs a model that can read images. The default is [Qwen2.5-VL](https://ollama.com/library/qwen2.5vl):

```bash
ollama pull qwen2.5vl
```

You should see a download progress bar, then `success`. Run `ollama list` to confirm `qwen2.5vl` is installed.

You can use another vision model. Text-only models cannot read screenshots and will not work.

## 3. Turn Ollama on

**For every run**, set the provider in `visualguard.config.ts`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing baseURL, routes and viewports
  ai: {
    provider: "ollama",
    model: "qwen2.5vl", // optional: this is the default
  },
});
```

**For one run**, pass the provider and model on the command line:

```bash
npx --no-install visualguard test --provider ollama --model qwen2.5vl
```

You can also set `VISUALGUARD_AI_PROVIDER=ollama`. When more than one is set, the order is: `--provider` flag, then `VISUALGUARD_AI_PROVIDER`, then `ai.provider` in the config.

:::note
If you switch provider with the flag or the environment variable, VisualGuard ignores the `ai.model` from your config, because a model ID belongs to one provider. Pass `--model` too, or rely on the default `qwen2.5vl`.
:::

## 4. Point VisualGuard at a different host (optional)

By default VisualGuard talks to Ollama at `http://127.0.0.1:11434`. To use Ollama on another port or another machine, set `OLLAMA_HOST`. The easiest way is a line in `.env.local` in your app's root folder:

```dotenv
OLLAMA_HOST=http://127.0.0.1:11434
```

Or set it for the current shell:

```bash
export OLLAMA_HOST=http://gpu-box.internal:11434
```

A variable already set in your shell wins over `.env` and `.env.local`. If the host is another machine, screenshots travel to that machine, so keep it on a network you trust.

## 5. Check the connection

```bash
npx --no-install visualguard doctor
```

You should see an **AI provider** line like `ollama at http://127.0.0.1:11434 (qwen2.5vl:latest)`.

If it is a warning, the message says what is wrong:

| Doctor message                 | Meaning                                                             |
| ------------------------------ | ------------------------------------------------------------------- |
| `"qwen2.5vl" is not installed` | Run `ollama pull qwen2.5vl`, or set `ai.model` to a model you have. |
| `"…" can't read images`        | The model is text-only. Pick a vision model.                        |
| A connection error             | Ollama is not running at that host. Start it, or fix `OLLAMA_HOST`. |

## 6. Run a test

```bash
npx --no-install visualguard test
```

You should see `ai  ollama (qwen2.5vl)` in the header. At the end, a usage line such as `AI: qwen2.5vl · 3 calls · 9.8k tokens in / 0.6k out`. Regressions with an explanation appear in an **AI ANALYSIS** block.

Then open the report with `npx --no-install visualguard report`. Each analysed page shows the classification, model confidence and `ollama · qwen2.5vl`.

To re-run the analysis on a saved run without capturing again:

```bash
npx --no-install visualguard analyze --provider ollama --model qwen2.5vl
```

See [Re-analyze a saved run](/guides/ai-gemini/) for every `analyze` flag. They are the same for both providers.

## How Ollama requests differ from Gemini

- **One image per region.** Small local models do better with a single picture, so VisualGuard joins the production, staging and diff crops side by side into one image (longest side at most 1536 pixels).
- **Only the first region gets an image.** Ollama receives one image per request, so later regions of the same page are sent as text only (selectors and DOM changes).
- **No thinking or image-detail settings.** `ai.thinking` and `ai.imageDetail` apply to Gemini only.
- **No automatic retries.** If Ollama is unreachable or returns an error, that page falls back to VisualGuard's own result. Other pages still try.

Everything else is the same: the same prompt, the same classification rules, the same cache in `.visualguard/cache/ai`, and the same budgets.

## Ollama settings

| Option              | What it does                                                                                                                                | Default                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `ai.provider`       | Set to `"ollama"`.                                                                                                                          | `"none"`                 |
| `ai.model`          | Installed vision model name.                                                                                                                | `qwen2.5vl`              |
| `ai.timeoutMs`      | Time limit in milliseconds for each request and for all AI work in one command. Local models can be slow, so raise this on slower machines. | `120000`                 |
| `ai.concurrency`    | Pages analysed at the same time (1 to 8). Lower it if your machine runs out of memory.                                                      | `4`                      |
| `OLLAMA_HOST` (env) | Where Ollama listens.                                                                                                                       | `http://127.0.0.1:11434` |

Budgets, `advisory`, `analyze` and `intent` work the same as with Gemini. See [Control AI policy and cost](/guides/ai-policy-and-budgets/).

## Example: a private design review

Your team cannot send staging screenshots to a cloud service. You install Ollama on a shared GPU machine, pull `qwen2.5vl`, and set `OLLAMA_HOST=http://design-gpu.internal:11434` in each developer's `.env.local`. Runs now explain changes in the report, and no image leaves your network. Because a local model is slower, you set `ai.timeoutMs: 600_000` and `ai.concurrency: 2`.

## Verify the model is really answering

VisualGuard falls back to its own checks when the model fails, so a finished report is not proof. Check that:

1. `doctor` shows the **AI provider** line as OK, not a warning.
2. The test header shows `ai  ollama (…)` with no `AI off` warning.
3. The usage line or **AI work** in the report header shows more than 0 calls.
4. Changed pages show an analysis panel, not an `AI analysis failed` finding.

To go back to checks without AI for one run, add `--no-ai`.

## Troubleshooting

| Problem                                                 | Fix                                                                                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Ollama is not reachable at http://…`                   | Start the Ollama app or `ollama serve`. Check `OLLAMA_HOST`, including the `http://` prefix and port.                                     |
| `Ollama model "…" is not installed. Run: ollama pull …` | Run the `ollama pull` command shown, or set `ai.model` to an installed model.                                                             |
| `AI analysis failed: … aborted` on later pages          | The time limit covers all AI work in one command. Raise `ai.timeoutMs`, or lower the number of changed pages per run.                     |
| Machine freezes or swaps during analysis                | Lower `ai.concurrency` to 1 or 2, or use a smaller vision model.                                                                          |
| Answers look vague or wrong                             | Small models are less accurate than cloud models. Try a larger vision model, or set `ai.advisory: true` so answers never change statuses. |

See [Troubleshooting](/troubleshooting/) for capture and install problems.

## Next steps

- [Control AI policy and cost](/guides/ai-policy-and-budgets/): every `ai` option, budgets and intent.
- [Add Gemini analysis](/guides/ai-gemini/): the cloud option, with the full `analyze` command.
- [Read the HTML report](/guides/reports/): where the analysis appears.
