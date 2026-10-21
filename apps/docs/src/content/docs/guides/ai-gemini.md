---
title: "Add Gemini analysis"
description: "Create a Gemini API key, turn on AI analysis, read the explanations in the report and confirm the model really answered."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/ai/factory.ts",
    "packages/visualguard/src/ai/providers/gemini.ts",
    "packages/visualguard/src/ai/tasks/analyze-diff.ts",
    "packages/visualguard/src/cli/commands/analyze.ts",
    "packages/visualguard/src/cli/commands/doctor.ts",
    "examples/nextjs/GEMINI-SCREENSHOT-TESTING.md",
  ]
sidebar: { "order": 9 }
---

This page shows how to connect Google's Gemini models to VisualGuard. With Gemini on, every changed page gets a short explanation: what changed, whether it looks like a bug, the likely cause and a suggested fix. Use it when the plain pixel and DOM checks leave too many pages in **review** and you want help sorting them.

AI is optional. VisualGuard always runs its own checks first, and a test never fails because Gemini was unavailable.

## Before you start

- Finish [Run your first visual test](/start/quickstart/) so you have a working `visualguard.config.ts`.
- Keep both application versions (production and staging) running.
- Have a Google account for [Google AI Studio](https://aistudio.google.com/app/apikey).
- Run every command from your app's root folder, where `visualguard.config.ts` lives.

If your screenshots are confidential, read [What is sent to Google](#what-is-sent-to-google) first, or use a [local Ollama model](/guides/ai-ollama/) instead.

## What Gemini adds

Without AI, VisualGuard finds the changed areas of a page, matches them to DOM elements and reports style, text, size and presence changes. Clear defects such as a missing control, clipping, overflow, low contrast or a broken image become **regression**. Most other changes become **review**.

With Gemini on, each changed page that is not already a regression is sent to the model. The model returns:

| Field             | What it means                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Classification    | One of `regression`, `intentional`, `content` (data such as prices or dates) or `noise` (anti-aliasing, font rendering). |
| Model confidence  | A number from 0 to 1. It is the model's own estimate, not a measured probability.                                        |
| Title and summary | One line for lists, and a short explanation.                                                                             |
| Likely cause      | What probably caused the change, when the model can tell.                                                                |
| Affected elements | Selectors from the captured page. VisualGuard drops any selector the page does not contain.                              |
| Suggested fix     | For regressions, a description and sometimes a small CSS or class diff.                                                  |

The classification can change the page status:

| Model says                            | Resulting status                                      |
| ------------------------------------- | ----------------------------------------------------- |
| `regression`                          | **regression**                                        |
| `intentional` or `content`            | **review**                                            |
| `noise` with confidence 0.8 or higher | **pass**, unless a health check also asked for review |
| `noise` below 0.8                     | **review**                                            |

Gemini can never turn a VisualGuard regression into a pass. To keep every status exactly as the deterministic checks decided, set `ai.advisory: true` (see [Control AI policy and cost](/guides/ai-policy-and-budgets/)).

## What is sent to Google

For each changed page, VisualGuard sends one request with:

- Up to 3 changed regions (`ai.maxRegionsPerJob`). For each region it sends three cropped images: production, staging and a diff image with changes in red. Each crop is scaled down so its longest side is at most 1024 pixels.
- Text about the page: route, viewport, share of changed pixels, any layout shift, page sizes, counts of console errors and failed requests, and VisualGuard's own findings.
- For each region: element selectors, short element text and the DOM changes (old and new style values, text, position and size).
- Your change description, if you set `ai.intent`.

VisualGuard does not send full-page screenshots, cookies, your config file or source code during analysis. [Fix proposals](/guides/fixes/) can send source excerpts, but only after you agree.

:::caution
On Google's free (unpaid) tier, Google may use submitted content to improve its products. That includes screenshots of unreleased staging pages. For confidential work, use a paid key or [Ollama](/guides/ai-ollama/), and check Google's current terms.
:::

## 1. Create an API key

Open [Google AI Studio](https://aistudio.google.com/app/apikey) and create an API key. Google's own steps are in the [Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key).

You should see a long key string. Copy it; you will store it in the next step.

## 2. Store the key outside your config

VisualGuard reads the key from the `GEMINI_API_KEY` environment variable. It also accepts `GOOGLE_API_KEY` when `GEMINI_API_KEY` is not set.

For local work, put it in `.env.local` in your app's root folder:

```dotenv
GEMINI_API_KEY=your-gemini-api-key
```

Make sure `.env.local` is listed in `.gitignore`. VisualGuard loads `.env` and then `.env.local` on every command. A variable that is already set in your shell wins over both files.

In CI, store the key as a secret and expose it as `GEMINI_API_KEY` to the step that runs VisualGuard. The key is needed only on the machine that runs the test, not in the dashboard.

:::caution
Never put the key in `visualguard.config.ts` and never commit it. Avoid typing it inline on a shared machine, because shell history can keep it.
:::

## 3. Turn Gemini on

You can turn Gemini on for every run, or for one run only.

**For every run**, set the provider in `visualguard.config.ts`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing baseURL, routes and viewports
  ai: {
    provider: "gemini",
  },
});
```

**For one run**, pass `--provider gemini` to `test`:

```bash
npx --no-install visualguard test --provider gemini
```

You can also set `VISUALGUARD_AI_PROVIDER=gemini` in the environment. When more than one is set, the order is: `--provider` flag, then `VISUALGUARD_AI_PROVIDER`, then `ai.provider` in the config. The config default is `none`.

:::note
A model ID belongs to one provider. If you switch provider with the flag or the environment variable, VisualGuard ignores the `ai.model` from your config and uses the new provider's default, unless you also pass `--model`.
:::

## 4. Check the connection

Run `doctor` before your first AI run:

```bash
npx --no-install visualguard doctor
```

You should see an **AI provider** line that reads `gemini (gemini-flash-latest)`. `doctor` asks Google for the models your key can use, so this also proves the key works.

If the line is a warning instead, it tells you what is wrong: a missing key, or a model your key cannot use (with a list of models it can use).

## 5. Run a test with Gemini

```bash
npx --no-install visualguard test
```

You should see:

- In the header, the line `ai  gemini (gemini-flash-latest)`. If it says `off (heuristics only)`, Gemini is not active.
- For regressions with an explanation, an **AI ANALYSIS** block after the results, with the classification, model confidence, cause, affected elements and suggested fix.
- A usage line at the end, for example `AI: gemini-flash-latest · 3 calls · 18.2k tokens in / 1.4k out`.

Then open the report:

```bash
npx --no-install visualguard report
```

On a changed page, the analysis panel shows the model confidence, the provider and model (with `· cached` when the answer came from the cache) and, when Google returns it, the exact **Model revision**. The report header shows the provider under **AI** and the totals under **AI work**.

## 6. Pick a model

The default model is `gemini-flash-latest`. It is a moving alias: Google points it at its current Flash model, so the model can change without any change on your side. For repeatable CI results, pin a specific model ID that your key can use:

```ts
ai: {
  provider: "gemini",
  model: "your-pinned-model-id",
},
```

Or for one run:

```bash
npx --no-install visualguard test --provider gemini --model your-pinned-model-id
```

Run `doctor` after changing the model. If your key cannot use it, `doctor` lists up to six Gemini models that it can use.

## Gemini settings

These `ai` options matter most for Gemini. The full list, with budgets and the cache, is in [Control AI policy and cost](/guides/ai-policy-and-budgets/).

| Option        | What it does                                                                                                                                                                 | Default               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `provider`    | `"gemini"`, `"ollama"` or `"none"`.                                                                                                                                          | `"none"`              |
| `model`       | Gemini model ID.                                                                                                                                                             | `gemini-flash-latest` |
| `thinking`    | How much the model reasons before answering: `"off"`, `"low"` or `"default"` (the model's own setting). Thinking is billed as output tokens and is most of each call's time. | `"low"`               |
| `imageDetail` | Tokens spent per image: `"low"`, `"medium"` or `"high"`. `"high"` costs about four times `"medium"`.                                                                         | `"medium"`            |
| `analyze`     | `"uncertain"` skips pages VisualGuard already marked as regressions. `"all"` also explains those pages.                                                                      | `"uncertain"`         |
| `advisory`    | `true` adds explanations without changing any status.                                                                                                                        | `false`               |
| `timeoutMs`   | Time limit, in milliseconds, for each request and for all AI work in one command.                                                                                            | `120000`              |

If a model rejects a `thinking` or `imageDetail` setting, VisualGuard retries without it and remembers that for the rest of the run.

## Re-analyze a saved run

`analyze` runs AI on a run you already captured, without opening a browser again. Use it after you add a key, change the model, or change `thinking` or `imageDetail`.

```bash
# Latest run, using the provider in your config
npx --no-install visualguard analyze

# A specific run, with Gemini, ignoring cached answers
npx --no-install visualguard analyze --run 12 --provider gemini --no-cache
```

You should see `Analyzing N changed pages from run #12 with gemini (model)`, one line per page, and a summary such as `2 passed · 1 review · 1 regression · 0 errors · 3 AI calls (1 cached or skipped)`. The run's manifest and HTML report are updated in place.

| Flag                  | What it does                                                           | Default                 |
| --------------------- | ---------------------------------------------------------------------- | ----------------------- |
| `--run <id>`          | Run ID, ID prefix or run number.                                       | Latest run              |
| `--provider <name>`   | `gemini` or `ollama`.                                                  | From config             |
| `--model <id>`        | Model ID.                                                              | Provider default        |
| `--no-cache`          | Ask the model again instead of reusing cached answers.                 | Cache on                |
| `--only <glob>`       | Analyze only matching routes. Repeat for more.                         | All routes              |
| `--fail-on <level>`   | What makes the exit code non-zero: `regression`, `review` or `any`.    | `regression`            |
| `--ci`                | No colours.                                                            | Off                     |
| `--json`              | Print the updated manifest as JSON on stdout. Progress goes to stderr. | Off                     |
| `-c, --config <path>` | Config file path.                                                      | `visualguard.config.ts` |

`analyze` looks at every changed page, including pages already marked as regressions, whatever `ai.analyze` says. It needs a provider: with no provider set, it stops with `No AI provider is configured`. Usage from earlier analysis of the same run counts toward the same budgets.

## When Gemini cannot answer

AI problems never fail a run. The page keeps the status VisualGuard decided, and the reason is saved as an info finding on the page.

| Message                                                                 | What happened                                                      | What VisualGuard does                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `AI off: GEMINI_API_KEY is not set; using heuristics only`              | No key was found.                                                  | Runs without AI.                                                 |
| `Gemini rejected the API key (check GEMINI_API_KEY)`                    | The key is wrong or has no access.                                 | Stops AI for the rest of the run.                                |
| `Gemini model "…" is not available; set ai.model to a current model id` | The model ID is unknown to your key.                               | Stops AI for the rest of the run.                                |
| `Gemini quota used up …; it resets in …`                                | A daily quota ran out, or Google asked to wait more than a minute. | Stops AI for the rest of the run.                                |
| `Gemini rate limit reached`                                             | A short rate limit.                                                | Retries, up to 4 attempts per request, waiting up to 60 seconds. |
| `AI skipped: …`                                                         | An earlier page hit one of the stopping errors above.              | Skips AI for later pages.                                        |
| `AI budget reached (ai.maxCallsPerRun); explained by heuristics only`   | The call limit was used up.                                        | Skips AI for later pages.                                        |

If the model returns an answer that does not match the expected format, VisualGuard asks once more with a correction note before giving up on that page.

## Cost notes

- Each changed page costs at most one model call, plus one repair call if needed. Pages that pass, accepted pages and pages with errors cost nothing.
- Identical requests are answered from a local cache in `.visualguard/cache/ai` for 24 hours.
- `thinking: "low"` and `imageDetail: "medium"` are already the cheaper settings. `"off"` and `"low"` reduce cost further.
- Set limits with `maxCallsPerRun`, `maxTokens` and the attempt budgets before you run in CI. See [Control AI policy and cost](/guides/ai-policy-and-budgets/).

## Example: sort a noisy pricing page

Your staging build changes the pricing copy, and a font update makes text edges render a little differently. Without AI, `/pricing` lands in **review** for both reasons. With Gemini on, the text change comes back as `intentional` (still **review**, for a person to confirm), while a separate page that only has font smoothing differences comes back as `noise` with confidence 0.9 and becomes **pass**. A missing checkout button stays a **regression**, and the AI ANALYSIS block suggests restoring the button.

## Verify Gemini is really answering

A finished report does not prove Gemini answered, because VisualGuard falls back to its own checks. Check all of these:

1. `doctor` shows `gemini (…)` on the **AI provider** line, not a warning.
2. The test header shows `ai  gemini (…)`, with no `AI off` warning.
3. The final usage line, or **AI work** in the report header, shows more than 0 calls and tokens.
4. A changed page shows an analysis panel with a classification and model confidence, not an `AI analysis failed` finding.

Also confirm the key does not appear in `visualguard.config.ts`, the report or your Git history.

## Troubleshooting

| Problem                                                       | Fix                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Header says `off (heuristics only)`                           | Set `ai.provider: "gemini"` or pass `--provider gemini`. Removing `--no-ai` alone does not turn AI on.                                 |
| `GEMINI_API_KEY is not set`                                   | Add the key to `.env.local` in the folder you run commands from, or export it in the shell. In CI, map the secret to `GEMINI_API_KEY`. |
| `Gemini rejected the API key`                                 | Create a new key in AI Studio and replace the old one. Check for extra spaces or quotes.                                               |
| `model "…" is not available`                                  | Run `doctor` to see the models your key can use, then set `ai.model` or `--model`.                                                     |
| `quota used up`                                               | Wait for the reset time shown, use a paid key, or lower `maxCallsPerRun`.                                                              |
| Pages show `AI analysis failed: … aborted` late in a long run | `timeoutMs` covers all AI work in one command. Raise it, or analyze afterwards with `analyze`.                                         |
| Analysis did not change after editing settings                | Cached answers are reused. Run `analyze --no-cache`.                                                                                   |

See [Troubleshooting](/troubleshooting/) for capture and install problems.

## Next steps

- [Control AI policy and cost](/guides/ai-policy-and-budgets/): every `ai` option, budgets, intent and the cache.
- [Use a local Ollama model](/guides/ai-ollama/): keep screenshots on your own machine.
- [Propose and verify fixes](/guides/fixes/): let VisualGuard repair regressions it found.
- [Read the HTML report](/guides/reports/): where the analysis appears.
