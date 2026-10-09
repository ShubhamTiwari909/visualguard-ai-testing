# VisualGuard: Project Plan

> **An AI visual regression agent, shipped as an npm CLI.**
> It compares production against staging, explains every visual difference, and can fix regressions if you opt in.

|                  |                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **Status**       | Phases 0–8 and 10 built, Phase 9 partly done; 1.0.0 published to npm, 1.1.0 pending. See the status section below |
| **Package name** | `visualguard` (published 2026-10-08)                                                             |
| **Stack**        | TypeScript · Node ≥ 22 · Playwright · pixelmatch · Gemini (`@google/genai`) · Ollama             |
| **Shape**        | One published npm package. The pnpm workspace also holds examples, fixtures, evals and docs      |
| **Last updated** | 2026-10-09                                                                                       |

---

## Implementation status (2026-10-08)

Phases 0–8 are built and committed, and Phase 9 is partly done. The package is at **0.7.0** and
not published to npm.

| Phase | Status | Version | Notes |
| ----- | ------ | ------- | ----- |
| 0 Foundation | Done | — | The npm name isn't reserved yet: that needs your npm account |
| 1 Capture & diff | Done | — | Determinism checked 10× per OS in CI; stable on nextjs.org |
| 2 Setup & zero-config | Done | 0.1.0 | `init` was checked through a real pseudo-terminal |
| 3 HTML report | Done | 0.2.0 | Accessibility is checked with axe (no serious or critical violations, light and dark), instead of Lighthouse |
| 4 DOM mapping & heuristics | Done | 0.2.0 | Every fixture's explanation names the right element and property |
| 5 AI analysis | Built; not measured live | 0.3.0 | There was no `GEMINI_API_KEY` or Ollama here. Providers are tested against fake Gemini/Ollama servers. Heuristics-only baseline: regression precision 100%, recall 65% |
| 6 CI & GitHub | Done | 0.4.0 | PR comment tested against a fake GitHub API |
| 7 Interactive fix | Done | 0.5.0 | `examples/nextjs`: three seeded regressions fixed and verified at 0 differing pixels |
| 8 Auto fix, watch, baselines | Done | 0.6.0 | `--auto --pr` tested with a local bare origin and a fake GitHub API |
| 9 Hardening | Partly done | 0.7.0 | Done: Playwright fixture, GitHub Action, `auth`, custom reporters. Not done: Firefox/WebKit testing, the odiff engine, the docs site, OpenAI/Anthropic providers |
| 10 Fewer false positives, cheaper AI, monitoring | Done | 1.1.0 | See "Phase 10" below |

### Phase 10 (2026-10-09): after the first real-project run

Driven by the first real use (examples/nextjs runs 10–12 with Gemini): AI was ~90% of run time,
and Gemini called seeded regressions "deliberate" because it only sees pixels.

| Change | What it does |
| ------ | ------------ |
| AI cost and speed | `ai.thinking` (default `low`; thinking level for Gemini 3, budget for 2.5, fallback when refused), `ai.imageDetail` (default `medium` media resolution), `ai.analyze: "uncertain"` skips pages already marked regressions, `ai.concurrency` 2 → 4. Thinking tokens are counted as output. Daily-quota 429s and bad keys fail at once and stop AI for the rest of the run (the SDK retried 4× per page). Not yet measured live: the free-tier quota (20 requests/day) was used up |
| Noise map | When a page differs, the reference side is captured again; areas that differ between the two loads are grown to their DOM element and left out of the diff (blue in the diff image). Skipped above `diff.noiseMapMaxRatio` (25%) |
| `data-visualguard-ignore` | Masks (or with `="hide"` hides) marked elements in every capture path, including the Playwright fixture |
| Similar acceptance | Accepted entries store a change fingerprint (DOM deltas, region boxes and pixel counts, shift, size); `output.acceptMatch: "similar"` (default) accepts the same change after a re-render. Never hides new health regressions |
| `--shard i/n` + `merge` | Round-robin split by sorted job id; `visualguard merge` copies the shard runs into one run and replays it through the reporters |
| `visualguard monitor` | Live site vs its previous capture; snapshots roll forward except regressions; health compared with the stored snapshot; `--workflow` writes a nightly GitHub Actions workflow using the Actions cache; webhook payload has a Slack-ready `text` |
| `checks.accessibility` / `checks.performance` | axe-core and performance-timeline metrics on both sides; only new violations and worse metrics are reported (review by default). The real `performance.getEntriesByType` is saved before Playwright's fake clock replaces it |

Next: measure the AI changes live once the quota resets, and give the AI the PR's intent (title,
description, changed files) so it can tell deliberate changes from accidental ones.

**Where the implementation differs from this plan:**

- **Build tool:** tsup instead of tsdown, because tsdown 0.23 needs Node ≥ 22.18 and this machine has 22.14.
- **Config loading:** jiti plus Node's `util.parseEnv` instead of c12, which means fewer dependencies.
- **One browser context per capture.** Playwright's clock belongs to the context, so pausing it for one page froze any other page sharing that context.
- **Clock pausing for JavaScript animations.** CSS overrides can't stop them, so each capture pauses the page clock before the screenshot (§7).
- **Scrollbar hiding.** The `::-webkit-scrollbar` rule is dropped because it made full-page shots unstable; scrollbars are hidden through CDP instead.
- **Report location.** The report is `index.html` at the root of each run directory, so upload the whole run directory as the artifact.
- **Additions beyond the plan:**
  - low-contrast and cut-off-text heuristics
  - class-list restoration as a deterministic fixer (Tailwind colours compute to `oklch`)
  - lab/oklch colours shown as hex
  - a `comment` command separate from `test`
  - accepted changes keyed by the hashes of both screenshots
- **Example ports:** the Next.js example uses ports 3100/3101, because 3000/3001 are often taken.

**Still needed for 1.0:**

- **Live AI evals:** `pnpm eval -- --provider gemini` with a key, against the target of regression precision ≥ 0.85 and recall ≥ 0.90.
- **Real-world adoption:** two real projects running it in CI.
- **Publishing:** publish to npm (set up trusted publishing for the Release workflow).
- **Schemas:** freeze the config and manifest schemas.

## Contents

