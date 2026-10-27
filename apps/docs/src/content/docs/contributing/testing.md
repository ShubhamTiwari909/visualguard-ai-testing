---
title: "Run the test suites"
description: "Run every VisualGuard test suite, know what each one covers, and pick the smallest check that proves your change."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-27"
sourcePaths:
  [
    "CONTRIBUTING.md",
    "evals/README.md",
    "evals/run.mjs",
    "evals/labels.json",
    "fixtures/site/README.md",
    "packages/visualguard/vitest.config.ts",
    "apps/platform/vitest.config.ts",
    "scripts/pack-smoke.mjs",
    "scripts/standalone-dashboard-smoke.mjs",
    "scripts/dashboard-runner-smoke.mjs",
    ".github/workflows/ci.yml",
    ".github/workflows/evals.yml",
  ]
sidebar: { "order": 4 }
---

This page lists every test suite in the repository, what each one proves and when to run it. Use it to pick the smallest check that covers your change, and to know what CI will run on your pull request.

## Before you start

- A [source checkout](/contributing/local-setup/) with dependencies installed (`pnpm install`).
- Node.js 22.12 or newer for the package and dashboard. Node 22.22 or newer if you also run the docs checks; Node 24 is recommended. pnpm 9.0.0.
- Playwright Chromium for anything that opens a browser:

  ```bash
  pnpm --filter visualguard exec playwright install chromium
  ```

- Run every command from the **repository root**.

Examples use macOS/Linux shells; on Windows use WSL.

:::caution
The repository's `AGENTS.md` defers formatting, lint and type-check commands (`pnpm format`, `pnpm format:check`, `pnpm lint` and `pnpm typecheck`) during the current feature sequence, until after F36, unless the user changes that instruction. Do not run them locally while the rule stands, and never report them as passed. CI still runs them on pull requests.
:::

## Choose the right check

