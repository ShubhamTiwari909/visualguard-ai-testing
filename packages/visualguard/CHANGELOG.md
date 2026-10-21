# visualguard

## 3.4.0

### Minor Changes

- 65a9ea0: Add the typed `runVisualGuard` SDK for scripts and CI. Support inline or discovered configuration, isolated environment resolution, section capture, explicit baseline updates, cancellation and progress, HTML/JUnit reports, optional GitHub summaries, and structured policy verdicts without changing the caller's process exit status. Include repository and Astro guides plus a runnable CI script and workflow example.

## 3.3.0

### Minor Changes

- 0a1cb01: Let the dashboard run **Run test** itself with just the signed-in user's authorization: no runner credential is needed on a local or container-hosted dashboard. A connected private runner still takes priority. Cloud Run scaffolds now install Chromium; serverless hosts such as Vercel keep requiring a private runner unless `VISUALGUARD_BUILT_IN_RUNNER=on` is set. Add `VISUALGUARD_BUILT_IN_RUNNER` and `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY`.

  Reserve built-in runner capacity before persisting requests so simultaneous projects respect the process concurrency limit. Release slots after failed saves and completed captures.

- 592c5cf: Add a project-specific visual test editor and Run test action backed by durable execution requests and a connected private runner. Include a foreground dashboard runner CLI, separately scoped expiring runner credentials, bounded capture, leases/heartbeats, progress and result links. Keep browser execution and AI credentials on the runner; preserve offline tests and upload-only tokens.
- b32a009: Show live stage and measured comparison progress for dashboard-triggered visual tests. Persist bounded runner reports through serialized lease heartbeats, retain partial progress on failure, and show distinct upload/finalization states with accessible progress indicators.
- 97e834a: Persist an independent, validated visual comparison configuration for each dashboard project, with project permissions and version-checked edits. Support separate production/staging URLs, routes, viewports and AI provider/model without storing executable config or credentials.
- d9bcf91: Capture individual sections using a CSS selector such as `[data-visualguard="checkout"]` in `screenshot.selector`, with route overrides and explicit page fallback. Keep section jobs and baselines distinct, scope DOM explanations to the image, reject invalid or ambiguous targets, and support the same scope in Playwright checks, recaptures, and verified fixes.

### Patch Changes

- Keep automatic repairs isolated to the selected section while still rejecting changes that damage another captured section. Reject transparent section targets, including targets inside transparent parents, instead of accepting blank screenshots.
- 613b4e2: Explain dashboard connection failures with the target origin and startup/network recovery steps, preserve the original cause for debug output, and document the complete AI-plus-dashboard startup sequence.
- cdfec35: Reduce MongoDB run deletion latency by batching artifact cleanup queue writes, bounding concurrent cleanup work and indexing artifact references/chunks. Preserve shared evidence, active upload checks, generation-safe deletion and durable retry tasks; await all cleanup workers before returning.
- 277e9b9: Move Delete project from People & integrations to the selected project's run-history section. Preserve maintainer/admin visibility, project ID confirmation, expected run-count checks and post-deletion navigation.
- 6578cb5: Include the `/policies` rewrite in generated Vercel deployments so direct navigation and refresh load the dashboard. Existing deployment folders still need regeneration or the documented manual rewrite.

### Documentation

- Add a complete section screenshot guide to the repository and Astro documentation website, covering data attributes, global and route selectors, Playwright checks, baseline separation, target requirements, and troubleshooting.
- Add implementation plans for AI-agent MCP integration and daily GitHub Actions runs with Cloud Run and Google Cloud Storage. These integrations are plans, not implemented features in this release.

## 3.2.0

### Upgrade from 3.1.0