1. [Vision and scope](#1-vision-and-scope)
2. [Principles](#2-principles)
3. [User experience](#3-user-experience)
4. [Tech stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [Configuration](#6-configuration)
7. [Capture engine](#7-capture-engine)
8. [Diff engine](#8-diff-engine)
9. [DOM mapping and style deltas](#9-dom-mapping-and-style-deltas)
10. [AI layer](#10-ai-layer)
11. [HTML report](#11-html-report)
12. [CI and GitHub](#12-ci-and-github)
13. [Fixer](#13-fixer)
14. [Watch mode and baselines](#14-watch-mode-and-baselines)
15. [Security and privacy](#15-security-and-privacy)
16. [Repository structure](#16-repository-structure)
17. [Testing strategy](#17-testing-strategy)
18. [Release and distribution](#18-release-and-distribution)
19. [Roadmap](#19-roadmap)
20. [Risks](#20-risks)
21. [Open decisions](#21-open-decisions)
22. [Next steps](#22-next-steps)
23. [Appendices](#appendices)

---

## 1. Vision and scope

### The problem

Visual regressions get through code review because a PR diff shows code, not pixels. Screenshot tools can tell you that pixels changed. They can't tell you why, whether it matters, or how to fix it. Teams end up with too many false positives and switch the checks off.

### The product

VisualGuard is a CLI that does six things:

1. **Captures** the same routes on two environments (production and staging/preview) with Playwright, and gets the same image every time when nothing has changed.
2. **Diffs** the screenshots pixel by pixel and groups the changed pixels into regions.
3. **Maps** each region to the DOM elements and CSS properties that changed.
4. **Explains** each change with AI, using Gemini in the cloud or Ollama on your machine. Every change is classified as a regression, an intentional change, a content difference, or noise.
5. **Reports** in the terminal, in an interactive HTML report, and on GitHub PRs.
6. **Fixes** regressions if you opt in. It generates a patch, applies it, and checks visually that the patch worked.

### v1.0 goals

- `npm i -D visualguard && npx visualguard init && npx visualguard test` takes under 5 minutes on a Next.js or React app.
- It is **useful without any AI**: the pixel diff plus DOM/style explanations are enough to act on.
- Runs are repeatable: testing an unchanged site produces zero diffs.
- CI is fully supported: exit codes, a GitHub job summary, and a sticky PR comment.
- There are two AI providers, Gemini and Ollama.
- There is an interactive `fix` command that checks its patches visually. It is off unless you turn it on.

### Non-goals for v1

- A hosted SaaS, accounts, or cloud storage for screenshots.
- n8n or any other workflow engine as a dependency. Integrations go through a generic webhook reporter instead (§12.7).
- Testing every browser by default. Chromium comes first; Firefox and WebKit become config options later.
- Component-level snapshot tests (Storybook, Playwright CT). v1 works at page level.
- Replacing Playwright's `toHaveScreenshot`. VisualGuard works alongside it (see the Phase 9 fixture).

### Success metrics for 1.0

| Metric                                         | Target                    |
| ---------------------------------------------- | ------------------------- |
| Time from install to first report              | < 5 min                   |
| Flaky jobs across 20 runs of the fixture suite | < 1 %                     |
| 25 routes × 1 viewport, no AI, GitHub runner   | < 90 s                    |
| Regression precision / recall (default Gemini) | ≥ 0.85 / ≥ 0.90 on evals  |
| Real projects running it in CI                 | ≥ 2                       |

---

## 2. Principles

1. **Repeatable captures come before AI.** A flaky screenshot corrupts everything after it: the diff, the AI analysis and the fix. Most of the early engineering effort goes into captures that come out the same every time.
2. **AI improves results but is never required.** Every command works with `ai: { provider: "none" }`. AI improves the classification and the explanations, but a correct pass/fail never depends on it.
3. **Safe defaults.** Code is never changed without an explicit opt-in and a confirmation. Source code never leaves the machine unless `fix` is turned on. API keys live in environment variables, never in config files.
4. **Free to run.** Diffing is pure JavaScript, Ollama runs the AI locally, and Gemini has a free tier for cloud use. No paid service is required.
5. **One package until it becomes painful.** Ship a single `visualguard` package. Keep the internal module boundaries strict so that splitting into `@visualguard/*` packages later is mechanical.
6. **The manifest is the contract between stages.** Every run writes a versioned `manifest.json`. `test`, `analyze`, `report`, `fix`, `comment` and CI integrations all read and write through it, so any stage can be re-run on its own.
7. **Swappable parts.** The AI provider, the diff engine and the reporters are interfaces from day one.
8. **AI cannot overrule hard failures.** If the heuristics find something that is definitely broken (horizontal overflow, a missing element, a broken image, a capture error), the AI cannot change it to `pass`.

---

## 3. User experience

### 3.1 Install and first run

```bash
npm install -D visualguard playwright
npx playwright install chromium
npx visualguard init
npx visualguard test
```

### 3.2 Commands

| Command                      | Purpose                                                                                       | Phase       |
| ---------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `visualguard <url>`          | Zero-config scan of one site: find routes, capture them, run health checks, save snapshots     | 2           |
| `visualguard <urlA> <urlB>`  | Zero-config comparison of two sites using defaults                                            | 2           |
| `visualguard init`           | Interactive setup that writes `visualguard.config.ts`                                         | 2           |
| `visualguard doctor`         | Checks that Playwright browsers are installed, the config is valid, the URLs respond and the AI provider is reachable | 2 |
| `visualguard test`           | The main pipeline: capture → diff → map → analyze → report                                    | 1 (AI in 5) |
| `visualguard report`         | Serves the latest HTML report, or the one given by `--run <id>`, on localhost                 | 3           |
| `visualguard analyze`        | Re-runs AI analysis on an existing run without capturing again (e.g. `--provider ollama`)    | 5           |
| `visualguard accept <route>` | Marks a change as intentional so it stops failing                                             | 6           |
| `visualguard comment`        | Posts or updates the sticky PR comment from an existing manifest (CI only)                    | 6           |
| `visualguard fix`            | Generates, confirms, applies and checks patches for regressions                               | 7           |
| `visualguard fix --auto`     | Runs `fix` without prompts in a git worktree/branch, and can open a PR                        | 8           |
| `visualguard watch`          | Re-tests changed routes against a local dev server each time you save a file                  | 8           |

### 3.3 Common flags

| Flag                                  | Applies to             | Meaning                                                    |
| ------------------------------------- | ---------------------- | ---------------------------------------------------------- |
| `-c, --config <path>`                 | all                    | Config file path                                           |
| `--production <url>`                  | test, watch            | Override the production base URL (§6.5)                    |
| `--staging <url>`                     | test, watch            | Override the staging base URL, e.g. `http://localhost:3000` |
| `--route <path>`                      | test                   | Test only these paths. Repeatable; replaces configured routes |
| `--list`                              | test                   | Print the resolved URL pairs and exit without capturing    |
| `--only <glob>`                       | test, analyze, fix     | Filter routes, e.g. `--only "/pricing*"`                   |
| `--viewport <name>`                   | test                   | Run only one of the configured viewports                   |
| `--no-ai`                             | test                   | Skip AI analysis                                           |
| `--provider <gemini\|ollama\|none>`   | test, analyze          | Override the AI provider                                   |
| `--fail-on <regression\|review\|any>` | test                   | What produces a non-zero exit code (default `regression`)  |
| `--ci`                                | all                    | No prompts, colours or spinners; CI reporters on           |
| `--json`                              | test, analyze          | Print the manifest JSON to stdout                          |
| `--concurrency <n>`                   | test                   | Number of pages captured in parallel                       |
| `--debug`                             | test                   | Save Playwright traces and write verbose logs              |
| `--run <id>`                          | analyze, report, fix   | Use a specific run instead of the latest                   |

### 3.4 Statuses

| Status       | Terminal | Markdown | Meaning                                                                       | Fails CI by default |
| ------------ | -------- | -------- | ----------------------------------------------------------------------------- | ------------------- |
| `pass`       | `✓`      | ✅       | Identical, within thresholds, or classified by AI as noise with high confidence | No                |
| `accepted`   | `✓`      | ☑️       | Differs, but matches a change someone already accepted                        | No                  |
| `review`     | `⚠`      | 🟡       | Differs, and either looks intentional or there was no AI to classify it       | No (`--fail-on review` makes it fail) |
| `regression` | `✖`      | 🔴       | Differs, and was classified as a regression                                   | Yes                 |
| `error`      | `!`      | ❗       | The capture or diff failed                                                    | Yes                 |

> Terminal output uses plain symbols (`✓ ⚠ ✖`) because emoji widths vary between terminals and break column alignment. Markdown output (PR comments, job summaries) uses emoji.

### 3.5 Exit codes

| Code | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| `0`  | Nothing at or above the `--fail-on` level                                     |
| `1`  | At least one job at or above the `--fail-on` level, or any `error` job       |
| `2`  | Config or usage error                                                        |
| `3`  | Environment error: browser missing, URL unreachable, or AI misconfigured with `--fail-on any` |

### 3.6 `visualguard test` output (TTY)

```
╭──────────────────────────────────────────╮
│ VisualGuard · AI visual regression       │
╰──────────────────────────────────────────╯

  production  https://example.com
  staging     https://staging.example.com
  viewports   desktop 1440×900 · mobile 390×844
  ai          gemini (gemini-flash-latest)

Scanning 24 routes × 2 viewports…

  ✓  /             desktop   PASS
  ✓  /products     desktop   PASS
  ✓  /about        desktop   PASS        2 noise regions filtered
  ⚠  /pricing      desktop   REVIEW      hero copy changed
  ✖  /checkout     desktop   REGRESSION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /checkout · desktop
  Regression · model confidence 0.93

  The pay button is no longer vertically centred in the order summary.

  Element   div.checkout-summary > .actions
  Change    align-items: center → flex-start
  Source    src/components/CheckoutSummary.tsx (likely)

  Suggested change
  - <div className="flex items-start gap-4">
  + <div className="flex items-center gap-4">

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  45 passed · 1 accepted · 1 review · 1 regression · 0 errors   (1m 12s)

  Report   npx visualguard report
  Fix      npx visualguard fix --only /checkout
```

With `--ci` or when stdout is not a TTY, the output contains the same information as one line per job, with no boxes, colours or spinners.

### 3.7 `visualguard init`

```
┌  VisualGuard setup
│
◇  Detected Next.js (app router) · pnpm
│
◇  Production URL
│  https://example.com
│
◇  Staging / preview URL
│  https://staging.example.com
│
◇  Routes (found 14 in app/ and sitemap.xml)
│  ◼ /   ◼ /pricing   ◼ /products   ◻ /blog/[slug] (needs params) …
│
◇  Viewports
│  ◼ Desktop 1440×900   ◼ Mobile 390×844
│
◇  AI provider
│  ● Gemini (cloud, free tier available)
│  ○ Ollama (local, free, private)
│  ○ None
│
◇  GEMINI_API_KEY
│  ▪▪▪▪▪▪▪▪▪▪▪▪▪▪   → saved to .env.local (gitignored)
│
◇  Add a GitHub Actions workflow?
│  Yes
│
◆  Created visualguard.config.ts
◆  Added .visualguard/ to .gitignore
◆  Added "visual": "visualguard test" to package.json scripts
◆  Created .github/workflows/visualguard.yml
◆  Playwright Chromium found
│
└  Run `npx visualguard test` to begin.
```

What `init` does:

1. **Detects** the framework from `package.json` dependencies (`next`, `react`, `vite`, …), the router type (`app/` or `pages/`) and the package manager (from the lockfile).
2. **Asks for URLs** and checks each one returns 2xx/3xx. Env-var placeholders are accepted for preview URLs.
3. **Discovers routes** (§6.4) and shows them as a multiselect. Dynamic segments are listed as needing params.
4. **Asks for viewports.**
5. **Sets up the AI provider.**
   - Gemini: masked key input, written to `.env.local`, or skipped with an `export` hint printed instead. It also shows the free-tier data-use notice (§10.2).
   - Ollama: checks `OLLAMA_HOST`, lists installed models that can read images, and prints `ollama pull <model>` if there are none.
6. **Writes files:** the config, `.gitignore` entries, a `package.json` script, and the workflow if requested. It never overwrites an existing file without confirmation.
7. **Checks Playwright and its browsers.** It prints the exact install command if they're missing. It never installs anything without asking.
8. **Supports `--yes`**, which accepts all defaults without prompting (for scripts and templates).

### 3.8 Zero-config modes

**One URL**: `npx visualguard https://staging.example.com`

- Discovers routes from `sitemap.xml`, falling back to a crawl capped at 25 pages.
- Captures desktop screenshots.
- Runs health checks on every page: HTTP status, console errors, failed requests, broken images and horizontal overflow.
- Saves snapshots to `.visualguard/snapshots/<host>/`. The next run against the same host diffs against them (baseline mode, §14.2).
- Finishes with: `No config found. Run "visualguard init" to set up production ↔ staging comparison.`

**Two URLs**: `npx visualguard https://example.com https://staging.example.com` runs the full compare pipeline with defaults (desktop viewport, discovered routes, AI only if `GEMINI_API_KEY` or a local Ollama is found).

**A URL with a path** (e.g. `https://example.com/pricing`) skips route discovery, and only that page is scanned or compared. §6.5 has the full rules.

---

## 4. Tech stack

| Concern              | Choice                                                    | Why                                                                                                     | Alternatives               |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| Runtime              | **Node ≥ 22**                                             | Node 20 reached end of life in April 2026. Node 22 supports `require(esm)` and recursive `fs.watch`     | —                          |
| Language             | **TypeScript (strict), ESM-only**                         | Gives typed config through `defineConfig`. ESM-only is safe on Node 22                                  | dual CJS/ESM               |
| Repo tooling         | **pnpm workspaces + changesets**                          | Same as your zentauri-ui setup                                                                          | npm workspaces             |
| Build                | **tsdown**                                                | Fast, Rolldown-based, emits `.d.ts`                                                                     | tsup, unbuild              |
| CLI parsing          | **commander** + `@commander-js/extra-typings`             | Mature, typed, supports subcommands                                                                     | cac, citty                 |
| Prompts and terminal UI | **@clack/prompts** + **picocolors**                    | Matches the boxed setup UX, and both are small                                                          | inquirer, ink              |
| Config loading       | **c12** (loads `.ts` via jiti, plus `.env`) + **zod v4**  | Loads TS configs without a build step. zod gives readable errors, and `z.toJSONSchema()` produces the AI schemas | cosmiconfig, unconfig |
| Browser automation   | **playwright**, as an optional peer dependency (≥ 1.45)   | The standard tool. Its Clock API (1.45+) can freeze time. Users control the version and browsers        | puppeteer                  |
| Pixel diff           | **pixelmatch** + **pngjs**                                | Pure JS with no native dependencies. Detects anti-aliasing and compares colour perceptually             | odiff-bin (adapter), blazediff |
| Parallelism          | **p-limit** + `worker_threads`                            | Capture waits on I/O, so it uses p-limit. Diffing is CPU-heavy, so it runs in worker threads            | piscina                    |
| Gemini               | **@google/genai**                                         | Google's current official JS SDK (`@google/generative-ai` is deprecated)                                | —                          |
| Ollama               | **plain `fetch`** to the REST API                         | No dependency. The `format` field accepts a JSON schema                                                 | `ollama` npm package       |
| Patches              | **diff** (jsdiff)                                         | Renders and applies unified diffs for display                                                           | —                          |
| Report UI            | **Vite + React + Tailwind** (static SPA)                  | Ships prebuilt inside the package, and works from `file://`, CI artifacts and any sub-path (§11.1)      | Next.js static export      |
| Report server        | `node:http` + **sirv** + **open**                         | Small, and only listens on localhost                                                                    | express                    |
| Git / GitHub         | `git` CLI via **execa**; GitHub REST via `fetch`; `gh` if installed | Avoids a heavy Octokit dependency                                                             | @octokit/rest              |
| Tests                | **vitest**; Playwright for report-app e2e                 | Fast and ESM-native                                                                                     | jest                       |
| Release              | changesets + GitHub Actions + **npm trusted publishing**  | Publishes with provenance and needs no long-lived npm token                                             | release-please             |

**Dependency budget.** Keep the install small. Heavy packages (`odiff-bin`, `sharp`) are optional dependencies that load only when used.

---

## 5. Architecture

### 5.1 Pipeline

```
                    ┌──────────────────────────┐
                    │ config + CLI flags + env │
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ route resolver           │  routes × viewports → jobs
                    └────────────┬─────────────┘
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
     ┌───────────────────────┐       ┌───────────────────────┐
     │ capture: production   │       │ capture: staging      │  screenshot + DOM snapshot + health
     └───────────┬───────────┘       └───────────┬───────────┘
                 └───────────────┬───────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ diff (worker pool)       │  normalise → pixelmatch → regions → shift detection
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ triage gate              │  thresholds · accepted list
                    └────────────┬─────────────┘
                     pass ◄──────┤ differs
                                 ▼
                    ┌──────────────────────────┐
                    │ DOM mapping + heuristics │  regions → elements → style / text / box deltas
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ AI analysis (cached)     │  gemini | ollama | none
                    └────────────┬─────────────┘
                                 ▼
                    ┌──────────────────────────┐
                    │ manifest.json            │──► terminal · HTML · JUnit · job summary · PR comment · webhook
                    └────────────┬─────────────┘
                                 ▼  opt-in
                    ┌──────────────────────────┐
                    │ fixer                    │  locate → patch → confirm → apply → verify
                    └──────────────────────────┘
```

Jobs that pass the triage gate stop there and never reach DOM mapping or AI. That keeps most runs fast and costs nothing.

### 5.2 Event-driven core

The orchestrator (`core/run.ts`) emits typed events: `run:start`, `job:captured`, `job:diffed`, `job:analyzed`, `run:end`. Reporters subscribe to them. The terminal UI, the report server, watch mode and the programmatic API all run on this one engine.

```ts
import { createRun, defineConfig } from "visualguard";

const run = createRun(defineConfig({ /* … */ }));
run.on("job:diffed", (job) => console.log(job.route, job.diff?.diffRatio));
const manifest = await run.start();
```

### 5.3 Module boundaries (inside the single package)

| Module      | Responsibility                                                     | May import                      |
| ----------- | ------------------------------------------------------------------ | ------------------------------- |
| `config`    | Schema, defaults, loading, route discovery                         | `core/types`                    |
| `capture`   | Browser lifecycle, stabilisation, screenshots, DOM snapshots, health | `config`                      |
| `diff`      | Normalisation, pixel diff, regions, shift detection (pure functions) | nothing                       |
| `mapping`   | Element matching, deltas, heuristic descriptions                   | `diff` types                    |
| `ai`        | Provider contract, providers, tasks, prompts, cache                | `mapping` types                 |
| `fixer`     | Source location, edit blocks, git, verification                    | `ai`, `capture`, `diff`         |
| `reporters` | terminal, json, html, junit, github-summary, github-comment, webhook | manifest types                |
| `core`      | Orchestrator, manifest, run directories, events, errors, accepted list | everything except `cli`     |
| `cli`       | Commands, prompts, rendering                                       | everything                      |

ESLint `no-restricted-imports` (or dependency-cruiser) enforces these rules. This mirrors the eventual split into `@visualguard/core`, `/diff`, `/ai`, `/reporter` and so on, so the split becomes a file move instead of a refactor.

### 5.4 Run directory

```
.visualguard/                                # generated, gitignored
├── runs/
│   ├── index.json                           # run list: id, number, timestamp, summary
│   └── 0042_2026-10-08T10-22-01Z/
│       ├── manifest.json
│       ├── report/                          # self-contained HTML report
│       └── jobs/
│           └── checkout__desktop/
│               ├── production.png
│               ├── staging.png
│               ├── diff.png
│               ├── production.dom.json
│               ├── staging.dom.json
│               ├── regions/0.production.png · 0.staging.png · 0.diff.png
│               ├── trace.production.zip     # only with --debug
│               └── analysis.json
├── snapshots/<host>/                        # zero-config single-URL mode
├── cache/ai/<sha256>.json
└── consent.json                             # fixer source-sharing consent

visualguard.accepted.json                    # committed: changes accepted as intentional
visualguard/baselines/                       # committed, only in baseline mode (§14.2)
```

Your original sketch used `./visualguard` as the screenshot directory. This plan recommends `.visualguard/` instead because the contents are generated output, like `.next/`. Only the accepted list and baselines get committed. Old runs are deleted automatically: `output.keepRuns` defaults to 10.

### 5.5 Core types (sketch)

```ts
type Env = "production" | "staging";
type Status = "pass" | "accepted" | "review" | "regression" | "error";
type Classification = "regression" | "intentional" | "content" | "noise";

interface RunManifest {
  schemaVersion: 1;
  id: string;
  number: number;
  startedAt: string;
  durationMs: number;
  tool: { version: string; playwright: string; node: string };
  config: { baseURL: Record<Env, string>; ai: { provider: string; model?: string } };
  summary: Record<Status, number>;
  jobs: JobResult[];
}

interface JobResult {
  id: string;                          // "checkout__desktop"
  route: string;                       // "/checkout"
  viewport: string;                    // "desktop"
  status: Status;
  captures: Record<Env, CaptureResult>; // image paths, size, timings, health signals
  diff?: DiffResult;
  regions: RegionResult[];
  analysis?: Analysis;
  acceptedBy?: { hash: string; at: string; note?: string };
  error?: { stage: "capture" | "diff" | "mapping" | "ai"; message: string };
}

interface DiffResult {
  width: number;
  height: number;
  sizeMismatch?: Record<Env, { width: number; height: number }>;
  diffPixels: number;
  diffRatio: number;
  shift?: { fromY: number; deltaY: number }; // layout shift detected (§8.1 step 6)
}

interface RegionResult {
  id: number;
  box: { x: number; y: number; width: number; height: number }; // page coordinates
  diffPixels: number;
  elements: ElementMatch[];   // smallest enclosing element first
  deltas: Delta[];            // style | text | box | presence
  heuristic?: string;         // "Text changed", "Moved 24px down", …
}

interface StyleDelta {
  kind: "style";
  selector: string;
  property: string;           // "align-items"
  production: string;         // "center"
  staging: string;            // "flex-start"
}

interface Analysis {
  classification: Classification;
  confidence: number;         // 0–1, as reported by the model
  title: string;
  summary: string;
  likelyCause?: string;
  evidence: string[];
  affected: { selector: string; component?: string }[];
  suggestedFix?: { description: string; snippet?: string };
  provider: string;
  model: string;
  promptVersion: string;
  cached: boolean;
}
```

### 5.6 Extension interfaces

```ts
interface DiffEngine {
  name: string;
  compare(a: RGBAImage, b: RGBAImage, opts: DiffOptions): Promise<{
    diffPixels: number;
    mask: Uint8Array;        // 1 byte per pixel: 1 = different
    diffImage: RGBAImage;
  }>;
}

interface Reporter {
  name: string;
  onEvent?(event: RunEvent): void | Promise<void>;
  onRunEnd(manifest: RunManifest, ctx: ReporterContext): void | Promise<void>;
}
```

The AI provider interface is in §10.1.

---

## 6. Configuration

### 6.1 Full example

```ts
// visualguard.config.ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: process.env.VISUALGUARD_STAGING_URL ?? "https://staging.example.com",
  },

  routes: [
    "/",
    "/products",
    "/pricing",
    { path: "/checkout", waitFor: "[data-testid=order-summary]" },
    { path: "/blog/[slug]", params: [{ slug: "hello-world" }] },
  ],
  // or: routes: { discover: ["nextjs", "sitemap"], exclude: ["/admin/**"], limit: 50 }

  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },

  browser: {
    name: "chromium",
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    deviceScaleFactor: 1,
  },

  environments: {
    staging: {
      headers: { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET ?? "" },
      storageState: ".visualguard/auth/staging.json",
    },
  },

  stabilize: {
    disableAnimations: true,
    freezeTime: "2026-01-01T00:00:00Z",
    waitForFonts: true,
    networkQuietMs: 500,
    scrollToLoad: true,
    hide: [".cookie-banner", "#intercom-container"],
    mask: ["[data-testid=live-price]", ".timestamp"],
    blockRequests: ["**/analytics/**", "**/*hotjar*"],
    retries: 2,
  },

  screenshot: {
    fullPage: true,
    maxHeight: 15000,
  },

  diff: {
    engine: "pixelmatch",
    threshold: 0.1,        // per-pixel colour tolerance, 0–1
    maxDiffPixels: 100,    // pass if diff pixels ≤ this…
    maxDiffRatio: 0.0005,  // …or diff ratio ≤ this
    ignoreAntialiasing: true,
    maxRegions: 10,
  },

  ai: {
    provider: "gemini",    // "gemini" | "ollama" | "none"
    model: "gemini-flash-latest",
    maxCallsPerRun: 30,
    concurrency: 2,
    noiseConfidence: 0.8,
  },

  report: {
    publicURL: process.env.VISUALGUARD_REPORT_URL, // used in PR comment links
  },

  output: {
    dir: ".visualguard",
    keepRuns: 10,
  },

  hooks: {
    async beforeCapture({ page, env, route }) {
      // log in, set feature-flag cookies, dismiss modals…
    },
  },

  fix: {
    enabled: false,
    requireConfirmation: true,
    compareRef: "origin/main", // optional: rank files changed since this ref
    include: ["src/**", "app/**", "components/**", "styles/**"],
    verify: {
      server: { command: "pnpm dev", url: "http://localhost:3000", readyTimeoutMs: 60_000 },
      commands: ["pnpm tsc --noEmit", "pnpm lint"],
    },
    maxAttempts: 2,
  },
});
```

### 6.2 Resolution order

Settings are resolved in this order, highest priority first:

**CLI flags → env vars → config file → defaults.**

The URL-related flags are `--production`, `--staging` and `--route`. §6.5 explains how they combine with the env vars below and with `routes`.

| Env var                     | Purpose                                                       |
| --------------------------- | ------------------------------------------------------------- |
| `VISUALGUARD_PRODUCTION_URL` | Overrides `baseURL.production`                               |
| `VISUALGUARD_STAGING_URL`   | Overrides `baseURL.staging`. Needed in CI, where each PR has a different preview URL |
| `VISUALGUARD_AI_PROVIDER`   | Overrides `ai.provider`                                       |
| `GEMINI_API_KEY`            | Gemini auth. Only ever read from env or `.env*`               |
| `OLLAMA_HOST`               | Ollama base URL (default `http://localhost:11434`)            |
| `GITHUB_TOKEN`              | PR comments                                                   |

The config schema **rejects values that look like literal secrets**, such as Google API keys starting with `AIza`, and tells you to move them to an environment variable.

### 6.3 Validation

zod validates the config and prints errors with the key path and a hint:

```
✖ Invalid config (visualguard.config.ts)

  diff.threshold: expected a number between 0 and 1, received 20
  Hint: threshold is per-pixel colour tolerance.
        Use diff.maxDiffPixels for "how many pixels may differ".
```

### 6.4 Route discovery

Sources, in priority order:

1. **Explicit `routes`.**
2. **Framework file-system routes.**
   - Next.js `app/**/page.{tsx,jsx,ts,js,mdx}`. Strip `(group)` segments, and skip `@parallel` slots, intercepting routes and `_private` folders.
   - Next.js `pages/**`. Skip `_app`, `_document` and `api/`.
   - Dynamic segments (`[slug]`, `[...all]`) need `params`.
3. **`sitemap.xml`** (including sitemap indexes) from the production URL.
4. **Crawl**: same-origin `<a href>` links, depth 2, limit 50, ignoring query strings and hashes and respecting `exclude`.

Discovery from file-system routes also records which source file belongs to which route (e.g. `/pricing` → `app/pricing/page.tsx`). The fixer and watch mode reuse that map (§13.3, §14.1).

### 6.5 How page URLs are resolved

Every job compares **the same page on two sites**. A page URL is always built from two parts:

- a **base URL**: where the site lives, one per environment
- a **route**: which page, written as a path (`/pricing`)

VisualGuard joins each route onto both base URLs and runs it once per viewport:

```
baseURL.production   https://example.com
baseURL.staging      https://staging.example.com
routes               ["/", "/pricing", "/checkout"]
viewports            desktop, mobile

job                   production URL                  staging URL
index__desktop        https://example.com/            https://staging.example.com/
pricing__desktop      https://example.com/pricing     https://staging.example.com/pricing
checkout__desktop     https://example.com/checkout    https://staging.example.com/checkout
…the same three again for mobile → 6 jobs
```

#### Where base URLs come from

Highest priority first:

| Source          | Example                                              | Typical use                                    |
| --------------- | ---------------------------------------------------- | ---------------------------------------------- |
| CLI flags       | `--staging http://localhost:3000`                    | A one-off run against another environment      |
| Positional URLs | `npx visualguard https://a.com https://b.com`        | Zero-config (see below)                        |
| Env vars        | `VISUALGUARD_STAGING_URL=https://pr-42.vercel.app`   | CI, where each PR has its own preview URL      |
| Config file     | `baseURL: { production, staging }`                   | The normal setup, written by `init`            |

- **Compare mode needs both base URLs.** With only one, VisualGuard runs in scan/baseline mode instead (§3.8, §14.2).
- **Reachability check.** Before capturing anything, each base URL is requested once. If one doesn't respond, the run stops with exit code 3 and names the URL that failed.

#### Where routes come from

Highest priority first:

1. **`--route <path>` flags.** The flag can be repeated, and it replaces the configured list for this run: `npx visualguard test --route /pricing --route /checkout`.
2. **A path inside a positional URL.** This triggers single-page mode (see the positional URL table below).
3. **`routes` in the config.** Either an explicit list or a discovery object (§6.4). A discovery object can also take `extra` paths that discovery wouldn't find, such as `/search?q=shoes`.
4. **Nothing configured.** Discovery runs with defaults (sitemap, then crawl).

After that, `--only <glob>` filters the list. `--route` says which pages to test; `--only` narrows down a list that already exists.

Each dynamic route expands into one job per `params` entry. A dynamic route with no `params` is skipped with a warning, and `--list` shows it as skipped.

#### Joining rules

| Case                  | Base URL                                  | Route               | Page URL                                                  |
| --------------------- | ----------------------------------------- | ------------------- | --------------------------------------------------------- |
| Plain                 | `https://example.com`                     | `/pricing`          | `https://example.com/pricing`                             |
| Base with path prefix | `https://example.com/app`                 | `/pricing`          | `https://example.com/app/pricing`                         |
| Query in route        | `https://example.com`                     | `/search?q=shoes`   | `https://example.com/search?q=shoes`                      |
| Query on base URL     | `https://staging.example.com?preview=1`   | `/pricing?plan=pro` | `https://staging.example.com/pricing?preview=1&plan=pro`  |
| Hash route            | `https://example.com`                     | `/#/settings`       | `https://example.com/#/settings`                          |
| Trailing slash        | `https://example.com`                     | `/pricing/`         | `https://example.com/pricing/` (kept as written)          |

- **A path on the base URL is a prefix.** Be careful here: `new URL("/pricing", "https://example.com/app/")` returns `https://example.com/pricing`, because the leading slash drops the prefix. The resolver therefore adds a trailing slash to the base, strips the route's leading slash, and then resolves. This needs dedicated unit tests.
- **Query params on a base URL are added to every page.** This is useful for preview tokens and flags like `?preview=1`. If the route sets the same key, the route's value wins.
- **Routes must be paths.** Absolute URLs in `routes` are rejected. Sitemap and crawl results are the exception: they're converted to paths, and dropped if they point to a different host.
- **Redirects are followed, and each side's final URL is recorded.** If production and staging land on different paths (for example `/pricing` redirects to `/plans` only on staging), the job gets a "redirect mismatch" health warning.
- **Job ids** take the form `<route slug>__<viewport>`. For example, `/` becomes `index__desktop` and `/blog/hello-world` becomes `blog_hello-world__desktop`. A short hash is appended when the route has a query string or when two routes produce the same slug.

#### Different paths on the two sites

If a page was renamed or moved on staging, set the path per environment:

```ts
routes: [
  "/",
  { path: "/pricing", staging: "/plans" },
],
```

The job is still named after `path`, so its history, accepted changes and baselines stay in one place.

#### Positional URLs (zero-config)

| Command                                                                         | What happens                                                    |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `visualguard https://example.com`                                               | Scan: discover routes, capture, health checks, save snapshots   |
| `visualguard https://example.com/pricing`                                       | Scan only that page                                             |
| `visualguard https://example.com https://staging.example.com`                   | Compare, with routes discovered from the first URL              |
| `visualguard https://example.com/pricing https://staging.example.com/pricing`   | Compare only that page                                          |
| `visualguard https://example.com/pricing https://staging.example.com`           | Only one URL has a path, so that path is used on both sites     |
| `visualguard https://example.com/pricing https://staging.example.com/plans`     | Compare those two exact pages, even though the paths differ     |

If a config file exists, positional URLs override only its base URLs and routes. Viewports, stabilisation and AI settings still come from the config.

#### Checking the resolved URLs before a run

`--list` prints the resolved jobs without opening a browser:

```
$ npx visualguard test --list

  production   https://example.com
  staging      https://staging.example.com
  viewports    desktop, mobile

  /                    →  /
  /pricing             →  /plans
  /blog/hello-world    →  /blog/hello-world
  /blog/launch         →  /blog/launch

  ⚠ /docs/[...slug] skipped: no params

  8 jobs (4 routes × 2 viewports)
```

#### CI with per-PR preview URLs

The production URL stays in the config. Only the staging URL changes for each PR:

```yaml
on:
  deployment_status:

jobs:
  visualguard:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      # … checkout, install, browsers (see Appendix C)
      - run: pnpm exec visualguard test --ci
        env:
          VISUALGUARD_STAGING_URL: ${{ github.event.deployment_status.environment_url }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

---

## 7. Capture engine

**Goal:** capturing the same site twice gives 0 diff pixels. This is tested continuously (§17).

### 7.1 Sources of flakiness and how to handle them

| Source of flakiness                          | Mitigation                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| CSS animations, transitions, blinking carets | `page.screenshot({ animations: "disabled", caret: "hide" })`, injected CSS, and `reducedMotion: "reduce"` on the context |
| Web fonts loading late                       | Wait for `document.fonts.ready`, with a time limit                                                           |
| Lazy images and lazy sections                | Scroll through the page one viewport at a time, wait for `img.complete`, then scroll back. Height is capped by `maxHeight` |
| Network still busy                           | A custom quiet window: no requests in flight for `networkQuietMs`. Ignores websockets, long-polling and blocked analytics. Playwright's docs discourage relying on `networkidle` |
| Dates, clocks, countdowns                    | Playwright Clock API (`page.clock.setFixedTime`)                                                             |
| A/B tests, carousels, ads, chat widgets      | `hide` and `mask` selectors, `blockRequests`, and `hooks.beforeCapture` to set flags or cookies              |
| Locale, timezone, colour scheme              | Fixed in the context options, the same for both environments                                                 |
| Device pixel ratio                           | `deviceScaleFactor: 1` by default, which also keeps images small. Configurable                               |
| Scrollbars                                   | Hidden with injected CSS                                                                                     |
| Cookie banners                               | A built-in `hide` list for common consent vendors, plus your own selectors                                   |
| Page still changing                          | A stability loop: take screenshots ~150 ms apart until two in a row match (at most 3 attempts), like `toHaveScreenshot` |
| Transient failures                           | Retries each route with backoff. A failure is recorded as `error` and the rest of the run continues          |

### 7.2 Other details

- **Browser setup.** One browser instance, with one `BrowserContext` per environment × viewport. Pages are pooled with `p-limit` (default `min(4, cpus)`).
- **Capture order.** Production and staging for the same job are captured one right after the other to minimise time skew.
- **Auth.**
  - Per-environment `storageState`.
  - Extra headers, such as Vercel's protection-bypass header.
  - The `beforeCapture` hook.
  - Later, a `visualguard auth <env>` helper that opens a visible browser for you to log in and saves the storage state (Phase 9).
- **Masking happens in the browser** through Playwright's `mask` option. That means masked content never reaches disk or the AI.
- **`--debug`** records a Playwright trace for each environment and job.
- **DOM snapshot** is taken right after the screenshot, while the page is in the same stable state (§9).
- **Health signals** come with every capture at no extra cost: HTTP status, console errors, failed requests and broken images. The report shows them, the zero-config scan uses them, and the AI gets them as context.

---

## 8. Diff engine

### 8.1 Steps

1. **Decode** the PNGs (pngjs) in a worker thread.
2. **Normalise sizes.** Full-page heights often differ. Pad the shorter image to the same size and record `sizeMismatch`. If the widths differ at the same viewport, the page has horizontal overflow, which is itself a strong regression signal.
3. **Pixel diff** with pixelmatch: `threshold`, `includeAA: false`, and `diffMask` output for overlays.
4. **Gate.** The job passes if `diffPixels ≤ maxDiffPixels` or `diffRatio ≤ maxDiffRatio`, and **processing stops there**.
5. **Region extraction.**
   - Split the diff mask into a grid of 16 × 16 px cells and mark cells with at least *k* differing pixels.
   - Group touching cells (8-neighbour connected components) into regions.
   - Grow the regions slightly and merge any that are closer than `mergeDistance`.
   - Drop tiny regions, sort by area, and keep at most `maxRegions`.
6. **Layout-shift detection.** Without this step, inserting one 24 px banner marks the entire rest of the page as changed.
   - When a region runs from some *y* to the bottom of the page, hash every pixel row in both images.
   - Search for the vertical offset that lines the lower part back up.
   - If one exists, report a single root cause: *"content below y=840 shifted down 24 px"*.
   - Diff the realigned remainder and only report the regions that are left.
7. **Artifacts.** Write `diff.png` and per-region crops (with padding around the region) for each environment.

### 8.2 Engines

- **`pixelmatch`** (default): pure JS and runs anywhere.
- **`odiff`** (optional, via `odiff-bin`): faster on very large images. Benchmark it on real screenshots, including PNG decode time, before making it the default. Its speed claims come mostly from its own charts.
- The interface also allows SSIM-based or perceptual engines later.

### 8.3 Performance budget

A 1440 × 15 000 RGBA image takes about 86 MB, and every job has three of them. The worker pool size for diffing is therefore set separately from capture concurrency, and it accounts for memory. The target is 25 routes × 1 viewport in under 90 s on a GitHub-hosted runner without AI.

---

## 9. DOM mapping and style deltas

This step makes VisualGuard more than a screenshot differ, and **it works without AI**.

### 9.1 DOM snapshot (per capture)

Inside `page.evaluate`, walk the visible elements, including open shadow roots, up to about 5 000 nodes. For each element, record:

- **Bounding box** in page coordinates.
- **Stable selector**, in this order of preference: `data-testid`, then `id`, then `data-component`, then a short CSS path with `:nth-of-type`.
- **Identity:** tag, role, accessible name, classes, a text snippet (≤ 80 chars), and `src`/`alt` for images.
- **Computed styles** from an allowlist: `display, position, inset, width, height, margin*, padding*, gap, flex-*, align-*, justify-*, grid-template-*, font-family, font-size, font-weight, line-height, letter-spacing, color, background-color, background-image, border*, border-radius, box-shadow, opacity, visibility, transform, z-index, overflow, text-align, white-space`.
- **Component hints:** `data-component` attributes, and display names where dev builds expose them.

Don't rely on React fiber internals. React 19 removed `_debugSource`, and production builds minify component names. Document an optional `data-component` convention instead.

### 9.2 Mapping regions to elements

1. **Candidates.** Take the elements whose boxes intersect the region. Score them by overlap and size, preferring the deepest element that covers most of the region.
2. **Match** each candidate to its counterpart in the other environment. Try the stable selector first, then the same CSS path, then the same text and tag at the nearest position.
3. **Compute deltas:**
   - **style**: only the properties that changed
   - **text**: changed text
   - **box**: moved or resized
   - **presence**: missing or new element
4. **Describe** each change in plain language without AI:
   - *"Text changed: 'Start free trial' → 'Start trial'"*
   - *"Button moved 12 px up"*
   - *"Background colour #2563eb → #1d4ed8"*
   - *"Image failed to load"*
   - *"Horizontal overflow: page is 412 px wide at a 390 px viewport"*

### 9.3 Known limits

Canvas/WebGL, video, cross-origin iframes and closed shadow roots can only be compared pixel by pixel, with no DOM explanation. The report says so for each region.

---

## 10. AI layer

### 10.1 Two-level design

The task-level API from your sketch stays as the public surface. Underneath it, each provider implements **one narrow primitive**. Prompts, schemas and validation are shared, so adding OpenAI or Anthropic later is about 100 lines.

```ts
// What each provider implements
interface AIProvider {
  readonly name: string;
  readonly capabilities: { vision: boolean; structuredOutput: boolean; maxImages: number };
  generate<T>(req: {
    system: string;
    parts: Array<
      | { type: "text"; text: string }
      | { type: "image"; data: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" }
    >;
    schema: z.ZodType<T>;
    signal?: AbortSignal;
  }): Promise<{ data: T; usage?: { inputTokens: number; outputTokens: number } }>;
}

// Tasks that work with any provider (ai/tasks/*)
analyzeVisualDiff(provider: AIProvider, input: VisualDiffInput): Promise<VisualAnalysis>;
locateSource(provider: AIProvider, input: SourceAnalysisInput): Promise<SourceAnalysis>;
generatePatch(provider: AIProvider, input: PatchInput): Promise<CodePatch>;
```

```
            analyzeVisualDiff · locateSource · generatePatch      (shared prompts + zod schemas)
                                   │
                              AIProvider.generate()
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
           Gemini               Ollama                none
         (cloud AI)            (local AI)      (heuristics only)
```

### 10.2 Gemini provider

- **SDK:** `@google/genai`. The older `@google/generative-ai` package is deprecated.
- **Auth:** the `GEMINI_API_KEY` env var.
- **Structured output:** `responseMimeType: "application/json"` plus a JSON schema generated from zod (`z.toJSONSchema`). The output is always re-validated with zod. If it's invalid, the provider retries once with a repair prompt.
- **Model:** set in config and never hardcoded in the logic. Default to a moving alias such as `gemini-flash-latest`. `init` and `doctor` list the live models through the API. Gemini's model lineup changes quickly (the 2.5 family is reportedly being retired around mid-October 2026), so **check the defaults again at implementation time.**
- **API surface:** Google's current docs point new projects toward its newer Interactions API, while `generateContent` with structured output is the long-established path. Pick one when implementing. Because everything sits behind the adapter, switching later is a one-file change.
- **Rate limits:**
  - Free-tier quotas are low, so default concurrency is 2.
  - On 429, back off exponentially and honour any retry hint.
  - `maxCallsPerRun` caps calls per run. When the cap is hit, the remaining jobs become `review` with the note "AI budget reached".
- **Privacy:** under Google's terms for unpaid API use, submitted content may be used to improve Google products. That includes screenshots of unreleased staging UI. `init` says this and recommends Ollama or a paid key for confidential work. (Check the current terms when implementing.)

### 10.3 Ollama provider

- **Request:** `POST {OLLAMA_HOST}/api/chat` with `stream: false`, base64 `images`, and `format: <JSON schema>` for structured output.
- **Model:** requires a model that can read images, such as models from the Qwen-VL, Llama 3.2 Vision or Gemma 3 families (check the Ollama library for current options). `doctor` checks which models are installed and what they support.
- **Smaller models are weaker**, so the Ollama path adapts:
  - Send one composite image (production | staging | diff side by side) instead of three.
  - Use shorter prompts and fewer regions.
  - Fall back to heuristics if the output fails validation twice.

### 10.4 The `none` provider

The heuristics classify on their own:

- Layout shift, overflow, a missing element or a broken image → `regression`
- A text, style or box change → `review`
- Small, scattered differences that look like anti-aliasing → `pass`

### 10.5 `analyzeVisualDiff`: inputs and output

**Inputs.** Only jobs that failed the gate are sent. For each job:

- Up to `maxRegionsPerJob` regions (default 3). Each has a production crop, a staging crop and a diff crop with padding around it. Crops are downscaled to ≤ 1024 px on the long side and sent as JPEG/WebP.
- Low-resolution full-page thumbnails for context.
- **The DOM deltas JSON from §9**, which is the most valuable signal.
- The route, the viewport, the heuristic findings and the health signals (console errors, failed requests).

**Output schema:**

```ts
const VisualAnalysis = z.object({
  classification: z.enum(["regression", "intentional", "content", "noise"]),
  confidence: z.number().min(0).max(1),
  title: z.string().max(80),
  summary: z.string().max(400),
  likelyCause: z.string().max(300).optional(),
  evidence: z.array(z.string()).max(5),
  affected: z
    .array(z.object({ selector: z.string(), component: z.string().optional() }))
    .max(5),
  suggestedFix: z
    .object({ description: z.string(), snippet: z.string().optional() })
    .optional(),
});
```

**Classification rubric** (in the system prompt):

| Class         | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `regression`  | Misalignment, overlap, clipping, overflow, broken or missing images or elements, unreadable contrast, a layout broken at one viewport |
| `intentional` | A coherent change that looks deliberate: new copy, a consistent restyle, a new feature             |
| `content`     | Data or CMS differences (prices, posts, dates) that weren't caused by code                         |
| `noise`       | Sub-pixel rendering, anti-aliasing, font hinting                                                    |

**Status mapping:**

| AI result                                                  | Status       |
| ---------------------------------------------------------- | ------------ |
| `regression`                                               | `regression` |
| `intentional` or `content`                                 | `review`     |
| `noise` with confidence ≥ `ai.noiseConfidence` (0.8)       | `pass`       |
| `noise` with lower confidence                              | `review`     |

The mapping never overrides a hard heuristic failure (principle 8).

### 10.6 Guardrails against hallucination

- Validate against the schema. If validation fails, retry once with a repair prompt, then fall back to heuristics.
- `affected[].selector` must exist in one of the DOM snapshots. Unknown selectors are dropped.
- The prompt says: base every claim on the images or the supplied deltas. Never invent CSS or selectors. If unsure whether a change is deliberate, say `intentional` with lower confidence, because a human will review it.
- Confidence is labelled **"model confidence"**, never presented as a calibrated probability. The thresholds are tuned against the eval set.
- `PROMPT_VERSION` is recorded in every analysis so results stay comparable over time.

### 10.7 Caching and cost

- **Cache key:** `sha256(production crop + staging crop + deltas + prompt version + provider + model)`. Re-running on diffs that haven't changed costs nothing.
- **Bypass:** `analyze --no-cache`.
- **Usage report:** the manifest records token usage and the terminal summary prints it, so free-tier users can see how much quota they're using.

### 10.8 Evals

- `evals/` holds about 50 labelled cases: fixture image pairs plus DOM snapshots and the expected classification.
- `pnpm eval --provider gemini --model <id>` prints precision and recall for each class and a confusion matrix.
- Run the evals before changing prompts or default models.
- **1.0 target:** regression precision ≥ 0.85 and recall ≥ 0.90 on the default Gemini model, with reported numbers for Ollama.

---

## 11. HTML report

### 11.1 Why Vite + React instead of Next.js

The report ships inside the npm package, and it has to open from:

- `file://`
- an unzipped CI artifact
- any static host, under any sub-path

A Vite SPA built with `base: "./"`, with the manifest inlined into `index.html`, works in all three places and needs no server. A Next.js static export assumes absolute `/_next/` asset paths and adds weight for no benefit here.

Next.js is a good fit for the **docs/marketing site** (`apps/docs`, Phase 9).

> Option: build the report UI with your **zentauri-ui** components. That would exercise both projects (see §21).

### 11.2 Generation

At the end of a run:

1. Copy the prebuilt `dist/report-app/*` into `runs/<id>/report/`.
2. Inline the manifest as `<script>window.__VISUALGUARD__ = {…}</script>`. Fetching JSON over `file://` is blocked, so it can't be loaded separately.
3. Reference images by relative path.

The result is a self-contained folder that can be zipped, uploaded or hosted.

### 11.3 Views

```
┌────────────────────────────────────────────────────────────────────┐
│ VisualGuard · Run #128 · prod ↔ staging · 1m 12s · gemini          │
├────────────────────────────────────────────────────────────────────┤
│ 48 jobs   45 passed   1 accepted   1 review   1 regression         │
├──────────────────────┬─────────────────────────────────────────────┤
│ ✖ /checkout  desktop │ [Side by side] [Slider] [Onion] [Diff]      │
│ ⚠ /pricing   desktop │ ┌────────────┐ ┌────────────┐ ┌──────────┐  │
│ ✓ /          desktop │ │ production │ │  staging   │ │   diff   │  │
│ ✓ /products  mobile  │ └────────────┘ └────────────┘ └──────────┘  │
│ …                    ├─────────────────────────────────────────────┤
│                      │ 🔴 Regression · model confidence 0.93       │
│ filter · search      │ The pay button is no longer centred…        │
│                      │ align-items  center → flex-start            │
│                      │ ┌─────────────────────────────────────────┐ │
│                      │ │ - items-start                           │ │
│                      │ │ + items-center                          │ │
│                      │ └─────────────────────────────────────────┘ │
│                      │ [Accept change]  [Generate fix]             │
└──────────────────────┴─────────────────────────────────────────────┘
```

- **Overview:** run number, URLs, duration, counts per status, AI provider/model and token usage.
- **Job list:** status, route, viewport, diff %, AI title. Includes filter chips, search, and `j`/`k` keyboard navigation.
- **Compare:** four modes on keys `1`–`4`: side by side, slider (swipe), onion-skin opacity, and diff overlay. Region boxes can be toggled, and zoom/pan stays in sync across panes.
- **Analysis panel:** classification badge, model confidence, summary, evidence, affected elements, a style-delta table (`property: production → staging`), and the suggested fix with a copy button.
- **Health tab:** console errors and failed requests for each environment.
- **Deep links:** for example `#/jobs/checkout__desktop?view=slider`.
- **General:** dark mode, responsive layout, accessible (keyboard, focus rings, contrast).

### 11.4 `visualguard report`

- Serves the latest report (or `--run <id>`) with `sirv` on `127.0.0.1` at a random port, and opens a browser. Flags: `--port`, `--no-open`.
- **Served mode** turns on actions through a localhost-only API, protected by a token generated for each session:
  - **Accept change** writes to `visualguard.accepted.json`.
  - **Re-analyze**.
  - **Generate fix** (Phase 8). It shows the diff and applies it only after you confirm in the UI.
- **Static mode** (opened from a file or a CI artifact): each action shows the equivalent CLI command to copy instead.

---

## 12. CI and GitHub

### 12.1 Generic CI

- `--ci` turns on automatically when `CI=true`. It disables prompts, spinners and colours, and never opens a browser.
- Exit codes follow §3.5 and `--fail-on`.
- Available reporters: `junit` (for CI test dashboards), `json` and `html`.
- When CI provides a run number (e.g. `GITHUB_RUN_NUMBER`), it's used as the run number.

### 12.2 GitHub job summary

`test` writes Markdown to `$GITHUB_STEP_SUMMARY`: the totals, a table of jobs that didn't pass, and the AI summaries. **It needs no token**, which makes it the most useful integration to ship first.

### 12.3 Sticky PR comment (`visualguard comment`)

- **API:** GitHub REST with `GITHUB_TOKEN`, which needs the `pull-requests: write` permission.
- **One comment per PR:** the CLI finds its earlier comment by the hidden marker `<!-- visualguard:report -->` and updates it instead of posting a new one.
- **It's a separate command from `test`** because the comment should link to the uploaded report. The artifact URL only exists after the upload step, so the order is `test` → upload artifact → `comment --link <artifact-url>` (Appendix C).
- **Images:** GitHub has no API for uploading images into comments. The comment links to either:
  - the report artifact (`actions/upload-artifact` exposes `artifact-url`), or
  - `report.publicURL`, if the report is deployed to GitHub Pages or another static host.
- **Fork PRs:** on `pull_request` events from forks, `GITHUB_TOKEN` is read-only. The docs need to cover the two-workflow `workflow_run` pattern for this case.
- **Escaping:** all user-controlled text (route names, page text, AI output) is escaped so it can't inject Markdown.

### 12.4 Preview deployments

Staging is often a separate preview URL for each PR (Vercel, Netlify).

- Trigger on `deployment_status` when it reaches `success`.
- Pass `VISUALGUARD_STAGING_URL: ${{ github.event.deployment_status.environment_url }}`. Some providers use `target_url` instead.
- Send the protection-bypass secret through `environments.staging.headers`.
- A `deployment_status` event doesn't include a PR number. `comment` looks up the PR from the commit SHA (`GET /repos/{owner}/{repo}/commits/{sha}/pulls`). If no PR is found, it skips the comment and leaves only the job summary.
- A full workflow example is in §6.5.

### 12.5 Example workflow

See [Appendix C](#c-github-actions-workflow).

### 12.6 Later

An official composite action, `visualguard/action@v1`, that installs, caches browsers, runs the test, uploads the artifact and posts the comment in a single step.

### 12.7 Webhook reporter

```ts
reporters: ["terminal", "html", ["webhook", { url: process.env.VISUALGUARD_WEBHOOK_URL }]]
```

It POSTs the run summary JSON. That covers n8n, Slack workflows, Zapier and anything else, without the core depending on any of them.

---

## 13. Fixer

### 13.1 Safety model

- **Off by default.** It runs only with `fix.enabled: true`, and asks for confirmation unless you change that (`requireConfirmation: true`).
- **Git required.** It refuses to run on a dirty working tree unless you pass `--allow-dirty`.
- **Allowlisted paths.** It only edits files that match `fix.include`. It never touches lockfiles, `.env*`, config files, `node_modules` or generated directories.
- **Source-sharing consent.** The first time it runs, it lists exactly which source files will be sent to the AI provider and asks for consent. The answer is stored in `.visualguard/consent.json` and can be revoked.
- **Isolation with `--auto`.** `fix --auto` works in a separate `git worktree` on the branch `visualguard/fix-<route>-<runId>`, so your working tree is never touched. It pushes and opens a PR only with `--pr`.
- **Reversible.** Every change can be undone, and the summary lists every file touched.

### 13.2 Flow

```
regression (from latest run)
  → locate candidate source files                 (§13.3, mostly no AI)
  → AI: propose edits as search/replace blocks   (§13.4)
  → validate: each search block matches exactly once, file is allowlisted
  → show reason + rendered unified diff → confirm (y/N)
  → apply (in place, or in a worktree for --auto)
  → verify: run commands (typecheck / lint / tests)
            → start or reuse the local server → capture the route again → diff vs production
  → resolved?  yes → done
               no  → send the new diff and errors back to the AI, retry (≤ maxAttempts) or revert
```

### 13.3 Locating source

Most of this step needs no AI. Signals, from strongest to weakest:

1. **Files changed since `fix.compareRef`** (`git diff --name-only origin/main...HEAD`). A regression was most likely introduced by a recently changed file.
2. **Route → page file**, using the map from §6.4, plus that file's local imports.
3. **Identifiers.** Search for the `data-testid`, `data-component` and `id` values of the affected elements.
4. **Distinctive classes.** Search for Tailwind class lists. CSS-module names like `PricingCard_card__x1y2` map to `PricingCard.module.css`.
5. **Visible text snippets**, for copy changes.
6. **Changed properties.** Find the files that set them, e.g. `align-items` or `items-center`.

At most 5 top-ranked files go to the AI, each cut down to windows around the matching lines.

### 13.4 Why search/replace edits instead of unified diffs

LLMs often get line numbers or context wrong in unified diffs. Instead, VisualGuard asks for `{ file, search, replace, reason }` blocks:

- Each `search` must match the file **exactly once**.
- A unified diff is then rendered locally with jsdiff for display.

Validating this is simple and the result is deterministic.

### 13.5 Verification needs a local server

The staging URL serves the **deployed** code, so a patch made locally can't be checked against it. `fix.verify.server` starts your dev server (or uses one that's already running), captures the route on `localhost`, and diffs it against production.

Without a configured server, `fix` can still propose and apply patches, but marks them **unverified**.

### 13.6 Example session

```
VisualGuard wants to modify:

  src/components/CheckoutSummary.tsx

Reason
  CTA alignment differs from production (align-items: center → flex-start).

Proposed change
  @@ src/components/CheckoutSummary.tsx
  - <div className="flex items-start gap-4">
  + <div className="flex items-center gap-4">

Apply this change? (y/N) y

  ✓ Applied
  ✓ pnpm tsc --noEmit
  ✓ pnpm lint
  ✓ Dev server ready on http://localhost:3000
  ✓ /checkout captured again: 0 differing pixels vs production

  0 remaining differences.

Create a branch and open a PR? (y/N)
```

---

## 14. Watch mode and baselines

### 14.1 Watch mode

`visualguard watch` compares your local dev server against production (or baselines) while you code:

- Watches the `fix.include` paths (recursive `fs.watch`) with a 500 ms debounce.
- Captures again only the routes linked to the changed files, using the route → file map from §6.4 and §13.3. If no route is linked, it captures everything that matches `--only`.
- Keeps a terminal table that updates live. If the report server is running, it refreshes too.

### 14.2 Baseline mode

Comparing production with staging needs two deployments. Baseline mode compares against screenshots you've approved before:

- Turn it on with `mode: "baseline"`. Run `visualguard test --update-baselines` to write baselines to `visualguard/baselines/`. Commit them (Git LFS recommended) or keep them in the CI cache.
- The DOM JSON is stored next to each image, so DOM mapping still works.
- This mode powers the zero-config single-URL scan and local workflows that have no staging site.
- Everything else (diff, mapping, AI, reports) is the same pipeline. Only the "production" side comes from disk.

---

## 15. Security and privacy

- **Secrets.** API keys are read only from env or `.env*`. The config schema rejects literal keys. Keys are redacted from all logs, including `--debug`.
- **PII in screenshots.** Masking happens in the browser before the image is saved or sent anywhere. The run and report directories are gitignored by default.
- **What is sent to the AI:**
  - Default: image crops, thumbnails and DOM deltas.
  - Source code: only when `fix` is enabled and consent has been given.
  - Nothing at all with `--no-ai` or `provider: "none"`.
  - The privacy notices for each provider are in §10.2 and §10.3.
- **Report server.** Binds to `127.0.0.1` on a random port. Every action that changes something requires the session token.
- **Fixer.** Edits only allowlisted paths. `--auto` runs isolated in a worktree.
- **Telemetry.** None.
- **Supply chain.**
  - Few dependencies, and a committed lockfile.
  - npm provenance on every release.
  - Dependabot and `npm audit` in CI.
  - An SBOM published with each release.
- **Output escaping.** PR comments, job summaries and the HTML report escape all user-controlled content.

---

## 16. Repository structure

```
visualguard/
├── PLAN.md
├── README.md
├── package.json                      # private workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.mjs · prettier.config.mjs
├── .changeset/
├── .github/workflows/
│   ├── ci.yml                        # lint · typecheck · unit · e2e (ubuntu/macos/windows × Node 22/24)
│   ├── release.yml                   # changesets → npm (trusted publishing + provenance)
│   └── evals.yml                     # manual trigger: AI eval suite
│
├── packages/
│   └── visualguard/                  # the ONE published package
│       ├── package.json              # bin: visualguard · exports: "." (+ "./playwright" later)
│       ├── tsdown.config.ts
│       ├── src/
│       │   ├── index.ts              # defineConfig, createRun, public types
│       │   ├── cli/
│       │   │   ├── main.ts
│       │   │   ├── commands/         # scan · init · doctor · test · report · analyze · accept · comment · fix · watch
│       │   │   └── ui/               # terminal renderer, tables, boxes, spinners
│       │   ├── config/               # schema.ts · load.ts · defaults.ts · discover/{nextjs,sitemap,crawl}.ts
│       │   ├── core/                 # run.ts · events.ts · manifest.ts · paths.ts · errors.ts · accepted.ts
│       │   ├── capture/              # browser.ts · stabilize.ts · screenshot.ts · dom-snapshot.ts · health.ts
│       │   ├── diff/                 # engine.ts · pixelmatch.ts · odiff.ts · normalize.ts · regions.ts · shift.ts · worker.ts
│       │   ├── mapping/              # match.ts · deltas.ts · describe.ts
│       │   ├── ai/
│       │   │   ├── provider.ts
│       │   │   ├── providers/        # gemini.ts · ollama.ts · none.ts
│       │   │   ├── tasks/            # analyze-diff.ts · locate-source.ts · generate-patch.ts
│       │   │   ├── prompts/
│       │   │   └── schemas.ts · cache.ts · images.ts
│       │   ├── fixer/                # locate.ts · edits.ts · apply.ts · verify.ts · git.ts · dev-server.ts
│       │   ├── reporters/            # terminal · json · html · junit · github-summary · github-comment · webhook
│       │   └── server/               # report server + local action API
│       ├── report-app/               # Vite + React SPA source → built into dist/report-app
│       └── test/
│
├── fixtures/
│   └── site/                         # static pages, each with production/ and staging/ variants
├── evals/                            # labelled cases + runner
├── examples/
│   ├── nextjs/                       # Next.js app; VARIANT=staging switches on seeded regressions
│   └── react-vite/
└── apps/
    └── docs/                         # Next.js docs site (Phase 9)
```

This keeps the **one npm package** rule. The workspace exists only to give examples, fixtures, evals and docs somewhere to live. The `src/` folders correspond one-to-one to the future packages (`cli`, `core`, `playwright`, `diff`, `ai`, `reporter`, `fixer`), so splitting later is mechanical.

---

## 17. Testing strategy

| Layer       | What it covers                                                                                    | How                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Unit        | Config schema, URL resolution, route discovery, normalisation, regions, shift detection, matching, deltas, edit-block validation, manifest | vitest with synthetic PNG buffers              |
| Integration | The full `test` pipeline                                                                          | The fixture site served on localhost in two variants; assert the status of each job |
| Determinism | The same site captured twice gives 0 diff                                                         | Run the fixtures 10× in CI on every OS. Any diff fails the build        |
| AI contract | Providers parse, validate and retry correctly                                                     | Recorded responses (MockProvider). Live tests only with `VG_LIVE_AI=1`   |
| AI quality  | Classification accuracy                                                                           | The `evals/` runner, via a manual workflow, with results tracked over time |
| CLI         | Output and exit codes                                                                             | Spawn the built binary, strip ANSI codes, compare snapshots              |
| Report app  | The UI                                                                                            | Playwright e2e against a fixture manifest. VisualGuard also tests its own report |
| Fixer       | End to end                                                                                        | Seeded regressions in `examples/nextjs`. `fix --auto` must resolve each one and confirm it visually |

**Fixture catalogue.** Each case exists as a production and a staging variant, and has an expected status:

| Case                                     | Expected                       |
| ---------------------------------------- | ------------------------------ |
| Identical                                | pass                           |
| Anti-aliasing / font-hinting noise       | pass                           |
| Animated element                         | pass (captures are stable)     |
| Dynamic timestamp (masked)               | pass                           |
| Text copy change                         | review                         |
| Brand colour change                      | review                         |
| Padding / spacing change                 | review or regression           |
| Flex alignment regression                | regression                     |
| Banner inserted (layout shift)           | review, with a single root cause |
| Missing / broken image                   | regression                     |
| Horizontal overflow on mobile            | regression                     |
| Overlapping elements                     | regression                     |
| Element hidden                           | regression                     |

---

## 18. Release and distribution

- **Name.** `visualguard` was free on npm as of 2026-10-08, and so were `visual-guard` and `@visualguard/cli`. Publish a `0.0.1` placeholder in Phase 0 to reserve it, and consider claiming the `@visualguard` scope too.
- **Versioning.** Semver. Stay on `0.x` until the config and manifest schemas are stable. Changesets generate the changelog.
- **Publishing.** From GitHub Actions using npm trusted publishing (OIDC) with provenance. No long-lived tokens.
- **`package.json` fields:**
  - `"type": "module"`, `bin`, an `exports` map, and a `files` allowlist (`dist`)
  - `engines.node: ">=22"`
  - `playwright` as an **optional** peer dependency. `analyze`, `report` and `comment` work without it, and `test` prints the install command if it's missing.
- **Size budget.** CI tracks install size. Heavy dependencies are optional and load only when used.
- **License.** MIT.
- **Docs.** Start with a README quickstart, then build the docs site. It covers a config reference generated from the zod schema, CI recipes, guides for each AI provider, and a flakiness FAQ.

---

## 19. Roadmap

Effort is a rough estimate in **focused working days for one developer**. Each phase ends with a **done when** checklist, and a phase isn't finished until every item is met.

### Phase 0: Foundation (2–3 days)

- Set up the workspace, tsconfig, tsdown, eslint/prettier, vitest, changesets and the CI workflow.
- `npx visualguard --version` works from a packed tarball (`pnpm pack` → install in a temp project).
- Reserve the npm name.
- **Done when:** CI is green on Linux, macOS and Windows, and the packed CLI runs.

### Phase 1: Capture and diff MVP (6–8 days)

- Config schema and loader (`defineConfig`), explicit routes, viewports.
- URL resolver (§6.5) with `--production`, `--staging`, `--route`, `--list` and per-environment paths.
- Capture both environments with the full stabilisation list from §7.
- pixelmatch diff, size normalisation, region extraction.
- Run directory, `manifest.json` v1, terminal and JSON reporters, exit codes.
- The first 6 fixture cases.
- **Done when:** the fixture statuses are correct, the determinism suite gives 0 diffs across 10 runs, every joining rule in §6.5 has a unit test, and it works on one real Next.js site.

### Phase 2: Setup and zero-config (4–5 days) → **release 0.1.0**

- `init` (detection, prompts, file writes, `--yes`) and `doctor`.
- Route discovery: Next.js `app/` and `pages/`, sitemap, crawl.
- Zero-config single-URL scan (health checks and snapshots) and two-URL comparison.
- **Done when:** someone can go from a fresh Next.js app through `init` → `test` in under 5 minutes using only the README.

### Phase 3: HTML report (6–8 days)

- The report app: overview, job list, four compare modes, region overlays, health tab.
- Static generation, plus the `report` command and server.
- **Done when:** the report opens from `file://`, from a CI artifact and in served mode; it's fully keyboard-navigable; and Lighthouse accessibility scores ≥ 95.

### Phase 4: DOM mapping and heuristics (5–6 days) → **0.2.0**

- DOM snapshots, element matching, style/text/box/presence deltas.
- Heuristic descriptions, layout-shift detection, and the `none` classifier.
- **Done when:** for every fixture, the explanation without AI names the right element and property.

### Phase 5: AI analysis (6–8 days) → **0.3.0**

- The provider contract, Gemini and Ollama providers, `analyzeVisualDiff`.
- Cache, budget, backoff, token reporting, the `analyze` command.
- The evals runner and the first 30–50 cases.
- **Done when:**
  - the eval targets are met on the default Gemini model,
  - the Ollama path works fully offline, and
  - AI failures fall back to heuristics without failing the run.

### Phase 6: CI and GitHub (4–5 days) → **0.4.0, the first "CI-ready AI tool" release**

- `--ci`, the JUnit reporter, the job summary, `comment` (sticky PR comment).
- `accept` and the accepted list, the workflow template in `init`, the preview-deployment recipe, the webhook reporter.
- **Done when:** an example repo has a PR with a sticky comment that updates on each push and links to the report artifact.

### Phase 7: Interactive fix (8–10 days) → **0.5.0**

- Source locator, `generatePatch` with search/replace edits, validation.
- The confirmation UI, consent flow, and verification pipeline (commands, local server, fresh capture), with retry and revert.
- **Done when:** the seeded regressions in `examples/nextjs` (alignment, colour, spacing) are fixed and confirmed visually through the interactive flow.

### Phase 8: Automatic fix and watch mode (6–8 days) → **0.6.0**

- `fix --auto` in a worktree, and `--pr` via `gh` or the REST API.
- The `watch` command, the report's "Generate fix" action, and baseline mode.
- **Done when:** a CI job can run `fix --auto --pr` and open a PR that resolves a seeded regression.

### Phase 9: Hardening for 1.0 (ongoing)

- **`visualguard/playwright` fixture:** `await visualguard.capture(page, "checkout")` inside existing Playwright tests.
- **Platform:** Firefox and WebKit, the `auth` helper, the odiff engine.
- **Distribution:** the official GitHub Action and the Next.js docs site.
- **More providers** (OpenAI, Anthropic) through the same contract.
- **A plugin API** for custom reporters and engines.
- **1.0 criteria:** frozen schemas, the success metrics in §1, complete docs, and two real projects running it in CI.

### Timeline summary

| Milestone | After phase | What users get                                  | Cumulative effort |
| --------- | ----------- | ----------------------------------------------- | ----------------- |
| 0.1.0     | 2           | Repeatable prod ↔ staging pixel diffs, `init`, zero-config | ~12–16 days |
| 0.2.0     | 3 + 4       | HTML report, explanations without AI            | ~23–30 days       |
| 0.3.0     | 5           | Gemini and Ollama analysis                      | ~29–38 days       |
| 0.4.0     | 6           | CI and PR integration                           | ~33–43 days       |
| 0.5.0     | 7           | Interactive fix                                 | ~41–53 days       |
| 0.6.0     | 8           | Automatic fix, watch, baselines                 | ~47–61 days       |

---

## 20. Risks

| Risk                                                           | Impact                                     | Mitigation                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Flaky captures                                                 | False positives make users disable the tool | Determinism suite in CI, stability loop, masks and hides, quiet-window waits                                |
| Production and staging content differ (CMS, prices, A/B tests) | Noise                                      | The `content` classification, masks, `beforeCapture` hooks, and docs on seeding staging data                 |
| AI misclassifies a change                                      | Missed regressions or extra noise          | AI can never overrule hard failures (principle 8), evals, a conservative noise threshold, `review` as the fallback |
| Gemini free-tier quotas, terms or model lineup change          | Runs slow down or fail                     | Budgets, backoff, cache, model aliases, `doctor` checks, the Ollama fallback                                 |
| Very tall pages                                                | Memory and time                            | `maxHeight`, a worker pool, concurrency that accounts for memory                                             |
| Staging behind auth                                            | Can't capture                              | `storageState`, headers, hooks, the `auth` helper                                                            |
| Fixer breaks code                                              | Loss of trust                              | Off by default, confirmation, path allowlist, visual verification, worktree isolation, revert                |
| Scope creep (seven packages, n8n, SaaS)                        | The project never ships                    | One package, phase gates, and shipping 0.1.0 with no AI at all                                               |
| npm name collision or similarity rules                         | Can't publish                              | Reserve the name in Phase 0; fall back to `@visualguard/cli`                                                 |

---

## 21. Open decisions

| # | Decision                                                  | Recommendation                                                                         |
| - | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 | Output directory: `./visualguard` (your sketch) or `.visualguard/` | `.visualguard/`, because it's generated output and gitignored                   |
| 2 | Report UI stack                                           | Vite + React SPA for the report; Next.js for the docs site                             |
| 3 | Build the report UI on zentauri-ui?                       | Yes, if its components are tree-shakeable and can be bundled into a static SPA. Check during Phase 3 |
| 4 | Ship baseline mode in v1?                                 | Yes, a minimal version, because the zero-config single-URL mode needs it               |
| 5 | Default Gemini model                                      | A moving "flash" alias. Check again at the start of Phase 5                            |
| 6 | Default `--fail-on`                                       | `regression`                                                                           |
| 7 | Workspace now or later?                                   | Now (package + examples + fixtures + evals), with one published package               |
| 8 | License                                                   | MIT                                                                                    |
| 9 | Use `next build && next start` from `examples/nextjs` as a stand-in for staging in CI? | Yes: two ports, `VARIANT` env switch, no external deployment needed |

---

## 22. Next steps

1. Confirm the open decisions in §21.
2. **Phase 0:** scaffold the workspace in this folder and reserve the npm name.
3. Build the **fixture site before the capture engine**. The fixture cases are the spec for Phases 1–5.
4. Write the Phase 1 capture/diff pipeline against the fixtures, then try it on a real Next.js site.

---

## Appendices

### A. `manifest.json` (abbreviated)

```json
{
  "schemaVersion": 1,
  "id": "0042_2026-10-08T10-22-01Z",
  "number": 42,
  "startedAt": "2026-10-08T10:22:01.000Z",
  "durationMs": 72140,
  "tool": { "version": "0.4.0", "playwright": "1.5x.x", "node": "22.14.0" },
  "config": {
    "baseURL": { "production": "https://example.com", "staging": "https://staging.example.com" },
    "ai": { "provider": "gemini", "model": "gemini-flash-latest" }
  },
  "summary": { "pass": 45, "accepted": 1, "review": 1, "regression": 1, "error": 0 },
  "jobs": [
    {
      "id": "checkout__desktop",
      "route": "/checkout",
      "viewport": "desktop",
      "status": "regression",
      "diff": { "width": 1440, "height": 2310, "diffPixels": 4120, "diffRatio": 0.00124 },
      "regions": [
        {
          "id": 0,
          "box": { "x": 812, "y": 640, "width": 420, "height": 96 },
          "diffPixels": 3980,
          "elements": [{ "selector": "div.checkout-summary > .actions", "tag": "div" }],
          "deltas": [
            {
              "kind": "style",
              "selector": "div.checkout-summary > .actions",
              "property": "align-items",
              "production": "center",
              "staging": "flex-start"
            }
          ],
          "heuristic": "Alignment changed: align-items center → flex-start"
        }
      ],
      "analysis": {
        "classification": "regression",
        "confidence": 0.93,
        "title": "Pay button no longer vertically centred",
        "summary": "The actions row in the order summary switched from centred to top alignment, so the pay button sits 12px higher than the total.",
        "evidence": ["align-items: center → flex-start on .actions", "button[data-testid=pay] moved 12px up"],
        "affected": [{ "selector": "div.checkout-summary > .actions", "component": "CheckoutSummary" }],
        "suggestedFix": { "description": "Restore centred alignment", "snippet": "- items-start\n+ items-center" },
        "provider": "gemini",
        "model": "gemini-flash-latest",
        "promptVersion": "diff-v1",
        "cached": false
      }
    }
  ]
}
```

### B. `analyzeVisualDiff` prompt sketch

```
SYSTEM
You are a senior frontend engineer reviewing visual differences between the
PRODUCTION and STAGING versions of the same web page.

Classify the change as exactly one of:
- regression : misalignment, overlap, clipping, overflow, missing/broken elements
               or images, unreadable contrast, layout broken at this viewport
- intentional: a coherent, deliberate-looking change (new copy, consistent restyle,
               new feature)
- content    : data/CMS differences (prices, posts, dates) not caused by code
- noise      : sub-pixel rendering, anti-aliasing, font hinting

Rules:
- Base every claim on the images or the DOM deltas provided. Never invent CSS,
  selectors, or file names.
- Use only selectors that appear in the DOM deltas.
- If unsure whether a change is deliberate, answer "intentional" with lower
  confidence; a human will review it.
- Respond with JSON matching the provided schema, nothing else.

USER
Route: /checkout   Viewport: desktop 1440×900
Heuristics: no layout shift · console errors 0 / 0 · failed requests 0 / 0

Region 1 of 1 · box {x: 812, y: 640, w: 420, h: 96}
DOM deltas:
  div.checkout-summary > .actions   align-items: center → flex-start
  button[data-testid=pay]           box.y: 664 → 652

[image] production crop
[image] staging crop
[image] diff crop
```

### C. GitHub Actions workflow

```yaml
name: VisualGuard

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  visualguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}
      - run: pnpm exec playwright install --with-deps chromium

      - name: Visual regression test
        id: vg
        continue-on-error: true
        run: pnpm exec visualguard test --ci
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          VISUALGUARD_STAGING_URL: ${{ vars.STAGING_URL }}

      - name: Upload report
        id: upload
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: visualguard-report
          path: .visualguard/runs/*/report

      - name: Comment on PR
        if: always()
        run: pnpm exec visualguard comment --link "${{ steps.upload.outputs.artifact-url }}"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Fail on regressions
        if: steps.vg.outcome == 'failure'
        run: exit 1
```

### D. PR comment template

````md
<!-- visualguard:report -->
## 🤖 VisualGuard

**🔴 1 regression** · 🟡 1 needs review · ✅ 45 passed · ☑️ 1 accepted · [View full report](https://…)

|     | Route       | Viewport | Finding                                   |
| --- | ----------- | -------- | ----------------------------------------- |
| 🔴  | `/checkout` | desktop  | Pay button no longer vertically centred   |
| 🟡  | `/pricing`  | desktop  | Hero copy changed (looks intentional)     |

<details>
<summary>🔴 <code>/checkout</code> · desktop · regression (model confidence 0.93)</summary>

**Element** `div.checkout-summary > .actions`
**Change** `align-items: center → flex-start`
**Likely source** `src/components/CheckoutSummary.tsx`

```diff
- <div className="flex items-start gap-4">
+ <div className="flex items-center gap-4">
```

Run `npx visualguard fix --only /checkout` locally to apply and verify.

</details>

<sub>VisualGuard 0.4.0 · gemini-flash-latest · run #128 · accept intentional changes with <code>npx visualguard accept &lt;route&gt;</code></sub>
````
