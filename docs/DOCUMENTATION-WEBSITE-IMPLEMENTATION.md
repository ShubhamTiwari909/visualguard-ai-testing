# Documentation website implementation

Branch: `codex/documentation-website`. Plan: [documentation website plan](DOCUMENTATION-WEBSITE-PLAN.md).

## D01 — Foundation

Added the private `apps/docs` Astro workspace, Starlight article layout/navigation, React setup chooser, Tailwind v4 compatibility layers, applicability metadata, favicon and local development instructions. Root commands target only the docs workspace. The existing CLI/platform runtime and unrelated local edits are preserved.

Resolved stack: Astro 7.4.1, Starlight 0.42.6, React integration 6.0.0, React 19.3.0, Tailwind 4.3.3 and Starlight Tailwind 5.0.0. The React integration is pinned to the compatible stable 6.0.0 release because 7.1.0's React-transform peer ranges conflict with its current Vite plugin dependency. The root lockfile records the tested set. Docs require Node 22.22+; this run uses Node 24.13.0 and pnpm 9.0.0. Existing MongoDB peer warnings in the platform/engine remain outside this change.

Validation: focused docs production build passed. Starlight generated the static homepage, contributor guide, 404 and Pagefind index. This early phase intentionally precedes the article migration; full link/content acceptance follows in D07. No formatting, lint or semantic type checks ran. Astro's build-time content declarations are not a semantic type check.

## D02 — First comparisons and source setup

Added setup selection/requirements, pinned npm installation, a complete two-server local quickstart, comparison concepts/results/glossary and the full source fixture walkthrough. Added a focused smoke script that executes the actual quickstart's config and demo code in a clean temporary npm project.

Validation: documentation build passed (12 generated routes). The fresh npm 3.2.3 walkthrough passed doctor, comparison listing, a changed-page `review`, report generation and an unchanged-page `pass`. The test exposed a published artifact mismatch: npm package 3.2.3 prints CLI version 3.2.2. Installation/quickstart articles now explain verifying the installed version using package-manager metadata; no engine code was changed. Live AI, Google and cloud providers were not exercised. No formatting, lint or type checks ran.

## D03 — Testing workflows

Added focused guides for configuration, routing/discovery, browser/viewports, stability/noise, reports, local baselines/acceptance, Playwright checkpoints, application authentication/hooks, Gemini/Ollama, AI intent/budgets, repairs, independent checks, watch/monitoring and the public API/reporters. Complete examples and clearly labeled property fragments preserve existing behavior and its limits.

Validation: production docs build passed with 31 generated routes. Examples were checked against current schema, CLI registration and existing fixture capability documentation. The npm first-run smoke from D02 remains the live deterministic capture evidence; live AI services and arbitrary consumer application interactions are not certified by this prose migration. No formatting, lint or type checks ran.

## D04 — Dashboard and team setup

Added local SQLite, PostgreSQL/MongoDB alternatives, projects/identities, publishing/retry, per-project profiles, private runners/progress, login, Google linking and people/permissions guides. Environment loading, foreground processes and distinct upload/runner/admin credentials are explicit. Extended the consumer smoke to execute the dashboard guide's actual SQLite environment and verify project creation, bound capture and history after restart.

Validation: docs build passed with 43 routes. The clean npm 3.2.3 quickstart and local dashboard smoke passed, including restart persistence. Google and external PostgreSQL/MongoDB deployment instructions are source-reviewed, not live deployment certifications; the local Docker service is unavailable. No formatting, lint or type checks ran.

## D05 — Review, baselines and CI

Added reviewer/inbox, approved baseline promotion/pull, visual policy, GitHub Action, preview revision, sharding/merge and GitHub Check Runs guides. The guides distinguish original verdicts, local acceptance, exact-evidence human decisions and policy checks, including separate token scopes and stale PR-head behavior.

Validation: docs production build passed with 51 routes. The existing real dashboard runner smoke also passed: isolated configs, scoped queue/claim, Chromium capture, persisted measured progress, uploaded result and revocation. Action inputs/outputs and command examples were reviewed against current source. A live GitHub App/check/webhook/cloud deployment was not configured by this change. No formatting, lint or type checks ran.