- Take a native operational database backup and stop older dashboard writers before upgrading. Upgrade all dashboard instances consistently; keep the runner and server on compatible releases. A code rollback does not restore an older database schema.
- Existing installations with users but no recorded admission policy must explicitly choose `VISUALGUARD_USER_ADMISSION=invite` or `legacy` before startup. Fresh hosted workspaces default to invite-only admission. Use SQLite, PostgreSQL or a transaction-capable MongoDB replica set/sharded deployment for the full team workflow; standalone MongoDB needs explicit legacy mode and does not support invitations, account linking, managed lifecycle changes, baseline mutations or administrator recovery.
- Preserve existing account IDs and use explicit Google linking with current-account proof. Matching email addresses do not merge identities. Keep a tested password administrator; changing bootstrap environment credentials does not reset an existing account.
- Rebuild/redeploy the dashboard package and generated hosting assets as well as updating the test runner. Verify direct navigation to all supported pages. The published 3.2.0 Vercel scaffold omits `/policies`; add its `/index.html` rewrite before redeploying, or regenerate from a release containing the scaffold correction. Updating the package alone does not update an old deployment folder.
- GitHub checks need server-side supported credentials, repository mappings, a webhook secret/raw-body forwarding and external scheduled reconciliation. Credential rotation and scheduler monitoring remain operator responsibilities. Start in Informative mode; checks are point-in-time observations, not continuous release authorization.
- Native database backups include new screenshot/DOM chunks and operational state. Portable evidence exports exclude authentication state and cannot replace a full recovery backup. Test a restore in a separate environment before relying on the upgrade.

See the [npm setup guide](../../docs/NPM-PACKAGE-SETUP.md) for application/dashboard setup and the [local source guide](../../docs/LOCAL-SETUP.md) for operator recovery. These are upgrade instructions, not a claim that a real Google/cloud deployment has been validated.

### Minor Changes

- 8fc79e5: Add approved baseline sets with immutable versions, exact-evidence review requirements, concurrent promotion protection, restore history, and project-scoped downloads. Introduce `dashboard baseline pull` to pin verified references for offline CLI and Playwright comparisons, with selected-version provenance and local update protection.
- c70e0df: Add explicit Google account linking with current-account proof, canonical identity mappings, legacy user-ID continuity, transactional uniqueness/auditing, and session revocation. Support SQLite/PostgreSQL and transaction-capable MongoDB while preserving standalone MongoDB sign-in and existing CLI/review workflows.
- a9e3c2d: Add a documented Google sign-in pilot to the dashboard with a named login entry point, complete OIDC configuration validation, Google token-signature and verified-email checks, and safe browser retry after provider failures. Preserve existing project roles, generic company OIDC, issuer-bound identities, and local/offline access.
- Add a searchable workspace user directory, explicit role promotion/demotion, disable/restore, password reset, and session/upload-credential revocation with current administrator proof, version checks, transactional auditing, and last-administrator protection. Preserve project memberships and historical review attribution.
- 76540eb: Add single-use project invitations with verified account proof, atomic membership grants, and invite-only admission for new hosted workspaces. Existing installations must explicitly choose invite or legacy admission on upgrade. Transactional onboarding supports SQLite, PostgreSQL, and MongoDB replica sets; CLI/offline access remains available.
- 53a5d40: Add versioned visual regression policies and exact-revision GitHub Check Runs using current approved baselines, required screenshot coverage, capture reliability, evidence freshness, and visual review decisions. Include project-scoped assessment/reconciliation commands, signed pull-request webhooks, informative/required modes, expiring review exceptions, and retry/lease recovery. Operators must configure server-side GitHub credentials, token renewal and scheduled reconciliation; named journeys remain deferred.
- 9dd1c0e: Add administrative audit history with bounded filters and safe details, workspace readiness checks, and source-host recovery tooling for existing password administrators with atomic credential revocation and audit recording.

### Patch Changes

- 693ef06: Give Audit & recovery a dedicated administrator page with bounded Previous/Next pagination, direct deployment routes, and expandable event details. Refine dashboard spacing, form alignment, select-arrow padding, keyboard focus, and mobile workspace navigation.
- 4caa762: Add a dashboard Profile link and a personal profile section showing the signed-in account's name, email, and workspace role, with an explicit local-access state.
- 1d4bbec: Serve direct `/reviews` navigation in the development dashboard and generated Vercel deployments. Strengthen packaged route checks to reject redirects and verify the generated Vercel rewrite.
- 53a5d40: Replace phase-by-phase walkthroughs with three maintained guides for local source setup, npm package setup, and product features. Document separate visual-only, AI, SQLite dashboard, PostgreSQL and MongoDB workflows for source and npx users, plus Vercel/Cloud Run deployment, image storage, review/baseline policies and operational recovery. Update package homepage and documentation links.

## 3.1.0

### Minor Changes

