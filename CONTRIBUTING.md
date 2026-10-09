# Contributing to VisualGuard

Use Node ≥22.12 and the pnpm version declared in the root package manifest. Install dependencies with `pnpm install` and Chromium with `pnpm --filter visualguard exec playwright install chromium`.

## Architecture

The published package lives in `packages/visualguard`. Configuration and discovery feed `core/run.ts`; `capture/` creates screenshots and health signals; `diff/` produces pixel regions; `mapping/` explains DOM changes; `core/comparison.ts` shares classification policy with the Playwright fixture; `ai/` owns structured requests, caching and budgets; `fixer/` proposes and verifies edits; `reporters/` and `report-app/` present the evidence.

Read [reliability changes](docs/RELIABILITY-CHANGES.md) for invariants and migrations. The older design sketches in `PLAN.md` are historical context, not a current API reference.

## Focused validation

```sh
pnpm --filter visualguard exec vitest run test/reliability.test.ts
pnpm --filter visualguard exec vitest run test/fixer.test.ts test/verification.test.ts
pnpm --filter visualguard typecheck
pnpm lint
pnpm format:check
```

Run `pnpm build` when changing package exports or the report bundle. Run `pnpm test` for changes spanning the capture/comparison/fixer interfaces. `pnpm test:pack` checks the installed npm artifact. The Playwright fixture test builds its own package entry and launches Playwright tests.

## Adding a regression fixture

Add matching HTML/assets under `fixtures/site/production` and `fixtures/site/staging`. Keep content deterministic except when deliberately testing noise. Add the expected route/viewport classification to `evals/labels.json`; use an explicit viewport map if a case applies only to mobile. Never remove a detector miss from evaluation based on its output.

Run `pnpm build` followed by `node evals/run.mjs --provider none`. Tests should exercise observable behavior: status/exit policy, source rollback, preserved capture state, or correctly selected reference artifacts. Provider tests should use local mocks; live API keys belong only in controlled evaluation runs.

## Reports and issues

A useful bug report contains the Node/Playwright/VisualGuard versions, browser/platform, expected and actual status, a minimal route or fixture, and a redacted configuration. Share the entire report directory when screenshots are needed. Remove private DOM text, screenshots, source edits, credentials and tokens before public sharing.

## Releases

Use `pnpm changeset` to describe user-visible changes and migrations. CI runs lint/format/type checks, the Node/OS test matrix, browser smoke checks, package smoke tests and heuristic evaluation gates. The changesets release workflow handles versioning/publishing. Do not describe a release as published until publishing is confirmed.
