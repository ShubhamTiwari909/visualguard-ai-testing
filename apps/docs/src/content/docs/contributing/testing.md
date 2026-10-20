---
title: "Contribute and validate focused changes"
description: "Run the smallest meaningful behavior check, add regression fixtures and preserve current check deferrals."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["CONTRIBUTING.md", "evals/README.md", "fixtures/site/README.md"]
sidebar: {"order": 4}
---

## Current sequence policy

Use Node 22.22+ for the full workspace including docs, and pnpm 9. During the current feature sequence, formatting, lint and semantic type checks remain deferred under `AGENTS.md` until after F36 unless the user changes that instruction. The focused examples below exclude those commands. Existing CI definitions may contain them; do not report them as passed in this local work.

Use Node ≥22.12 and the pnpm version declared in the root package manifest. Install dependencies with `pnpm install` and Chromium with `pnpm --filter visualguard exec playwright install chromium`.

## Architecture

The published package lives in `packages/visualguard`. Configuration and discovery feed `core/run.ts`; `capture/` creates screenshots and health signals; `diff/` produces pixel regions; `mapping/` explains DOM changes; `core/comparison.ts` shares classification policy with the Playwright fixture; `ai/` owns structured requests, caching and budgets; `fixer/` proposes and verifies edits; `reporters/` and `report-app/` present the evidence.

Read [reliability changes](/releases/migration/) for invariants and migrations. The older design sketches in `PLAN.md` are historical context, not a current API reference.

## Focused validation

```sh
pnpm --filter visualguard exec vitest run test/reliability.test.ts
pnpm --filter visualguard exec vitest run test/fixer.test.ts test/verification.test.ts
```

Run `pnpm build` when changing package exports or the report bundle. Run `pnpm test` for changes spanning the capture/comparison/fixer interfaces. `pnpm test:pack` checks the installed npm artifact. The Playwright fixture test builds its own package entry and launches Playwright tests.

## Adding a regression fixture

Add matching HTML/assets under `fixtures/site/production` and `fixtures/site/staging`. Keep content deterministic except when deliberately testing noise. Add the expected route/viewport classification to `evals/labels.json`; use an explicit viewport map if a case applies only to mobile. Never remove a detector miss from evaluation based on its output.

Run `pnpm build` followed by `node evals/run.mjs --provider none`. Tests should exercise observable behavior: status/exit policy, source rollback, preserved capture state, or correctly selected reference artifacts. Provider tests should use local mocks; live API keys belong only in controlled evaluation runs.

## Reports and issues

A useful bug report contains the Node/Playwright/VisualGuard versions, browser/platform, expected and actual status, a minimal route or fixture, and a redacted configuration. Share the entire report directory when screenshots are needed. Remove private DOM text, screenshots, source edits, credentials and tokens before public sharing.

## Releases

Use `pnpm changeset` to describe user-visible changes and migrations. CI runs lint/format/type checks, the Node/OS test matrix, browser smoke checks, package smoke tests and heuristic evaluation gates. The changesets release workflow handles versioning/publishing. Do not describe a release as published until publishing is confirmed.

## Evaluation and deterministic fixtures

Measures how well VisualGuard classifies visual differences (PLAN.md §10.8). Each route in
[`labels.json`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/labels.json) is a page in [`fixtures/site`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/../fixtures/site) with a production and
a staging variant; the label is what a reviewer would call the difference:

| Label         | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `regression`  | Broken: misalignment, overlap, clipping, overflow, missing UI |
| `intentional` | A deliberate change: new copy, restyle, new element           |
| `content`     | Data changes: prices, posts, dates                            |
| `noise`       | Rendering differences nobody would notice                     |

Every route runs at desktop and mobile, so the labels give about 40 cases.

```bash
pnpm eval                                       # heuristics only (the baseline)
pnpm eval -- --provider gemini                  # needs GEMINI_API_KEY
pnpm eval -- --provider gemini --model <id>
pnpm eval -- --provider ollama --model qwen2.5vl
```

The runner prints precision and recall per class, a confusion matrix and the misses, and saves the
results to `evals/results/`. Run it before changing prompts or default models. The 1.0 target is
regression precision ≥ 0.85 and recall ≥ 0.90 on the default Gemini model.

