---
title: "Control AI policy and cost"
description: "Choose which pages the AI sees, whether it may change statuses, how much it may spend and how long answers are cached."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/ai/analyze-job.ts", "packages/visualguard/src/ai/budget.ts", "packages/visualguard/src/ai/cache.ts", "packages/visualguard/src/ai/tasks/analyze-diff.ts", "packages/visualguard/src/config/resolve.ts"]
sidebar: {"order": 11}
---

This page explains every `ai` setting in `visualguard.config.ts`. Use it to decide three things: what the AI is allowed to change, how much it may spend, and what context it gets. Set these before you turn AI on in CI, so a busy pull request cannot run up an unexpected bill.

## Before you start

- Set up a provider first: [Gemini](/guides/ai-gemini/) or [Ollama](/guides/ai-ollama/).
- Know the four page statuses (pass, review, regression, error). See [Understand results](/concepts/results/).
- All options below go inside the `ai: { ... }` object of your existing `defineConfig({ ... })`.

## How the AI fits into a run

VisualGuard always decides a status first, using its own pixel, DOM and health checks. This is the **base status**. It does not depend on AI.

Then, for each changed page that qualifies, VisualGuard sends one request to the model. A page qualifies when it has changed pixels, has saved crops of the changed regions, has no capture error, is not already **pass** and is not **accepted**. With the default `analyze: "uncertain"`, pages whose base status is **regression** are skipped too, because the model cannot change that status.

The model's answer is then combined with the base status:

| Base status or finding | Model says | Final status |
| --- | --- | --- |
| **regression**, or any finding with severity regression | anything | **regression** (never downgraded) |
| **review** | `regression` | **regression** |
| **review** | `intentional` or `content` | **review** |
| **review** | `noise`, confidence at or above `noiseConfidence` | **pass** |
| **review** | `noise`, but a health check also asked for review | **review** |
| **review** | `noise`, confidence below `noiseConfidence` | **review** |
| any | anything, with `advisory: true` | base status unchanged |

AI failures never fail a run. When a request fails or a limit is reached, the page keeps its base status and gets an info finding that explains why.

## All AI options