- 2cb400f: Add `visualguard dashboard project create <id>` (alias `add`) and `createDashboardProject` for idempotent local/server project setup. Preserve existing projects, report whether creation occurred, support administrator sessions for login-enabled servers, and retain project-scoped upload restrictions. Include a manual walkthrough.
- 824f130: Add a dashboard review inbox with job-level visual decisions, discussion/replies, reviewer assignment, deadlines, and exact-evidence concurrency checks. Store review history separately from immutable engine results across SQLite, PostgreSQL, and MongoDB, enforce project reviewer permissions, and remove threads when their run or project is deleted.
- c05d71d: Accept custom dashboard run names through `test --run-name`, saved-run import/publishing, and upload metadata. Show and search these names in the dashboard while retaining the original run number and immutable engine evidence.
- 2cb400f: Add confirmed project and run deletion to the standalone dashboard, with maintainer/admin permissions, project access and upload cleanup, preserved shared artifacts, and deletion audit events. Deleted project IDs remain reserved to prevent credential reuse. Includes SQLite, PostgreSQL, MongoDB support and a manual walkthrough.
- c05d71d: Allow project maintainers and administrators to edit project display names and public IDs with conflict checks. Retain immutable internal keys and historical ID aliases so existing runs, access, uploads, and links remain connected. Support aliases in CLI binding and publishing, reserve deleted identities, and preserve edited labels in portable backups.
- c05d71d: Allow project maintainers and administrators to rename dashboard runs or restore their default labels. Reject concurrent stale edits, update name search, and preserve edited labels in portable evidence backups without changing engine evidence or evidence digests.
- 2cb400f: Add the standalone dashboard command and `visualguard/dashboard` runtime: local SQLite files, PostgreSQL/MongoDB storage, password/OIDC team access, project permissions, resumable CI uploads, portable evidence export/restore, and Cloud Run/Vercel deployment scaffolds with prebuilt UI assets.
- 2cb400f: Support `visualguard test [project]` to import captured evidence into a local dashboard or publish it to a configured hosted dashboard. Resolve IDs and exact permitted names, preserve engine verdicts and JSON output, and expose a project-scoped lookup for upload credentials. Includes metadata options and a manual setup/recovery guide.

### Patch Changes

- Fix standalone dashboard refreshes on `/reviews`, include the platform in workspace type checking, and complete release formatting and fixture type cleanup.
- 2cb400f: Reuse the CLI and report outputs during the normal package build instead of rebuilding them in the dashboard step. Preserve the standalone JavaScript-only dashboard build and clarify dashboard setup, authentication, deletion responses, and validation coverage in the guides.
- c05d71d: Restore compatible backup aliases into existing projects without naming profiles, trim run names before checking their length, reject malformed remote public IDs, and document the run-name CLI flag and reserved project ID semantics.
- 2cb400f: Derive opaque session and OIDC correlation cookie handles with SHA-256 before browser storage, and retain only their separate lookup hashes server-side. Address PR #9's two CodeQL cleartext-cookie alerts without adding configuration or changing authentication/PKCE checks. Include regression coverage for hashed lookup keys and one-time callbacks.

## 2.0.0

### Major Changes

- feat: add CONTRIBUTING.md, update PLAN.md, and enhance README.md; release 1.1.0
- fd3c5fc: Strengthen visual acceptance, fix verification, baseline provenance, AI request caching/budgets, Playwright fixture integration and shard completeness.

  Migration: missing baselines now fail by default; explicitly update snapshots or opt into `baseline.missing: "create"`. Legacy CLI baselines require regeneration or an explicit `baseline.legacy: "allow"`; fixture baseline IDs include project/rendering identity. Automatic fixing requires `fix.verify.server`. Shards outside GitHub Actions require a shared execution group, and legacy/incomplete/incompatible shard inputs are rejected. See the reliability migration guide for details.

### Patch Changes

- 6e918a5: Link the npm page to the GitHub repository and getting started guide; add badges and a demo GIF to the README.

## 1.1.0

### Minor Changes

- Fewer false positives, cheaper AI, monitoring and extra checks:

  - Noise map: pages that differ are loaded twice and areas that change on every load are ignored.
  - `data-visualguard-ignore` masks (or hides) elements marked in your markup.
  - Accepted changes match re-renders of the same change (`output.acceptMatch: "similar"`).
  - `test --shard i/n` and `visualguard merge` split large sites across CI machines.
  - `visualguard monitor` compares production with its previous capture; `--workflow` writes a nightly workflow.
  - `checks.accessibility` and `checks.performance` (`--a11y`, `--perf`) report new axe violations and slower or heavier pages.
  - Gemini: low thinking and medium image detail by default, thinking tokens counted, daily quota errors fail fast, and pages already marked as regressions skip the model (`ai.analyze`).

## 1.0.0