Without AI, statuses stand in for classes (regression → regression, review → intentional,
pass → noise), so heuristics can never score on `content`.

## Evaluation contract and gates

Applicability comes from labels, never from the detector result. An unexpected `pass` stays in the denominator; a missing/errored capture is scored as an error. Results separate hybrid policy precision/recall/false-green rate from model-only classification accuracy, and include sample size, fallback count, dataset/prompt versions, and confidence calibration bins.

After building, run deterministic quality gates with:

```sh
node evals/run.mjs --provider none --min-regression-recall 0.6 --min-regression-precision 0.85
node evals/run.mjs --provider gemini --all-ai --min-regression-recall 0.9 --min-regression-precision 0.85
```

Heuristic gates run in PR CI. Gemini evaluation runs weekly/manually when a secret is available; otherwise that workflow runs the heuristic baseline. The targets are thresholds to test, not a claim of measured live model performance. All applicable cases remain scored even when AI is skipped or a budget is reached. Confidence bins expose calibration and should guide changes to `noiseConfidence`; do not equate self-reported confidence with probability.

## Included site fixtures

Static pages used by VisualGuard's integration tests and evals. Every page exists in a
`production/` and a `staging/` variant. The fixture server (`packages/visualguard/test/helpers/fixture-server.ts`)
serves `/name` from `name.html` and replaces `{{origin}}` in `.xml` and `.txt` files.

| Page                                    | Difference on staging                       | Expected without AI                      |
| --------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| `/` `/identical` `/pricing` `/checkout` | none                                        | pass                                     |
| `/animated`                             | none (infinite animation + transition)      | pass                                     |
| `/dynamic`                              | random price (masked) and clock (frozen)    | pass                                     |
| `/dynamic-change`                       | random price (not masked) + CTA colour      | review: only the CTA (noise map)         |
| `/a11y`                                 | image `alt` and button label removed        | pass (with `--a11y`: review)             |
| `/heavy`                                | 60 KB script added, same pixels             | pass (with `--perf`: review)             |
| `/marked-dynamic`                       | random text marked `data-visualguard-ignore` | pass                                    |
| `/text-change`                          | CTA copy "Start free trial" → "Start trial" | review: text change on the CTA           |
| `/color-change`                         | CTA background colour                       | review: background-color on the CTA      |
| `/alignment`                            | `align-items: center` → `flex-start`        | review: align-items on `div.actions`     |
| `/spacing`                              | feature card padding 24px → 12px            | review: padding on `div.card`            |
| `/layout-shift`                         | banner inserted above the hero              | review: one shift caused by the banner   |
| `/missing-image`                        | image points to a missing file              | regression: broken image                 |
| `/overflow`                             | promo box wider than a 390px viewport       | regression on mobile: horizontal overflow |
| `/overlap`                              | badge moved on top of the hero              | regression: new overlap                  |
| `/hidden`                               | CTA hidden                                  | regression: control missing              |
| `/contrast`                             | paragraph text turned light grey            | regression: low contrast                 |
| `/clipped`                              | CTA narrowed, text cut off                  | regression: text cut off                 |
| `/misaligned-grid`                      | one card pushed down 28px                   | review (AI: regression)                  |
| `/wrapped-nav`                          | larger nav links wrap the header            | review (AI: regression)                  |
| `/font-size`                            | bigger heading                              | review (AI: intentional)                 |
| `/nav-item`                             | new "Blog" link                             | review (AI: intentional)                 |
| `/rounded`                              | rounder cards and pill buttons              | review (AI: intentional)                 |
| `/button-style`                         | uppercase dark buttons                      | review (AI: intentional)                 |
| `/price`                                | $49 → $59                                   | review (AI: content)                     |
| `/blog-list`                            | different posts                             | review (AI: content)                     |
| `/footer-year`                          | © 2025 → © 2026                             | review (AI: content)                     |
| `/subpixel`                             | text nudged 0.4px                           | review (AI: noise)                       |

Labels for AI evals are in [`evals/labels.json`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/../../evals/labels.json).