| Option | What it does | Default |
| --- | --- | --- |
| `provider` | `"gemini"`, `"ollama"` or `"none"`. The `--provider` flag and `VISUALGUARD_AI_PROVIDER` override it. | `"none"` |
| `model` | Model ID. Dropped when the provider is switched by flag or environment variable. | `gemini-flash-latest` (Gemini), `qwen2.5vl` (Ollama) |
| `analyze` | `"uncertain"` skips pages that are already regressions. `"all"` also sends them, to get an explanation and suggested fix. | `"uncertain"` |
| `advisory` | `true` attaches the analysis but never changes a status. | `false` |
| `noiseConfidence` | Minimum model confidence (0 to 1) for a `noise` answer to become **pass**. | `0.8` |
| `maxRegionsPerJob` | Changed regions shown to the model per page (1 to 10). A layout-shift region goes first, then the largest. | `3` |
| `thinking` | Gemini only. `"off"`, `"low"` or `"default"`. More thinking costs more output tokens and time. | `"low"` |
| `imageDetail` | Gemini only. `"low"`, `"medium"` or `"high"`. `"high"` uses about four times the tokens of `"medium"`. | `"medium"` |
| `concurrency` | Pages analysed at the same time (1 to 8). Captures keep running while the model works. | `4` |
| `maxCallsPerRun` | Pages sent to the model in one command. Cached answers do not count. | `30` |
| `maxGenerationAttempts` | Model answers requested, including the one repair attempt when an answer has the wrong format. | `60` |
| `maxNetworkAttempts` | Outgoing requests, including automatic retries after rate limits or network errors. | `120` |
| `maxTokens` | Input plus output tokens. Gemini thinking tokens count as output. | `200000` |
| `timeoutMs` | Time limit in milliseconds for each request, and for all AI work in one command. | `120000` |
| `cacheTTLHours` | How long a cached answer stays valid. | `24` |
| `intent` | Optional description of the change you meant to make. See [Describe the intended change](#4-describe-the-intended-change). | none |

## 1. Choose who decides the status

Pick one of two policies.

**Let the AI help decide (default).** The model can turn a review into a regression, or turn confident noise into a pass. This saves the most review time.

```ts
ai: {
  provider: "gemini",
  advisory: false,
  noiseConfidence: 0.8,
},
```

**Explanations only.** Statuses stay exactly as VisualGuard's own checks decided. Use this when your team must be able to reproduce every verdict without a model, or while you build trust in the answers.

```ts
ai: {
  provider: "gemini",
  advisory: true,
},
```

You should see analysis panels in the report either way. With `advisory: true`, the summary counts match a run with `--no-ai`.

:::note
The model's confidence is its own estimate, not a measured probability. Raise `noiseConfidence` (for example to `0.9`) if you see real changes passing as noise.
:::

## 2. Choose which pages the AI sees

```ts
ai: {
  provider: "gemini",
  analyze: "all",       // also explain pages that are already regressions
  maxRegionsPerJob: 3,
},
```

`"uncertain"` is cheaper. `"all"` costs more, but every regression in the report gets a likely cause and a suggested fix. [`visualguard fix`](/guides/fixes/) can use those explanations.

The `analyze` command always looks at every changed page, including regressions, whatever this option says.

## 3. Set a budget

Budgets stop AI work early instead of letting it grow with the number of changed pages. When a limit is reached, the remaining pages keep their base status.

```ts
ai: {
  provider: "gemini",
  maxCallsPerRun: 20,
  maxGenerationAttempts: 40,
  maxNetworkAttempts: 80,
  maxTokens: 150_000,
  timeoutMs: 180_000,
},
```

What each limit stops:

| Limit reached | Message on the page | Effect |
| --- | --- | --- |
| `maxCallsPerRun` | `AI budget reached (ai.maxCallsPerRun); explained by heuristics only` | Later pages skip AI. |
| `maxGenerationAttempts` | `AI generation-attempt budget reached` | AI stops for the rest of the command. Later pages show `AI skipped: …`. |
| `maxNetworkAttempts` | `AI network-attempt budget reached` | AI stops for the rest of the command. |
| `maxTokens` | `AI token budget reached` | AI stops for the rest of the command. |
| `timeoutMs` | `AI analysis failed: …` (aborted) | Requests still waiting are cancelled. |

Things to know about budgets:

- **They add up across commands for the same run.** `test`, `analyze`, `fix` and the report's **Generate fix** share the saved token and attempt totals in the run folder (`ai-usage.json`). If `test` used most of `maxTokens`, a later `analyze` of that run stops early.
- **`maxCallsPerRun` and `timeoutMs` start fresh for each command.** The time limit starts when the command sets up AI, so on a long run with many pages, raise it.
- **A request in progress can go over `maxTokens`.** The token check happens before each request, not during it.
- **Some failed requests report no usage**, so the saved totals can be lower than your provider's bill.

You should see the totals at the end of the terminal output (`AI: … · N calls · … tokens in / … out`) and under **AI work** in the report header (analyses, generations, requests, input and output tokens).

## 4. Describe the intended change

`intent` tells the model what you meant to change. It helps the model tell a deliberate restyle from an accident.

```ts
ai: {
  provider: "gemini",
  intent: {
    title: "Update pricing copy",
    description: "Only the plan descriptions change. Layout and checkout buttons should stay the same.",
    changedFiles: ["app/pricing/page.tsx"],
  },
},
```

| Field | Limit | Required |
| --- | --- | --- |
| `title` | Up to 200 characters. | Yes, when `intent` is set. |
| `description` | Up to 2000 characters. | No |
| `changedFiles` | Up to 50 paths, each up to 300 characters. | No (default `[]`) |

The model is told to treat this text as evidence, never as instructions. A claimed intent does not excuse a visible defect: a broken layout is still a regression, and VisualGuard's own regressions are never downgraded. The intent is saved with each analysis in the run, so reviewers can see what the model was told.

:::tip
Set `intent` from your pull request title in CI by building the config value from an environment variable, for example `title: process.env.PR_TITLE ?? "No description"`. Keep it short and factual.
:::

## 5. Control the cache

VisualGuard caches each answer in `.visualguard/cache/ai` (inside your output folder). The cache key covers the provider, model, prompt version, `thinking`, `imageDetail`, the exact images, the page text and the `intent`. If any of these change, the model is asked again.

- Answers expire after `cacheTTLHours` (default 24).
- Corrupt or unreadable cache entries are ignored and replaced.
- A cached answer shows `· cached` next to the model name in the report, and does not count toward `maxCallsPerRun`.

To ignore the cache for one re-analysis:

```bash
npx --no-install visualguard analyze --run 12 --no-cache
```

You should see the summary report more AI calls and fewer `cached or skipped` pages than before.

## What is sent to the provider

For each analysed page: up to `maxRegionsPerJob` image crops (production, staging and diff), the route and viewport, the changed share of pixels, layout shift and page sizes, console error and failed request counts, VisualGuard's findings, element selectors and text, DOM changes, and `intent` if set. Full-page screenshots, your config and your source code are not sent during analysis. [Fix proposals](/guides/fixes/) can send source excerpts, but only with your consent.

## Example: a CI budget for pull requests

Your app has 40 routes and 2 viewports. Most pull requests change a few pages, but a global CSS change can touch all 80. You want AI help without surprises:

```ts
ai: {
  provider: "gemini",
  model: "your-pinned-model-id", // repeatable results
  advisory: false,
  analyze: "uncertain",
  maxCallsPerRun: 25,
  maxTokens: 150_000,
  timeoutMs: 300_000,
},
```

On a small change, every changed page gets an analysis. On a global change, the first 25 changed pages get an analysis and the rest show `AI budget reached (ai.maxCallsPerRun)`. The run still finishes and still fails on real regressions.

## Check your policy

1. Set `maxCallsPerRun: 1` and run a test with at least two changed pages. You should see one analysed page and one `AI budget reached` finding.
2. Turn on `advisory: true` and compare the summary with a `--no-ai` run of the same pages. The pass, review and regression counts should match.
3. Open the report and check **AI work** in the header for the token totals.
4. Confirm no API key appears in `visualguard.config.ts`, the report or `ai-usage.json`.

Restore your normal values afterwards.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `analyze` stops almost at once with a token or attempt budget message | The run's earlier commands already used the budget. Raise the limit, or analyze a new run. |
| Real changes pass as noise | Raise `noiseConfidence`, or set `advisory: true`. |
| Later pages show `AI analysis failed: … aborted` | `timeoutMs` covers all AI work in one command. Raise it, or lower `concurrency` for slow local models. |
| Changing `intent` or the model did not change the answer | It should create a new cache key. Run `analyze --no-cache` to be sure. |
| Bill is higher than the saved totals | Some failed requests return no usage data. Use your provider's dashboard as the source of truth. |
| Config error about `intent` when a command starts | `title` is required and limited to 200 characters; `changedFiles` holds at most 50 paths. |

See [Troubleshooting](/troubleshooting/) for other problems.

## Next steps

- [Add Gemini analysis](/guides/ai-gemini/): keys, models and the `analyze` command.
- [Use a local Ollama model](/guides/ai-ollama/): AI without sending screenshots away.
- [Propose and verify fixes](/guides/fixes/): use explanations to repair regressions.
- [Configuration reference](/reference/configuration/): every config option in one place.