| You changed…                                              | Run at least                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| One area of the engine, such as the differ or the fixer   | That area's test file, for example `pnpm --filter visualguard exec vitest run test/diff.test.ts`    |
| Capture, comparison, classification or the fixer together | `pnpm build` then `pnpm test`                                                                       |
| Package exports, the report app or the build              | `pnpm build`, `pnpm test` and `pnpm test:pack`                                                      |
| Dashboard server or client (`apps/platform`)              | `pnpm platform:test`, plus the database contract tests if you touched storage                       |
| Dashboard packaging or hosting assets                     | `pnpm platform:build`, `pnpm --filter visualguard build:dashboard` and `pnpm platform:test:package` |
| **Run test**, the built-in runner or the private runner   | `pnpm platform:test`, then `pnpm build` and `pnpm platform:test:runner`                             |
| Classification rules, AI prompts or default models        | `pnpm eval` (see [evaluations](#evaluate-classification-quality))                                   |
| A fixture page                                            | `pnpm build` then `node evals/run.mjs --provider none`                                              |
| Documentation                                             | `pnpm docs:test`, `pnpm docs:build` and `pnpm docs:check-links`                                     |

## 1. Run the engine tests

The engine package (`packages/visualguard`) has the CLI, capture, diff, AI, fixer and report code. Its tests use [Vitest](https://vitest.dev/).

```bash
pnpm test
```

This runs `vitest run` for every `packages/visualguard/test/**/*.test.ts` file. A global setup step builds the report app first, so report tests check the real bundle. Each test has a 30-second limit.

You should see every test file pass. Some suites are skipped unless you turn them on:

| Variable              | What it does                                                                                                   | Default    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| `VG_DETERMINISM_RUNS` | How many times the integration test captures each fixture page; every capture must be identical. CI uses `10`. | `2`        |
| `VG_SMOKE_BROWSER`    | The browser for `test/browser-smoke.test.ts`: `chromium`, `firefox` or `webkit`.                               | `chromium` |
| `VG_E2E_NEXT`         | Set to `1` to build `examples/nextjs`, seed regressions and check that `visualguard fix` repairs them. Slow.   | off        |

To run one file or a few files:

```bash
pnpm --filter visualguard exec vitest run test/reliability.test.ts
pnpm --filter visualguard exec vitest run test/fixer.test.ts test/verification.test.ts
```

To run the cross-browser smoke test in Firefox, install the browser and set the variable:

```bash
pnpm --filter visualguard exec playwright install firefox
VG_SMOKE_BROWSER=firefox pnpm --filter visualguard exec vitest run test/browser-smoke.test.ts
```

The Playwright fixture test (`test/playwright-fixture.test.ts`) builds its own package entry and launches real Playwright tests. Provider tests use a local mock provider (`test/helpers/mock-provider.ts`), so no AI key is needed.

## 2. Run the dashboard tests

The dashboard app (`apps/platform`) has its own Vitest suite under `apps/platform/test/`. It covers authentication, Google sign-in, invitations, users, projects, uploads, reviews, baselines, policies, GitHub checks, operations, backups, test configuration, execution requests, the private runner protocol and the built-in runner.

```bash
pnpm platform:test
```

You should see every SQLite-backed suite pass. Each test has a 15-second limit.

To run one file:

```bash
pnpm --filter @visualguard/platform exec vitest run test/built-in-runner.test.ts
```

### Database contract tests

The PostgreSQL and MongoDB versions of the storage tests are skipped unless you point them at a **disposable** test database. The tests write and delete data, so never use a real database.

| Variable                                  | What it turns on                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `VISUALGUARD_TEST_DATABASE_URL`           | PostgreSQL storage, identity, invitation, baseline, policy and operations contracts. |
| `VISUALGUARD_TEST_MONGODB_URL`            | The same contracts on a MongoDB **replica set**, which supports transactions.        |
| `VISUALGUARD_TEST_MONGODB_STANDALONE_URL` | The limited behavior of a standalone MongoDB server, which has no transactions.      |

This example starts throwaway databases with Docker, the same way CI does:

```bash
docker run -d --name vg-test-postgres -p 5432:5432 \
  -e POSTGRES_USER=visualguard -e POSTGRES_PASSWORD=visualguard -e POSTGRES_DB=visualguard_test postgres:17
docker run -d --name vg-test-mongo -p 27017:27017 mongo:7
docker run -d --name vg-test-mongo-replica -p 27018:27018 mongo:7 --replSet visualguard_ci --port 27018 --bind_ip_all
docker exec vg-test-mongo-replica mongosh --port 27018 --quiet \
  --eval 'rs.initiate({_id: "visualguard_ci", members: [{_id: 0, host: "127.0.0.1:27018"}]})'
```

Wait a few seconds for the replica set to elect a primary, then run the tests:

```bash
VISUALGUARD_TEST_DATABASE_URL=postgresql://visualguard:visualguard@127.0.0.1:5432/visualguard_test \
VISUALGUARD_TEST_MONGODB_URL='mongodb://127.0.0.1:27018/visualguard_test?replicaSet=visualguard_ci' \
VISUALGUARD_TEST_MONGODB_STANDALONE_URL=mongodb://127.0.0.1:27017/visualguard_test \
pnpm platform:test
```

You should see the `postgres` and `mongo` suites run instead of being skipped. Remove the containers afterward with `docker rm -f vg-test-postgres vg-test-mongo vg-test-mongo-replica`.

## 3. Check the packaged artifacts

These checks install what npm users would get, so they catch problems that source tests cannot see.

| Command                      | What it does                                                                                                                                                                                                                                                                                                                                                               | Needs first                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm test:pack`             | Builds, packs `visualguard`, installs the tarball in a throwaway project and checks that `npx visualguard --version` matches `package.json`.                                                                                                                                                                                                                               | Nothing; it builds.                                                   |
| `pnpm platform:test:package` | Packs `visualguard`, installs it in a fresh consumer project with no repository imports, and starts the packaged dashboard. It checks the core API, the dashboard pages and assets, import, publish, backup and restore, runner polling, the message shown when no dashboard is running, and both deployment scaffolds (Vercel and Cloud Run). It needs no browser binary. | `pnpm platform:build` and `pnpm --filter visualguard build:dashboard` |
| `pnpm platform:test:runner`  | Starts a local dashboard and two tiny pages, saves a project test config, creates a runner credential, and runs `visualguard dashboard runner` with real Chromium. It checks the queue, the claim, live progress, the uploaded result, that the saved config wins over runner settings, and that a revoked credential stops working.                                       | `pnpm build` and Playwright Chromium                                  |

You should see a final `passed` line from each script. Each one deletes its temporary folders and stops its servers, even after a failure.

:::note
`platform:test:runner` tests the **private runner** path end to end. The **built-in runner** (the dashboard host running **Run test** itself, in `apps/platform/server/built-in-runner.ts`) is covered by the unit tests in `apps/platform/test/built-in-runner.test.ts`. It shares its execution code with the private runner through `executeClaimedTest` in `test-runner.ts`. Use `pnpm docs:smoke:host` to exercise source dashboard-host capture with real Chromium and SQLite. Installed-package availability is checked through the dashboard's execution status.
:::

## 4. Run the documentation checks

The docs site has its own checks. [Work on the documentation](/contributing/documentation/) explains each one and how to fix failures.

```bash
pnpm docs:test
pnpm docs:build
pnpm docs:check-links
```

| Command                 | What it covers                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm docs:test`        | Page metadata, the coverage map, the quickstart example, Action inputs and generated reference drift.                                                                               |
| `pnpm docs:build`       | Builds the static site.                                                                                                                                                             |
| `pnpm docs:check-links` | Internal links, assets and anchors in the built site. Run after `docs:build`.                                                                                                       |
| `pnpm docs:smoke`       | Optional and slow. Installs the published release in a throwaway project, follows the quickstart and the local SQLite dashboard guide. Needs Chromium and free ports 4100 and 4101. |

## Evaluate classification quality

The evaluation runner measures how well VisualGuard classifies visual differences. Each route in [`evals/labels.json`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/evals/labels.json) is a page in [`fixtures/site`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/fixtures/site) with a production and a staging variant. The label is what a human reviewer would call the difference:

| Label         | Meaning                                                          |
| ------------- | ---------------------------------------------------------------- |
| `regression`  | Broken: misalignment, overlap, clipping, overflow or missing UI. |
| `intentional` | A deliberate change: new copy, a restyle or a new element.       |
| `content`     | Data changes: prices, posts or dates.                            |
| `noise`       | Rendering differences nobody would notice.                       |

Every route runs at desktop and mobile, so the labels give about 40 cases.

```bash
pnpm eval                                        # heuristics only (the baseline)
pnpm eval -- --provider gemini                   # needs GEMINI_API_KEY
pnpm eval -- --provider gemini --model <id>
pnpm eval -- --provider ollama --model qwen2.5vl
```

`pnpm eval` builds the package first. After a build you can call `node evals/run.mjs` directly with the same options.

| Option                       | What it does                                                        | Default                |
| ---------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `--provider`                 | The AI provider: `none`, `gemini` or `ollama`.                      | `none`                 |
| `--model`                    | The model ID for the provider.                                      | The provider's default |
| `--viewports`                | A comma-separated list from `desktop` and `mobile`.                 | `desktop,mobile`       |
| `--cache`                    | Reuses cached AI answers.                                           | off                    |
| `--all-ai`                   | Sends every difference to the AI, not only the uncertain ones.      | off (uncertain only)   |
| `--min-regression-recall`    | Fails the run if regression recall is below this number.            | not set                |
| `--min-regression-precision` | Fails the run if regression precision is below this number.         | not set                |
| `--max-false-alarm-rate`     | Fails the run if more than this share of `noise` cases do not pass. | not set                |

You should see precision and recall per class, a confusion matrix and the misses. The results are saved to `evals/results/`. Run it before changing prompts or default models. The 1.0 target is regression precision of at least 0.85 and recall of at least 0.90 on the default Gemini model.

Without AI, statuses stand in for classes: `regression` counts as regression, `review` as intentional and `pass` as noise. So heuristics can never score on `content`.

### Evaluation rules and gates

- Whether a case counts comes from its label, never from the detector result. An unexpected `pass` stays in the total. A missing or failed capture is scored as an error.
- Results report hybrid-policy precision, recall, false-green rate and false-alarm rate separately from model-only accuracy. The false-alarm rate is the share of `noise` cases that ended as anything other than `pass` or `accepted`: a page a person would have been asked to look at for nothing. They also include the sample size, fallback count, dataset and prompt versions, and confidence bins.
- Every applicable case stays scored, even when AI is skipped or a budget runs out.
- Confidence bins show calibration and should guide changes to `noiseConfidence`. A model's self-reported confidence is not a probability.

These are the gates CI uses, after a build:

```bash
node evals/run.mjs --provider none --min-regression-recall 0.64 --min-regression-precision 0.85 --max-false-alarm-rate 0
node evals/run.mjs --provider gemini --all-ai --min-regression-recall 0.9 --min-regression-precision 0.85
```

The heuristic gate runs on every pull request. Its recall floor matches today's heuristic score, so a change that loses a detection fails, and no `noise` page may need review. The Gemini gate runs weekly and by hand in the **Evals** workflow when a `GEMINI_API_KEY` secret exists; without it, that workflow runs the heuristic gate. The thresholds are targets to test against, not a claim about measured live model performance.

## Add a regression fixture

Add a fixture when you fix a detection bug, so the bug cannot come back.

1. Add matching HTML and assets under `fixtures/site/production/` and `fixtures/site/staging/`. Keep the content deterministic unless you are deliberately testing noise. For a page that should never differ, such as one with slow or moving content, keep both variants identical, label it `noise`, and add it to the determinism test in `test/integration.test.ts`.
2. Add the route and its expected class to `evals/labels.json`. Use a per-viewport map if the case applies only to mobile.
3. Build and run the heuristic evaluation:

   ```bash
   pnpm build
   node evals/run.mjs --provider none
   ```

   You should see the new route in the results.

Never remove a case from evaluation because the detector misses it. Tests should check behavior a user can observe: status and exit codes, source rollback after a failed fix, preserved capture state, or the right reference artifact being picked. Provider tests use local mocks; live API keys belong only in controlled evaluation runs.

To look at the fixtures in a browser, start both variants on ports 4100 and 4101:

```bash
node scripts/serve-fixtures.mjs
```

### Included site fixtures

Every page exists in a `production/` and a `staging/` variant. The fixture server serves `/name` from `name.html` and replaces `{{origin}}` in `.xml` and `.txt` files. Add `?delay=<ms>` (up to 5000) to an asset URL to make it arrive late. The web font and video are generated by `node scripts/make-fixture-assets.mjs`, which needs ffmpeg. The test helper is `packages/visualguard/test/helpers/fixture-server.ts`; the scripts use `scripts/fixture-server.mjs`.

| Page                                    | Difference on staging                        | Expected without AI                       |
| --------------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `/` `/identical` `/pricing` `/checkout` | none                                         | pass                                      |
| `/animated`                             | none (infinite animation and transition)     | pass                                      |
| `/dynamic`                              | random price (masked) and clock (frozen)     | pass                                      |
| `/dynamic-change`                       | random price (not masked) and CTA colour     | review: only the CTA (noise map)          |
| `/a11y`                                 | image `alt` and button label removed         | pass (with `--a11y`: review)              |
| `/heavy`                                | 60 KB script added, same pixels              | pass (with `--perf`: review)              |
| `/marked-dynamic`                       | random text marked `data-visualguard-ignore` | pass                                      |
| `/text-change`                          | CTA copy "Start free trial" to "Start trial" | review: text change on the CTA            |
| `/color-change`                         | CTA background colour                        | review: background-color on the CTA       |
| `/alignment`                            | `align-items: center` to `flex-start`        | review: align-items on `div.actions`      |
| `/spacing`                              | feature card padding 24px to 12px            | review: padding on `div.card`             |
| `/layout-shift`                         | banner inserted above the hero               | review: one shift caused by the banner    |
| `/missing-image`                        | image points to a missing file               | regression: broken image                  |
| `/overflow`                             | promo box wider than a 390px viewport        | regression on mobile: horizontal overflow |
| `/overlap`                              | badge moved on top of the hero               | regression: new overlap                   |
| `/hidden`                               | CTA hidden                                   | regression: control missing               |
| `/contrast`                             | paragraph text turned light grey             | regression: low contrast                  |
| `/clipped`                              | CTA narrowed, text cut off                   | regression: text cut off                  |
| `/misaligned-grid`                      | one card pushed down 28px                    | review (AI: regression)                   |
| `/wrapped-nav`                          | larger nav links wrap the header             | review (AI: regression)                   |
| `/font-size`                            | bigger heading                               | review (AI: intentional)                  |
| `/nav-item`                             | new "Blog" link                              | review (AI: intentional)                  |
| `/rounded`                              | rounder cards and pill buttons               | review (AI: intentional)                  |
| `/button-style`                         | uppercase dark buttons                       | review (AI: intentional)                  |
| `/price`                                | $49 to $59                                   | review (AI: content)                      |
| `/blog-list`                            | different posts                              | review (AI: content)                      |
| `/footer-year`                          | © 2025 to © 2026                             | review (AI: content)                      |
| `/subpixel`                             | text nudged 0.4px                            | pass: sub-pixel rendering noise           |
| `/subpixel-paragraph`                   | full-width paragraphs nudged 0.4px           | pass: sub-pixel rendering noise           |
| `/web-font`                             | none (web font arrives after 800 ms)         | pass                                      |
| `/lazy-images`                          | none (slow lazy images, some unsized)        | pass                                      |
| `/video`                                | none (autoplaying looping video)             | pass                                      |
| `/sticky-header`                        | none (sticky header, fixed buttons)          | pass                                      |

## What CI runs

The **CI** workflow (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`:

| Job               | What it runs                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`        | `pnpm platform:test` against real PostgreSQL 17, standalone MongoDB 7 and a MongoDB replica set, then `platform:build`, `build:dashboard` and `platform:test:package`.                         |
| `lint`            | `pnpm lint`, `pnpm format:check` and `pnpm typecheck`.                                                                                                                                         |
| `test`            | On Ubuntu, macOS and Windows with Node 22 and 24: `pnpm build`, `pnpm test` with `VG_DETERMINISM_RUNS=10` and the pack smoke test. On Ubuntu with Node 22 it also runs `platform:test:runner`. |
| `browser-smoke`   | The browser smoke test in Firefox and WebKit.                                                                                                                                                  |
| `heuristic-evals` | The heuristic evaluation gate, with results uploaded as an artifact.                                                                                                                           |
| `example-nextjs`  | The Next.js example repair test (`VG_E2E_NEXT=1`).                                                                                                                                             |

The **Documentation** workflow runs the docs checks, and the **Evals** workflow runs the weekly AI evaluation.

## Verify your change

- The focused tests for the area you changed pass, plus any broader suite from [Choose the right check](#choose-the-right-check).
- New behavior has a test that would fail without your change.
- In your pull request, list exactly which commands you ran. Do not list deferred checks as passed.
- CI is green before merging.

## Report a bug well

A useful bug report contains the Node, Playwright and VisualGuard versions, the browser and platform, the expected and actual status, a minimal route or fixture, and a redacted configuration. Share the whole report folder when screenshots are needed. Remove private page text, screenshots, source edits, credentials and tokens before sharing in public.

## Troubleshooting

| Problem                                                             | Fix                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Executable doesn't exist` or a browser launch error                | Install the browser: `pnpm --filter visualguard exec playwright install chromium`.            |
| `Cannot find module …/dist/…` in a smoke script or eval             | Build first with `pnpm build`.                                                                |
| `platform:test:package` cannot find dashboard assets                | Run `pnpm platform:build` and `pnpm --filter visualguard build:dashboard` first.              |
| PostgreSQL or MongoDB suites are skipped                            | Set the matching `VISUALGUARD_TEST_*` variable to a disposable database.                      |
| MongoDB replica-set tests fail with a transaction error             | The replica set has no primary yet. Wait a few seconds after `rs.initiate`, then retry.       |
| The integration test reports differences between identical captures | Something on the page is not deterministic. Mask it, freeze it or fix the fixture.            |
| `node scripts/serve-fixtures.mjs` fails to start                    | Ports 4100 or 4101 are in use. Pass other ports: `node scripts/serve-fixtures.mjs 5100 5101`. |

For problems that users also see, check [capture troubleshooting](/troubleshooting/capture/) and [dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Read the architecture](/contributing/architecture/) to find the code a test covers.
- [Learn the codebase](/contributing/reading-the-code/) file by file.
- [Prepare a package release](/contributing/releases/) once your change is merged.
- [Read the reliability changes](/releases/migration/) for the invariants the tests protect.