### Major Changes

- First release

## 0.7.0

### Minor Changes

- Add `visualguard/playwright`: a `visualguard` fixture for Playwright Test (`await visualguard.check(page)`) that compares the page with production or a baseline, explains differences, attaches screenshots and fails the test per `failOn`. Add `visualguard auth <env>` to save a logged-in session as storageState, `reporters` in the config for custom reporters, and a composite GitHub Action in `action/`.

## 0.6.0

### Minor Changes

- Add `visualguard fix --auto` (fixes on a new branch in a separate git worktree with its own dev server, commits verified fixes; `--pr` pushes and opens a pull request via `gh` or the REST API; `--in-place` for CI), `visualguard watch` (re-tests the routes affected by each saved file against the local dev server), baseline mode (`mode: "baseline"`, `test --update-baselines`, committed screenshots in `visualguard/baselines`), and a "Generate fix" button in the served report that shows the diff and applies and verifies it on confirmation.

## 0.5.0

### Minor Changes

- Add `visualguard fix`: ranks the likely source files, proposes an edit (restoring production's utility classes or CSS values without AI, or search/replace edits from the AI provider after asking for consent), shows the diff and asks before applying, then runs `fix.verify.commands`, re-captures the page on the local dev server and keeps the change only if it matches production; otherwise it reverts and retries. Needs `fix.enabled: true` and a clean git tree. Also: lab/oklch colours are shown as hex, layout-shift detection ignores content moving inside fixed-height boxes, and an `examples/nextjs` app demonstrates the loop.

## 0.4.0

### Minor Changes

- CI and GitHub integration: `visualguard accept` records intentional changes in `visualguard.accepted.json` (matching screenshots then pass as "accepted"), with an "Accept change" button in the served report; `visualguard comment` posts or updates one sticky PR comment (finds the PR from the commit for `deployment_status` events); a Markdown job summary is written to `$GITHUB_STEP_SUMMARY`; `--junit <path>` writes JUnit XML; `report.webhook` posts a JSON summary; `init --workflow` writes a GitHub Actions workflow for the project's package manager.

## 0.3.0

### Minor Changes

- Add AI analysis. Gemini (`@google/genai`, structured output) and Ollama (local, JSON-schema `format`) providers classify each changed page as regression, intentional, content or noise, explain it and suggest a fix. The AI can raise or lower a heuristic "review" but never downgrades a hard failure; answers are cached, `ai.maxCallsPerRun` caps calls, and AI errors fall back to heuristics. New `visualguard analyze` re-runs AI on an existing run; `test` gains `--provider`, `--model` and `--no-ai`; `doctor` checks the model. New heuristics flag low text contrast and cut-off text. Adds an eval runner (`pnpm eval`) over 41 labelled fixture cases.

## 0.2.0

### Minor Changes

- Explain differences without AI: every capture now records a compact DOM snapshot; changed regions are mapped to the elements under them and to style, text, position and added/removed-element changes, described in plain language ("Alignment changed: align-items center → flex-start on div.actions"). Layout shifts are detected and reported as one root cause, removed controls and new overlaps are regressions, and tiny changes with no DOM change are treated as rendering noise. Captures are steadier: scrollbars are hidden through CDP and a few re-rasterised pixels no longer count as a moving page.
- 18bcadb: Add the HTML report: every run writes a self-contained `index.html` (works from `file://`, CI artifacts and any static host) with a job list, side-by-side / slider / onion-skin / diff views, region overlays and crops, findings, page health, keyboard shortcuts and a dark theme. `visualguard report` serves the latest run (or `--run <id>`) on localhost with a token-protected action API; `--no-serve` prints the file path.

## 0.1.0

### Minor Changes

- 3bd87f8: Add the capture and diff pipeline: `visualguard test` captures production and staging with Playwright, stabilises pages (animations, fonts, lazy content, network, clock), diffs them with pixelmatch, groups changes into regions, and writes a versioned `manifest.json`. Includes the URL resolver (`--production`, `--staging`, `--route`, `--only`, `--viewport`, `--list`), terminal and JSON reporters, and exit codes.
- Add `visualguard init` (interactive or `--yes`), `visualguard doctor`, zero-config runs (`visualguard <url>` scans one site and saves snapshots; `visualguard <url> <url>` compares two), route discovery from Next.js `app/` and `pages/`, `sitemap.xml` and crawling, and health findings (HTTP errors, broken images, horizontal overflow) that raise a job's status.
