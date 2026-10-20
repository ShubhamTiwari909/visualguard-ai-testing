# VisualGuard documentation website plan

Prepared: 20 October 2026  
Status: planning only; the website, dependencies, guides and deployment described below are not yet implemented.  
Requested stack: Astro, React, Tailwind CSS and Astro Starlight.  
Proposed workspace: `apps/docs`, package name `@visualguard/docs`.

## Contents

1. [Outcome and scope](#1-outcome-and-scope)
2. [Repository findings and implications](#2-repository-findings-and-implications)
3. [Readers and entry paths](#3-readers-and-entry-paths)
4. [Architecture and technical decisions](#4-architecture-and-technical-decisions)
5. [Information architecture and page backlog](#5-information-architecture-and-page-backlog)
6. [Guide writing contract](#6-guide-writing-contract-no-missing-setup-steps)
7. [Required end-to-end walkthroughs](#7-required-end-to-end-walkthroughs)
8. [Documentation website setup guide for contributors](#8-documentation-website-setup-guide-for-contributors)
9. [Content metadata, components and writing standards](#9-content-metadata-components-and-writing-standards)
10. [Migration and release accuracy](#10-migration-and-release-accuracy)
11. [Design and usability](#11-design-and-usability)
12. [Validation strategy and acceptance matrix](#12-validation-strategy-and-acceptance-matrix)
13. [Hosting, CI and release process](#13-hosting-ci-and-release-process)
14. [Implementation sequence and commit boundaries](#14-implementation-sequence-and-commit-boundaries)
15. [Risks, decisions and launch checklist](#15-risks-decisions-and-launch-checklist)
16. [Reference material](#16-reference-material)

## 1. Outcome and scope

Build a public documentation website that takes a new user from choosing a setup to inspecting a real visual comparison, then supports the full workflow through CI, team review, private runners and dashboard operations. A reader should be able to complete a guide without guessing a missing command, environment variable, terminal, permission or verification step.

The website becomes the primary user documentation. Keep a concise repository README and npm README for discovery, installation and links. Keep historical plans and validation records in the repository with their dates and scope intact.

This request delivers this planning document in a separate preceding commit. Implement the site in subsequent, explicitly requested steps. This work does not advance unrelated organization-growth features or change CLI/dashboard behavior. Formatting, lint and type checks remain deferred under `AGENTS.md` until after F36 unless the user changes that instruction. Documentation builds and focused behavior checks are permitted when needed during implementation.

### Launch requirements

- Use Starlight for navigation, article layout, code presentation and documentation conventions.
- Use Astro for static page generation, React for useful interactive examples, and Tailwind for site/component styling.
- Publish complete paths for package users, source contributors, reviewers and dashboard operators.
- Keep the first successful comparison independent of AI, accounts, a dashboard and an external database.
- Distinguish published package behavior, merged source behavior and future plans everywhere they differ.
- Migrate existing information with a traceable source-to-page map, including troubleshooting and migration notes.
- Support small screens, keyboard navigation, light/dark themes, search and direct links to article sections.
- Document both how to use VisualGuard and how to maintain this documentation website.

### Deferred scope

No new testing-engine features, managed capture service, billing, documentation login, support chatbot, CMS, translations or full historical version archive at launch. Do not turn roadmap proposals such as named journeys into instructions for available functionality. Add these only through separately requested work.

## 2. Repository findings and implications

The inventory below reflects inspected files in the current checkout. It does not establish which package version is currently published.

| Finding | Planning consequence |
| --- | --- |
| The root already uses pnpm workspaces with `apps/*`, `packages/*` and `examples/*`. | Add `apps/docs` without restructuring the CLI or platform. Use the existing root lockfile. |
| The root pins `pnpm@9.0.0`; VisualGuard declares Node `>=22.12.0`. | Keep pnpm consistent; give the docs workspace its own compatible Node requirement. |
| Current Astro installation documentation requires Node `22.22.0+` and excludes odd-numbered releases. | Use a supported even-numbered Node release satisfying this minimum for docs development and CI. Recheck selected dependency engines before installing. Do not silently raise VisualGuard consumer requirements. |
| `README.md`, `packages/visualguard/README.md` and the two setup guides overlap substantially. | Assign each topic one canonical website page; retain small entry points in the READMEs. |
| `docs/NPM-PACKAGE-SETUP.md` and `docs/PRODUCT-FEATURES.md` contain dated `3.2.0` statements; the working package manifest reads `3.2.3`. | Verify registry, release tag and built artifact before assigning release labels. An edited manifest is not publication evidence. |
| Source setup, package setup and dashboard commands load environment settings differently. | Give each guide an explicit working directory, file-loading rule and command form. |
| The CLI/report works offline; a local dashboard uses SQLite; shared hosting uses persistent external storage. | Separate these paths at the entry page and in prerequisites. |
| On-demand dashboard execution uses a foreground private runner and a different credential from an upload token. | Write a dedicated runner guide, including connectivity, progress, failure and revocation. |
| The latest merged work includes project configuration and dashboard test progress. | Audit these against releases; avoid migrating older statements that the dashboard only displays evidence without explaining its request/runner workflow. |
| Existing GitHub CI includes formatting, lint and type-check jobs. | The current instruction still prohibits running those commands in this sequence. Add focused docs jobs without invoking or claiming those deferred checks. |
| Unrelated package edits and untracked assets already exist in the workspace. | Keep the planning commit and subsequent docs changes scoped; do not include unrelated files. |

Technical sources: [Astro installation requirements](https://docs.astro.build/en/install-and-setup/) and [Starlight setup](https://starlight.astro.build/getting-started/). These upstream instructions were checked on the preparation date; dependency compatibility must be checked again at implementation.

## 3. Readers and entry paths

| Reader | Starting page | Successful outcome |
| --- | --- | --- |
| First-time user | `start/quickstart/` | Installs the package, captures a comparison and understands its report. |
| Developer adding VisualGuard to an existing app | `start/install/` | Adds a repeatable config and commands in that application's repository. |
| Existing Playwright user | `guides/playwright/` | Adds a checkpoint with an equivalent reference state and finds attached evidence. |
| Repository contributor | `contributing/local-setup/` | Runs the local fixture comparison from built source. |
| Team adopter | `dashboard/local/`, then `dashboard/publishing/` | Creates a project and sees a submitted run in persistent history. |
| Designer/reviewer | `dashboard/reviews/` | Finds assigned evidence, records a decision and understands what that decision changes. |
| CI maintainer | `ci/github-actions/` | Runs against reachable environments and preserves evidence on failures. |
| Workspace administrator/operator | `deployment/overview/` | Chooses storage, deploys a login-enabled dashboard and verifies recovery/backup. |

The home page has three primary actions: **Run your first visual test**, **Set up a shared dashboard**, and **Develop from source**. It explains reference/candidate, report/dashboard, local baseline/approved baseline, and browser runner/dashboard server before presenting advanced choices.

Use npm in consumer walkthroughs as the default, with complete pnpm equivalents where useful. Use pnpm 9 in repository and docs-contributor walkthroughs. Package-manager tabs change commands only; they must not hide required conceptual steps or mix lockfiles.

## 4. Architecture and technical decisions

### 4.1 Application boundary

The docs application is a private workspace that emits static files to `apps/docs/dist`. It has no runtime dependency on the dashboard, a database, Playwright browsers, AI credentials or the CLI build for ordinary prose edits. Importing the engine or platform into the browser bundle is prohibited by design.

Where examples need contract validation, run that validation as a separate focused Node task against source exports or a built package fixture. Do not make every documentation page execute browser capture at build time.

Proposed structure:

```text
apps/docs/
  package.json
  astro.config.mjs
  tsconfig.json
  README.md
  src/
    content.config.ts
    content/docs/
      index.mdx
      start/
      concepts/
      guides/
      dashboard/
      ci/
      deployment/
      reference/
      troubleshooting/
      releases/
      contributing/
    components/
      SetupChooser.tsx
      ReleaseNotice.astro
      Verification.astro
    data/
      releases.json
      coverage.json
    examples/
    styles/global.css
    assets/
  public/
    favicon.svg
    robots.txt
scripts/docs/
  check-content.mjs
  check-links.mjs
  check-examples.mjs
.github/workflows/
  docs-check.yml
  docs-deploy.yml
```

The scripts and names above are proposals, not existing commands. Use Markdown by default; use MDX when a page needs components. Store optimized imported images in `src/assets`; reserve `public` for files that need stable public paths. No generated output, nested Git repository, nested lockfile or production secrets belong in `apps/docs`.

### 4.2 Dependency and runtime policy

Use compatible stable versions of `astro`, `@astrojs/starlight`, `@astrojs/react`, `react`, `react-dom`, `tailwindcss`, `@tailwindcss/vite` and `@astrojs/starlight-tailwind`. Include React types and MDX integration if required by the selected template. Record the resolved versions in the workspace lockfile and the initial implementation notes; do not leave an untested combination described as supported.

Before scaffolding, inspect package engine and peer requirements. The docs runtime must meet the highest requirement among the selected packages. Keep the published VisualGuard engine untouched unless separately requested. Use a docs-specific engine declaration and CI Node selection; explain the higher requirement to repository contributors who want to work on the website. If adding docs dependencies makes root installation incompatible with the old minimum, document that contributor boundary explicitly and offer a filtered engine/platform installation path verified with pnpm 9.

Do not install legacy `@astrojs/tailwind` or copy a Tailwind v3 JavaScript configuration into the new site. The current integration uses the Tailwind Vite plugin. Starlight needs its compatibility styles and explicit cascade ordering rather than an unrestricted CSS reset. Follow the selected versions' [Starlight CSS and Tailwind guide](https://starlight.astro.build/guides/css-and-tailwind/).

### 4.3 Starlight and React responsibilities

Keep Starlight's native article shell, sidebar, table of contents and code features. Configure labels and ordering explicitly so a generated alphabetical list does not become the learning path.

React powers a small setup chooser that asks whether the reader wants a local comparison, a shared dashboard or source development, and links to the right guide. Its initial HTML must contain useful links before hydration. Essential documentation stays readable without JavaScript. Prefer `client:idle` or `client:visible` for optional interactions; use immediate hydration only where the first interaction requires it. Install the integration according to the [official React instructions](https://docs.astro.build/en/guides/integrations-guide/react/).

Keep component controls accessible and bounded. A future configuration builder may emit example text, but must never ask users to paste credentials or claim to validate a running application. The setup chooser is sufficient React usage for launch.

### 4.4 Search, URLs and metadata

Use Starlight's built-in Pagefind search. Verify it against the production build and preview, where the generated index exists, instead of treating the development server as the acceptance environment. See [Starlight search](https://starlight.astro.build/guides/site-search/).

Use descriptive lowercase slugs, stable heading anchors and a consistent trailing-slash policy. All internal URLs, images, downloads and search requests must respect Astro's configured base path. Keep the site's canonical origin and base in one configuration boundary; do not scatter a domain through articles.

Every public article requires a title and description. Add a sitemap, canonical metadata, a useful 404 page and social metadata. Use source edit links and meaningful last-reviewed information. Preview builds must not be indexed; generate their robots/noindex policy from deployment context. For a project-path deployment, robots.txt belongs to the origin root to control crawling; do not assume a nested robots.txt supplies that policy. Keep production sitemap URLs on the canonical production origin.

## 5. Information architecture and page backlog

All routes below are relative to the documentation base path. Rows that list multiple routes represent separate focused pages. Launch covers implemented and released behavior; a source-only feature may be documented with a visible source requirement and a link to source setup.

### 5.1 Start and concepts

| Route | Required coverage |
| --- | --- |
| `/` | Short product explanation, three entry paths, optional AI/dashboard explanation, release context and example report. |
| `start/choose-setup/` | Decision table: offline, SQLite, PostgreSQL, MongoDB, shared hosting and source development. State which services and credentials each choice requires. |
| `start/requirements/` | Consumer Node minimum, browser binaries/system libraries, supported OS/shells, network access, optional components and docs-contributor Node minimum. |
| `start/install/` | Existing project directory, exact package installation, Playwright detection/install, version check, ignore rules, init and generated files. |
| `start/quickstart/` | Complete first comparison without AI; running target servers, full config, doctor, capture, report, expected result and next step. |
| `concepts/how-it-works/` | Capture → compare → inspect → decide; runner, dashboard and data boundaries. |
| `concepts/comparison-modes/` | Two environments, one-URL scan, explicit local baselines and Playwright checkpoint; first-run/update differences. |
| `concepts/results/` | Pass/review/regression/error/accepted behavior as implemented; incomplete evidence, independent findings and failure policy. |
| `concepts/glossary/` | Run, job/comparison, route, viewport, reference, candidate, baseline, project ID, revision and execution request. |

### 5.2 Task guides

| Route | Required coverage |
| --- | --- |
| `guides/configuration/` | Complete minimal config, supported file discovery, explicit JSON path, precedence and portable environment overrides. |
| `guides/routes/` | Explicit routes, path mapping, dynamic params, Next.js/sitemap/crawl discovery, include/exclude and discovery limits. |
| `guides/browsers-and-viewports/` | Browser installation/selection, viewport names, mobile/touch, locale, timezone and consistent environments. |
| `guides/stable-captures/` | Fonts, network quiet, animation/media, lazy content, time freezing, hides/masks and dynamic-data tradeoffs. |
| `guides/diff-and-noise/` | Pixel/ratio thresholds, regions, shifts, repeated reference noise detection, anti-aliasing and reducing false alarms. |
| `guides/reports/` | Locate/open evidence; comparison views, findings, filtering, traces, artifacts and server lifetime. |
| `guides/local-baselines/` | Explicit initial creation, compatible rendering conditions, test/update, missing baseline and review-before-update. |
| `guides/accepting-changes/` | Local acceptance, scope/notes/persistence, rerun behavior and distinction from team approval or promotion. |
| `guides/playwright/` | Fixture import, Playwright config, minimal complete test, replaying reference state, checkpoints, evidence attachments and limits. |
| `guides/application-auth/` | Storage-state capture for tested pages, expiration, environment-specific sessions, capture hooks and ignored session files. |
| `guides/ai-gemini/` | Optional credentials/model, correct environment loading, first run, provider failures and deterministic fallback. |
| `guides/ai-ollama/` | Service/model prerequisites, host reachability, model selection and offline/network boundaries. |
| `guides/ai-policy-and-budgets/` | Expected-change intent, advisory decisions, cache, reanalysis, request/token/deadline budgets and evidence sent to each provider. |
| `guides/fixes/` | Propose, inspect, preview/apply, scoped edits, verification, collateral checks, failure/rollback and no promise of automatic correctness. |
| `guides/accessibility-and-performance/` | Enable independently, inspect separate evidence, thresholds and limitations. |
| `guides/watch/`, `guides/monitoring/` | Watch lifecycle and baseline behavior; monitoring persistence, reset behavior and scheduler responsibility. |
| `guides/programmatic-api/`, `guides/reporters/` | Complete API example, cancellation, exports, custom reporters, JSON/JUnit/webhooks and evidence contract. |

### 5.3 Dashboard and teams

| Route | Required coverage |
| --- | --- |
| `dashboard/overview/` | Local report versus persisted dashboard, workspace/project model, supported release and execution boundaries. |
| `dashboard/local/` | SQLite from an explicit clean environment, start/stop, data path, create project, bind capture and verify history after restart. |
| `dashboard/projects/` | Immutable IDs versus display names, selection, access, rename/deletion, multi-project isolation and missing-run diagnosis. |
| `dashboard/publishing/` | Local import versus HTTP publish, project creation, upload credentials, CI environment, saved-run retry and upload limits. |
| `dashboard/project-configuration/` | Per-project saved profile, allowed fields/limits, version conflicts, secrets exclusion and difference from local executable config. |
| `dashboard/private-runners/` | Runner credential, browser/network setup, foreground process, connected state, UI trigger, result, lease/disconnect and revocation. |
| `dashboard/execution-progress/` | Queued/starting/capture/upload/finalizing/terminal states, measured comparison counts, indeterminate stages and older-runner compatibility. |
| `dashboard/login/` | Local-owner versus login mode, exact public origin, initial admin, sessions and bootstrap limitations. |
| `dashboard/google-sign-in/` | OAuth project/audience/client, exact callback, issuer/client settings, linking, admission and recovery access. |
| `dashboard/people-and-permissions/` | Workspace/project authority, password accounts, invitations, expiry, disabled users, token scopes and who can perform each action. |
| `dashboard/reviews/` | Inbox, assignment, exact evidence/revision, region decisions, dismissal/rejection/reapproval and permissions as implemented. |
| `dashboard/approved-baselines/` | Approval prerequisites, immutable versions/lineage, promotion, pull/pin, compatibility and stale/missing references. |
| `dashboard/visual-policies/` | Configure/evaluate/enforce policy; exact revision, pending/stale evidence, GitHub reconciliation and failure diagnosis. |

### 5.4 CI, deployment and operations

| Route | Required coverage |
| --- | --- |
| `ci/overview/` | Install locked dependencies/browsers, start or await environments, test, preserve evidence, optional publish and status interpretation. |
| `ci/github-actions/` | Complete workflow, Action inputs/outputs, working directory, permissions, optional AI, artifacts on failure and fork-secret limitations. |
| `ci/preview-deployments/` | Deployment readiness, trusted preview URL, actual captured commit SHA, credentials and PR association. |
| `ci/sharding/` | Common run identity, shard selection, collision-free artifacts, complete merge and missing/mismatched shard failure. |
| `ci/github-checks/` | Distinguish local exit status, Action comments and policy checks; server token/webhook/repository mapping and live PR head reconciliation. |
| `deployment/overview/` | Local versus shared hosting, runner placement, topology, canonical HTTPS origin, persistent storage and provider choice. |
| `deployment/postgresql/` | Dedicated database/user, real URI/TLS, environment loading, startup/schema handling, connection capacity and persistence checks. |
| `deployment/mongodb/` | URI/database, replica-set or sharded transaction support for team features, network/TLS and standalone limitations. |
| `deployment/vercel/` | Generated dashboard project, exact release, environment scope, API/static rewrites, deep links, external DB and payload constraints. |
| `deployment/cloud-run/` | Generated container, registry/build, service account, secrets, port/origin, database networking, deploy and smoke verification. |
| `deployment/cloud-sql/` | Cloud SQL-specific connection/network/service permissions and actual supported URI setup; link from Cloud Run. |
| `deployment/storage-and-backups/` | SQLite/files or DB-backed artifacts as implemented, retention, portable evidence export versus native operational backup, restore drill. |
| `deployment/upgrades/` | Client/server version compatibility, backup, release notes, schema behavior, regenerated hosting files, verification and rollback constraints. |
| `deployment/operations-and-recovery/` | Health/readiness, audit, host-side operations, admin recovery, access revocation and POSIX-only recovery boundaries. |

Deployment provider instructions must be checked against their official documentation during authoring. Existing repository guides are migration sources, not evidence that a current provider deployment has been tested.

### 5.5 Reference, help, releases and contributors

| Route | Required coverage |
| --- | --- |
| `reference/cli/` | Command index linking to command-family pages; argument order, defaults, interactive/CI behavior and version availability. |
| `reference/cli/testing/`, `reference/cli/baselines/` | init, doctor, zero-config, test, report, analyze, watch, monitor, accept, fix, auth, merge, comment and local baseline commands. |
| `reference/cli/dashboard/` | dashboard start/project/import/publish/runner/baseline/policy/operations/scaffold commands actually supported by the release. |
| `reference/configuration/` | Every schema group, field type/default/constraint, related CLI overrides, complete examples and supported formats. |
| `reference/environment/` | Variable scope, purpose/default, sensitivity, loading behavior, precedence and minimum feature version. |
| `reference/exit-codes/` | `0` success under policy, `1` failed/incomplete evidence, `2` usage/config, `3` environment; status versus exit distinctions. |
| `reference/artifacts/`, `reference/api/` | Output layout/manifest compatibility and public exports, including `visualguard/playwright` and `visualguard/dashboard`. |
| `reference/compatibility/` | OS/Node/browser support, source/package matrix, driver requirements, tested versus expected environments and fixture restrictions. |
| `troubleshooting/index/` | Symptom-based decision tree linking to focused fixes. |
| `troubleshooting/installation/`, `troubleshooting/capture/` | Node/browser/system-library errors, invalid config, unreachable app, blank screenshots and unstable differences. |
| `troubleshooting/dashboard/`, `troubleshooting/ci/` | Wrong data directory/DB/project, auth/origin, uploads, missing drivers, runner disconnect, stale policy SHA and CI-only failures. |
| `releases/index/`, `releases/migration/` | Verified release matrix, links to package changelog, upgrade notes and clearly labeled current-source differences. |
| `contributing/local-setup/` | Clone/pnpm/browser/build steps, fixture servers, JSON config, offline test, report and optional dashboard from source. |
| `contributing/architecture/`, `contributing/reading-the-code/` | Entrypoints, capture/report/platform flow, public API boundaries and beginner source-reading guide. |
| `contributing/testing/`, `contributing/releases/` | Focused behavior tests/evals, fixture creation, package validation and maintainer release workflow; state deferred-check policy. |
| `contributing/documentation/` | Docs installation, preview/build, article template, component conventions, review checklist and migration tracking. |

This backlog is deliberately comprehensive. Closely related material may share a page if it remains easy to navigate, but every listed topic needs an explicit destination and acceptance evidence.

Document public APIs from actual package exports. Internal dashboard endpoints may explain architecture, but must not be presented as a supported third-party API unless their compatibility contract is explicitly established.

## 6. Guide writing contract: no missing setup steps

Every setup guide follows the same sequence. Required steps stay in the main flow; use tabs for genuine alternatives and collapsible sections only for optional detail.

1. **Outcome:** describe exactly what the reader will have working.
2. **Applies to:** state package/source channel, tested version and any minimum feature version.
3. **Prerequisites:** list OS/shell, Node, package manager, accounts, permissions, services, URLs and disk/network needs relevant to this path.
4. **Before starting:** state the working directory, existing services, whether data already exists and which optional paths can be skipped.
5. **Files:** give exact paths, full contents and whether each file is created, edited, generated or ignored.
6. **Commands:** show them in execution order, with the working directory and shell. Separate terminal A/B/C and long-running processes.
7. **Replacement values:** explain each placeholder and where the user obtains it. Put placeholders before use and never present them as real credentials.
8. **Environment loading:** say whether to source a file, pass `--env-file`, configure deployment secrets or rely on a documented loader. State that existing process values take precedence where implemented.
9. **Start/stop:** show each process, actual URL/port, expected readiness and how to stop it. Explain that `localhost` belongs to the machine running that process.
10. **Verification:** give a concrete observable result after each major stage and a final smoke test.
11. **Failures:** cover likely symptoms at the relevant step and link to deeper troubleshooting.
12. **Next steps/cleanup:** point to the next task, say which processes to keep running and explain any destructive cleanup separately.

Never use an ellipsis inside a supposedly complete configuration or workflow. Label partial snippets and show the enclosing file/location. Avoid chaining later steps after a test command expected to return nonzero; explicitly tell users to continue to the report and interpret the evidence. No unexplained `|| true` or silent failure suppression.

Use a small running example (`storefront`, one desktop viewport, one route, AI none) before expanding coverage. Clearly identify production/reference URL, staging/candidate URL and dashboard origin: these are three different roles. Label sample URLs as examples and explain how to run reachable applications; `example.com` is not a provisioned regression fixture.

Add a final checklist to each setup guide. A guide is incomplete until someone follows it from its stated starting state without undocumented assistance.

## 7. Required end-to-end walkthroughs

The lists below specify the minimum sequence and final proof for the actual articles. They are content requirements; the final guides must include the exact commands/configurations validated during implementation.

### A. First comparison in an existing application

1. Open the application's repository and check Node and package-manager versions.
2. Explain how to obtain two reachable application versions; keep their servers running. Offer the source fixture walkthrough when the reader has no app.
3. Install a pinned VisualGuard release and a compatible Playwright dependency; retain compatible existing Playwright setup.
4. Install Chromium and any Linux browser libraries. Verify the installed VisualGuard version.
5. Add `.visualguard/` and the selected secret/session files to `.gitignore`.
6. Run init with the actual application URLs, one route and AI none. Explain every prompt, the generated config and the optional GitHub workflow.
7. Show the complete generated/minimal config and explain reference/candidate, route and viewport fields.
8. Run doctor, resolve prerequisites, and optionally list resolved comparisons before capture.
9. Run the first test and interpret expected nonzero results; open the report in a separate command.
10. Locate screenshots/findings and identify a deliberate difference or an unchanged result. Explain the output path and report-server lifetime.
11. Run again after a known change and inspect the new evidence.
12. Link to CI, local baselines, authentication or the dashboard according to the reader's goal.

**Proof:** a fresh consumer project produces inspectable evidence without a database, account or AI secret. Check npm and pnpm command variants, including Windows shell instructions where supplied.

### B. Reproducible source demo

1. Install Git, the documented Node release and pnpm 9; provide a supported pnpm installation fallback if Corepack is unavailable.
2. Clone the repository, select the documented revision and install from the root frozen lockfile.
3. Install Chromium/system dependencies and build the source CLI/report/dashboard assets required by the guide.
4. Start `scripts/serve-fixtures.mjs` in terminal A. Verify ports 4100 and 4101 and the `/color-change` route.
5. Create the full `output/local-demo.json` in terminal C; explain why an explicit JSON path is used instead of init.
6. Run the built source CLI with that config, then open its report. Explain expected visual differences and exit policy.
7. Add an unchanged route to show both changed and unchanged evidence.
8. Optionally add the source dashboard in terminal B on port 4400, explicitly load its environment and publish the run to the selected project.
9. Stop processes and explain which outputs persist.

**Proof:** the walkthrough works from a clean clone using the documented revision. No npm/source command mixing, hidden build step or port ambiguity.

### C. Local dashboard with SQLite

1. Explain that standalone tests have no DB, while this dashboard creates an embedded SQLite file.
2. Create an ignored dashboard environment file selecting local mode and clearing conflicting DB/public-origin settings. Explain inherited shell variables and unrelated `DATABASE_URL` values.
3. Start the installed dashboard with explicit environment loading and identify its actual data directory/port.
4. Open the loopback URL; explain local-owner authority and why public binding requires login.
5. Create a project against that server, record its stable ID and distinguish its display name.
6. Run a comparison bound to that project/dashboard and confirm its run appears in the right history.
7. Import an already saved offline run as a separate example; ensure import selects the same storage.
8. Restart with the same data settings and confirm history remains.

**Proof:** project/run data survives restart, and a custom port/data-directory example does not create an accidental second workspace.

### D. PostgreSQL or MongoDB dashboard

1. Pick one backend; list its service/account prerequisites and local or managed setup path.
2. Create a dedicated database and least-necessary application identity. Explain a real URI, TLS/network access and password URL encoding.
3. For MongoDB, configure a transaction-capable replica set/sharded deployment before team features; explain standalone limitations explicitly.
4. Set the actual connection URL in an ignored file or host secrets and load it into the correct dashboard process.
5. Start and verify dashboard readiness, schema setup and selected storage without printing secrets.
6. Create a project, publish a run and check history after restart.
7. Explain artifact persistence, native backups and changing databases: selecting a new DB does not migrate the old one.

**Proof:** repeat independently for PostgreSQL and transactional MongoDB. A static docs build does not count as database setup validation.

### E. Login, Google linking and invitations

1. Use a disposable workspace for a trial or take a backup before changing a real installation.
2. Set login mode, exact canonical origin, explicit admission mode and initial administrator credentials; restart and sign in.
3. Explain one-time admin bootstrap and the difference between changing environment values and resetting a persisted password.
4. Create a Google Web OAuth client, configure audience/test users and register the exact `/api/auth/callback` URL for the selected origin.
5. Supply issuer/client ID/client secret together, explicitly load them and restart.
6. Link Google from the existing administrator account using the required account proof. Sign out/in and verify the same identity/access.
7. Create an invitation with project/role/expiry; explain private sharing of its one-time link and that the dashboard does not send invitation email.
8. Accept as the invited person, verify role boundaries and test disabled/expired/reused invitation behavior.
9. Preserve a tested recovery administrator and link to host-side recovery instructions.

**Proof:** both sign-in methods resolve to the intended account, invited access is scoped, and recovery does not rely on changing bootstrap secrets.

### F. Publish from another machine or CI

1. Create/select the project on the dashboard as an authorized user.
2. Create a named upload token, store it when shown and explain that it is not an admin password or runner credential.
3. Set the canonical dashboard URL and upload token on the capture machine using its documented environment loader.
4. Verify runner access to both application URLs and the dashboard; use HTTPS for remote publishing.
5. Run a project-bound comparison with revision/branch/PR metadata as needed.
6. Confirm project, run identity, evidence completeness and revision in the dashboard.
7. Demonstrate retrying an existing saved run without recapturing or changing immutable evidence; state release-specific bounds and retention.
8. Rotate/revoke the token and explain local evidence retention after failed upload.

**Proof:** no database/admin secret is required on the capture machine, and a failed publish remains recoverable from saved evidence.

### G. Trigger a test from the dashboard

1. Verify compatible dashboard/runner feature releases and maintainer/admin project access.
2. Save the project's production/staging routes and viewports; explain profile limits, version conflicts and why secrets/hooks stay on the worker.
3. Create the separate expiring runner credential and an ignored runner environment file.
4. Install package/browser/system prerequisites on the runner and confirm it can reach the two applications and dashboard.
5. Start the foreground project-scoped runner using the dashboard's command; keep that process running.
6. Wait for connected status, click Run test and observe the saved config version used by the request.
7. Explain queued/starting/capture/upload/finalization states and the measured comparisons-completed count. Completion does not imply a passing verdict.
8. Open View result and verify the project/revision/evidence. Explain older-runner progress compatibility.
9. Demonstrate stopping/disconnecting and revoking a runner; describe queue/lease expiry, last-known progress and saved evidence without inventing automatic retries.
10. Explain `--once` separately: it polls once for already queued work and does not leave a connected service.

**Proof:** UI-triggered capture executes on the private worker, an upload-only token cannot claim work, and hosted dashboard requests do not start browser subprocesses.

### H. Baselines, reviews and visual policy

1. Complete a local baseline example first: explicit creation, compare, inspect and deliberate update with compatible capture settings.
2. Separately publish exact evidence for a dashboard review; assign/review with the documented roles.
3. Record an intentional decision and explain how it differs from local acceptance.
4. Promote approved evidence into a baseline set/version, inspect lineage and pull a pinned version on a runner.
5. Configure policy requirements and assess the exact run/revision; demonstrate stale/incomplete/pending evidence behavior.
6. Configure GitHub delivery only after local assessment works; verify the check attaches to the current PR head, not an older commit.

**Proof:** reviewers can trace the approved evidence, pulled baseline and policy outcome to their actual immutable versions/revisions.

### I. Playwright, CI and sharding

1. Provide a complete working Playwright fixture configuration/test and match the reference interaction state.
2. Provide a complete GitHub workflow with dependency/browser installation, application readiness and actual preview URLs.
3. State permissions and secret availability, including fork PR behavior; keep AI optional and avoid publishing secrets into report artifacts.
4. Run tests and upload evidence on both pass and failure; explain review/regression/incomplete outcomes.
5. Add dashboard publication as an optional complete extension, then add PR comments/checks with their separate credential scopes.
6. Expand to shards only after the single run works: common identity, unique artifacts, explicit merge and complete-shard verification.

**Proof:** the example preserves failed-run evidence and rejects a missing or mismatched shard instead of producing a misleading pass.

### J. Hosted dashboard and operational recovery

1. Choose Vercel or Cloud Run, a compatible package release and external persistent PostgreSQL or transactional MongoDB.
2. Generate the deployment scaffold into a separate empty folder/project, install its dependencies and inspect the emitted version/configuration.
3. Configure actual server-side secrets, network permissions, canonical HTTPS origin and login mode. Do not use public client-prefixed variables.
4. Deploy using provider instructions checked at guide-authoring time; include region/port/DB connection details and who performs each step.
5. Verify login, refresh on deep links, project creation, upload of real evidence and baseline pull. For Vercel, verify API routes and current generated rewrites, including policies/invites.
6. Connect a private runner separately; explain hosted filesystem/request/runtime constraints and provider limits for the tested release.
7. Create both the portable evidence export and the appropriate native operational backup; restore into an isolated environment and verify accounts/configuration/run evidence.
8. Upgrade from a specified prior release, regenerate/review deployment files where needed, and document compatibility/rollback limits.
9. Test host-side recovery on supported hosts; do not present POSIX-only recovery as a native Windows command.

**Proof:** a guide is labeled validated only after its stated provider/storage/release path was exercised. Otherwise show the unverified boundary and do not claim deployment certification.

## 8. Documentation website setup guide for contributors

This section specifies the future implementation recipe. None of these commands were executed for this planning change.

### 8.1 Initial scaffolding

1. Start at the VisualGuard repository root on a documentation feature branch. Record existing changes and preserve them.
2. Check `node --version` and `pnpm --version`. Select a supported Node version meeting the docs dependencies, currently at least 22.22.0; use the repository's pnpm 9.
3. Check current package engines/peers and record the chosen compatible stable dependency versions.
4. Create the Starlight application:

   ```sh
   pnpm create astro@latest apps/docs --template starlight --no-install --no-git
   ```

   If flags differ in the selected generator, use its documented equivalents. Confirm the destination; decline nested Git initialization and use the root workspace installation.

5. Set the generated package name to `@visualguard/docs`, `private: true`, and an accurate docs-specific Node engine. Keep dev/build/preview scripts; remove template scripts that invoke deferred checks.
6. Run `pnpm install` at the root to add the workspace to the single root lockfile. This first dependency update uses a normal install; subsequent clean installs use the committed frozen lockfile.
7. Add React and Tailwind from the docs workspace, reviewing generator edits:

   ```sh
   cd apps/docs
   pnpm astro add react
   pnpm astro add tailwind
   pnpm add @astrojs/starlight-tailwind
   cd ../..
   ```

8. Ensure `react`/`react-dom` and their types are declared where required. Review the generated JSX/TypeScript configuration without running a semantic type check.
9. Register Starlight and React in `astro.config.mjs`; register `tailwindcss()` from `@tailwindcss/vite` as a Vite plugin. Avoid duplicate integrations/plugin entries.
10. Create Starlight-compatible `src/styles/global.css` and register it first in `starlight({ customCss: [...] })`:

   ```css
   @layer base, starlight, theme, components, utilities;
   @import '@astrojs/starlight-tailwind';
   @import 'tailwindcss/theme.css' layer(theme);
   @import 'tailwindcss/utilities.css' layer(utilities);
   ```

11. Preserve the current template's `src/content.config.ts` loader/schema setup. Extend Starlight's schema for the metadata described in section 9; use APIs compatible with the selected Astro/Starlight versions.
12. Configure title, sidebar, repository/edit links, favicon, canonical site/base path and theme tokens. Remove sample articles/assets.
13. Add proposed root aliases `docs:dev`, `docs:build`, `docs:preview` and focused `docs:test` as filters targeting `@visualguard/docs`; keep existing CLI/platform scripts intact. These names become available only after implementation.
14. Add output/cache ignore rules, the first complete setup pages and the progressively enhanced React setup chooser.
15. Start `pnpm docs:dev`, open its printed URL, and check the article/sidebar/mobile menu and an interactive component.
16. Run the focused static documentation build, then `pnpm docs:preview`. Verify search, assets and deep links with the production base path.
17. Review changed dependency/lockfile entries and commit this feature's implementation, guide and focused checks together.

Sources for the setup recipe: [Starlight starter](https://starlight.astro.build/getting-started/), [React integration](https://docs.astro.build/en/guides/integrations-guide/react/) and [Starlight Tailwind integration](https://starlight.astro.build/guides/css-and-tailwind/). Installation helpers mutate configuration; their changes must be reviewed before accepting the resulting setup.

### 8.2 Everyday docs contributions

The future `apps/docs/README.md` and `contributing/documentation/` guide must show: install from the root lockfile, start dev, locate/create an article, add its navigation entry, use the article template, add an image/example, run the focused content/link checks, build/preview and submit a scoped change. List exact working directories and generated outputs.

Explain that `astro build` is a static production build, not a semantic type-check result. Do not add `astro check`, `tsc`, ESLint or formatting to docs scripts during the current deferred-check sequence. Revisit those checks only under the existing F36/user-instruction boundary.

## 9. Content metadata, components and writing standards

### Required metadata

Extend the content schema with:

- `description`: required plain-language search/result summary.
- `audience`: developer, reviewer, operator or contributor.
- `docType`: tutorial, how-to, explanation or reference.
- `channel`: published, source or both.
- `lastReviewed`: date of actual behavior/content review, distinct from a Git timestamp.
- `verifiedAgainst`: release tag/package version or source commit used to verify executable instructions; required for setup/deployment tutorials.
- `minimumVersion`: where a released feature requires a specific version.
- `sourcePaths`: relevant repository files for audit/change tracking, used in maintainer metadata rather than cluttering the article body.

New custom fields need schema definitions and rendering/check support. Do not assume unknown frontmatter is automatically validated or displayed. Use the supported [Starlight schema extension mechanism](https://starlight.astro.build/reference/frontmatter/).

### Shared article template

```md
---
title: Run a visual comparison
description: Compare two application versions and inspect the evidence.
audience: developer
docType: tutorial
channel: published
lastReviewed: YYYY-MM-DD
verifiedAgainst: REPLACE_WITH_TESTED_RELEASE
sourcePaths:
  - packages/visualguard/src/cli/commands/test.ts
---

## What you will set up
## Before you start
## 1. Install the dependencies
## 2. Configure your application
## 3. Run and inspect a comparison
## Verify the setup
## Troubleshooting
## Next steps
```

This is a template, not publishable metadata. The content check must reject unreplaced review dates/release markers and empty sections in non-draft pages.

Use Starlight's native steps, tabs, cards, notes and code components where available. Build custom components only for release notices, repeated verification blocks and the React setup chooser. Prefer readable native article content to a large custom component system.

Write actions in active voice. Explain a term at first use; link to the glossary for later use. Use descriptive links, short task-based headings and complete commands with a language label. Explain outputs without promising exact terminal text that varies across releases.

Troubleshooting entries use **symptom → likely cause → diagnostic → fix → verification**. Never ask a user to share raw environment files, tokens, cookies or unredacted screenshot evidence. Document actual credential and evidence boundaries as part of the relevant workflow.

## 10. Migration and release accuracy

### 10.1 Existing content disposition

| Existing source | Website destination and retained role |
| --- | --- |
| `README.md` | Home, start, concepts and task guides; retain a concise repository introduction and working install path. |
| `packages/visualguard/README.md` | Consumer guides/reference; retain a self-contained npm intro, quickstart and release-specific docs links. |
| `docs/LOCAL-SETUP.md` | Contributor source setup plus source variations of dashboard/operator guides. |
| `docs/NPM-PACKAGE-SETUP.md` | Consumer installation, all storage paths, login, publishing, runner and dashboard deployment guides. |
| `docs/PRODUCT-FEATURES.md` | Concepts, comparison modes, dashboard tour and compatibility/release availability. |
| `docs/RELIABILITY-CHANGES.md` | Migration, failure policy, fixture limits, AI policy and dated validation links. |
| `docs/RELEASE-3.1.0-VALIDATION.md` | Preserve as historical validation; link from release notes only with its revision/date/scope. |
| `docs/PACKAGE-ARCHITECTURE.md` | Contributor architecture; retain any generated file-inventory provenance. |
| `docs/READING-THE-CODE.md` | Contributor beginner guide, with verified current source links. |
| `PUBLISHING-AND-USING.md` | Split maintainer release workflow from consumer setup; reconcile older duplicate instructions. |
| `CONTRIBUTING.md` | Contributor landing/testing/releases/docs entry points; retain root contribution entry. |
| `action/README.md`, `action/action.yml` | GitHub Action guide/reference; retain Action marketplace/repository usage entry. |
| `examples/nextjs/README.md`, `examples/nextjs/GEMINI-SCREENSHOT-TESTING.md` | Example-specific guides; retain runnable example instructions, remove stale duplication after verification. |
| `evals/README.md`, `fixtures/site/README.md` | Contributor evaluations/fixtures; retain local directory-specific instructions. |
| `PLAN.md`, organization-growth, onboarding, baseline, policy, UI and operations plans | Keep as dated engineering plans. Extract only verified implemented behavior into user docs. |
| `docs/PROJECT-ANALYSIS-AND-ROADMAP.md` | Keep as historical analysis; do not publish its future scope as a feature list. |
| `packages/visualguard/CHANGELOG.md`, `.changeset/*` | Release provenance; reconcile merged/unreleased changes before producing availability labels. |
| `docs/assets/demo.gif` and example screenshots | Reuse only after checking current UI/labels, asset size and alt text; regenerate stale evidence. |

Maintain `coverage.json` with source file/heading, destination route/heading, disposition (migrated, retained historical, superseded with reason), verification revision and review status. A file-level link alone is insufficient for long setup guides; track every meaningful section.

### 10.2 Source of truth and duplication

After migration, canonical task prose lives in `apps/docs/src/content/docs`. READMEs contain short entry instructions and links. Machine-checked example fixtures may supply code blocks to prevent divergence. CLI flags/defaults, configuration constraints, environment handling and public exports are grounded in implementation and focused contract checks.

Do not maintain full independently edited copies of the website and legacy setup guides. Keep the old guides until equivalent website content is verified and publicly reachable. At cutover, turn them into small navigation pages with a heading-by-heading old-anchor map. GitHub Markdown URLs cannot be redirected by the docs host; retain compatibility headings/links in those files. Configure real redirects or static redirect pages only for website routes actually moved.

Do not update the package homepage to an unpublished domain. Change README/homepage links after deployment smoke verification, and keep the npm package's published README links usable for that package version.

### 10.3 Published versus source

At content freeze, query npm metadata and inspect the corresponding tag/package; record the release and verification date. Compare pending changesets and merged commits. Never infer availability from the local manifest, a plan, or an old registry note.

Default articles teach the verified published release. Where merged source differs, show an adjacent source notice and link to the source guide. If no published release contains a feature, say so rather than inventing a minimum version. Future features stay in the repository plans.

Maintain one release data file for notices and compatibility tables. Add a concise migration page for older installs. At launch, avoid a full version selector that implies archived documentation exists. If materially incompatible releases later need parallel guides, add explicit versioned paths and search separation in a separate feature.

## 11. Design and usability

Use VisualGuard's established identity where verified assets/tokens exist; review any brand materials separately before adopting them. Keep the Starlight documentation reading experience recognizable and lightweight.

- Desktop: grouped left navigation, centered readable article, right table of contents and visible search.
- Mobile: accessible menu/search controls, useful heading structure and horizontal scrolling contained within wide code/table blocks.
- Light/dark themes: readable body, muted text, links, badges and code with checked contrast in both.
- Code: copy action, file labels where helpful, highlighted relevant lines and complete runnable snippets.
- Screenshots: actual current UI, explicit captions/alt text and no credentials or private user data.
- Diagrams: a few focused diagrams for runner/dashboard/database, upload flow and review/baseline/policy relationships. Use a supported rendering approach plus text descriptions.
- Keyboard: visible focus, skip links, usable menu/search/dialogs and no hidden critical information behind hover-only controls.
- Motion: keep it minimal and respect reduced motion. No animation is necessary to understand setup.

Check representative pages at 390 px, 768 px and 1440 px widths. Verify zoom, long command lines, dense reference tables and screen-reader labels. Keep ordinary articles free of React hydration unless they use an interactive island.

## 12. Validation strategy and acceptance matrix

This plan requires verification during implementation; it does not claim those checks have run. Prefer the smallest check that establishes the relevant behavior. Do not run formatting, lint, type checking, `astro check` or a broad unrelated test suite under this work sequence.

| Area | Focused validation | Acceptance evidence |
| --- | --- | --- |
| Static site | Build only `@visualguard/docs` and preview its output. | All public pages generated with no unresolved imports/content errors; search assets emitted. |
| Content completeness | Check required metadata, page coverage map, unfinished markers and required setup headings. | No non-draft unfinished pages or unmapped required source sections. |
| Internal navigation | Parse generated pages; resolve local links/assets/heading fragments with configured base and trailing-slash rules. | Zero broken internal page/asset/anchor destinations, including non-root deployment. |
| Examples | Parse complete config fixtures against the current schema; compare CLI/Action/API references with source contracts. | Documented commands/options/defaults match their stated version; complete workflows parse. |
| Consumer setup | Execute the documented sequence in a clean disposable project against the pinned package and local fixture apps. | Captures and report work without AI, accounts or database. |
| Source setup | Follow clone/build/fixture/config/report steps from the stated revision. | Reproducible report with expected changed/unchanged cases. |
| Storage paths | Follow SQLite, PostgreSQL and transactional MongoDB guides independently. | Correct workspace/project persistence after restart; documented errors for unsupported topology. |
| Team/runner | Focused existing services/tests plus a documented real private-runner capture. | Roles/tokens respected; UI result/progress matches evidence and disconnect behavior. |
| CI/baselines/policy | Exercise the documented workflow with a controlled failing comparison and incomplete shard. | Evidence survives failure; merge and exact-revision policy cannot silently pass incomplete/stale input. |
| Search | Test production preview queries such as install, MongoDB, upload token, runner disconnected and baseline. | Correct guides discoverable; result links/anchors work under base path. |
| Accessibility | Focused browser/manual review of nav/search/tabs/chooser and representative articles. | Keyboard access, focus, labels, contrast and overflow verified in both themes. |
| Hosting | Check deployed homepage, direct nested URLs, refresh, favicon, downloads, search, sitemap and 404. | Correct canonical/base configuration; published URL works without dashboard services. |
| Migration | Audit every source-heading mapping and legacy links after cutover. | No setup/troubleshooting topic lost and historical scope stays labeled. |

Use a small dedicated docs check command for content/link/example contracts. These are functional documentation checks, not disguised formatting or semantic type checks. No new test framework is needed for prose-only edits; add automated checks where they protect contracts or navigation.

External links may fail transiently or require sign-in. Check authoritative links separately with bounded requests and actionable reporting; do not make an unrelated network outage indistinguishable from a broken local docs build.

Record test date, command/path, version/commit, OS/provider and pass/failure in the implementation/release evidence. State what was not exercised. Static analysis, a docs build and an actual cloud smoke test are different levels of evidence.

## 13. Hosting, CI and release process

### 13.1 Proposed hosting default

Use a static GitHub Pages deployment from this repository as the initial proposal. It fits a static documentation app and avoids coupling the site to the dashboard deployment. Host availability, repository eligibility and the final canonical URL must be confirmed before enabling publication. A custom domain or another static host can be selected without changing article architecture.

For the existing repository identity, the expected project-site shape is `https://shubhamtiwari909.github.io/visualguard-ai-testing/`; this is a proposed target, not a verified live site. Configure the origin and `/visualguard-ai-testing` base accordingly. A dedicated custom domain generally changes the base to `/`; verify all route/asset/search paths again when changing it.

The proposed deployment follows Astro's [GitHub Pages guide](https://docs.astro.build/en/guides/deploy/github/) with monorepo-aware install/build paths and pinned compatible runtime/action versions.

### 13.2 Build and deployment sequence

1. Add a focused docs check workflow for PRs that touch `apps/docs`, `scripts/docs`, relevant root manifests/lockfile or the docs workflows.
2. Install with pnpm 9 and the committed root frozen lockfile on a Node release meeting docs engines. Build from the repository root with the docs filter; upload only `apps/docs/dist`.
3. Run functional content/link checks and a production-base build. Store build output as a review artifact; ordinary PR builds do not publish production.
4. Keep deployment in a separate workflow/job with `contents: read`, `pages: write` and `id-token: write` only where needed. Use the GitHub Pages environment and deployment concurrency.
5. Configure repository Pages to deploy from GitHub Actions. Enable this publication only at the launch step after the site and cutover are reviewable.
6. Deploy the accepted main revision; verify the actual returned URL, search, assets and deep links.
7. Update root/package README links and package homepage only after the site is reachable. Those entry-link changes belong to the launch feature commit, with its documentation/checks.
8. Keep the previous known-good static artifact/revision identifiable. Roll back the website by redeploying that revision; no data migration is involved.

Separate docs jobs from engine/database/browser suites. Do not add docs to the root package release build or npm tarball. `@visualguard/docs` stays private and is excluded from public publishing; verify Changesets behavior with the chosen workspace configuration.

### 13.3 Ongoing content release

Feature changes include their guide/reference updates and focused contracts in the same feature commit. A package release updates the central availability data only after publication is verified. If site deployment precedes a package release, source-only notices remain visible.

The docs contribution checklist asks whether commands, environment settings, minimum versions, UI names, screenshots, CLI reference, migration notes and troubleshooting changed. Use source paths in metadata to identify likely impacted pages; do not infer that a successful build proves their prose remains correct.

## 14. Implementation sequence and commit boundaries

Each row is a separately requested, independently reviewable feature. Include its code, guide changes and necessary focused checks in the same commit. The planning commit precedes all rows. Do not implement all phases merely because this plan lists them.

| Step | Deliverable | Completion gate | Suggested commit |
| --- | --- | --- | --- |
| D01 | Workspace, compatible dependencies, Starlight/Tailwind/React foundation, root scripts and docs contributor setup. | Static build/preview, base-path asset check and one useful hydrated component. | `feature: add Astro Starlight documentation foundation` |
| D02 | Home, setup chooser, concepts, consumer first-run guide and source demo. | Clean consumer/source walkthroughs with report evidence; complete prerequisites. | `feature: document VisualGuard installation and first comparisons` |
| D03 | Capture/configuration/routes/reports/local baselines/Playwright/auth/AI/fix/check/watch guides and relevant reference. | Complete examples verified against stated release/source contracts. | `feature: document VisualGuard testing workflows` |
| D04 | Local dashboard, storage alternatives, projects, login/Google, invitations, publishing and private runners/progress. | Each storage/setup path checked; real runner capture and credential distinctions verified. | `feature: document dashboard and team setup` |
| D05 | Reviews, approved baselines, policy, CI/Action, preview deployments, sharding and GitHub delivery. | Controlled review/policy/CI failures and complete-merge behavior documented and checked. | `feature: document visual review and CI workflows` |
| D06 | Dashboard hosting, backups, upgrade/recovery and operator reference. | Provider-specific validation recorded, or limitations explicitly visible; backup/restore instructions checked. | `feature: document dashboard deployment and operations` |
| D07 | Remaining reference/troubleshooting, compatibility/releases, contributor guides, full migration map and focused docs checks. | No required topics unmapped, no unfinished public pages and no broken internal links. | `feature: complete documentation reference and migration coverage` |
| D08 | Production publication, accessibility/search review, README/homepage cutover and legacy anchor navigation. | Live URL smoke passes; entry links verified; rollback revision recorded. | `feature: publish VisualGuard documentation website` |

D01–D02 provide an early usable preview, not the complete launch. D08's public cutover follows all required content and checks. If a step grows too large, split it into smaller requested features with the same implementation/docs/checks rule; do not merge unrelated engine work into a documentation phase.

## 15. Risks, decisions and launch checklist

| Risk or decision | Planned handling |
| --- | --- |
| Old prose describes a different release than the copied commands. | Verify release artifacts and tag every executable guide with tested version/commit. |
| New framework dependencies require a newer Node than the engine. | Docs-specific engines/runtime and explicit contributor installation boundary. |
| Tailwind reset breaks Starlight layout or dark mode. | Official compatibility layers, narrow custom CSS and theme/responsive checks. |
| Many pages overwhelm a beginner. | Task-based entry points, progressive sidebar groups and one default first-run path. |
| Long guides omit environmental assumptions when split. | Shared writing contract plus complete standalone prerequisites and contextual cross-links. |
| Legacy links stop working during migration. | Keep source guides until launch; preserve old anchors with navigation and track every section. |
| Source-only runner/policy features appear as published promises. | Central release data and visible source requirements; no invented release version. |
| Search/assets break beneath a repository path. | Production-base build and deployed search/deep-link smoke checks. |
| A hosting article sounds tested when it was only copied. | Separate verified paths from untested boundaries and record provider/date/release evidence. |
| Public docs become stale after features ship. | Same-feature documentation commits, source metadata, release checklist and focused contracts. |

Defaults settled by this plan: separate `apps/docs` workspace; static output; Starlight-native reading layout; Tailwind v4 integration; a small React setup chooser; Pagefind; English first; npm consumer/pnpm repository examples; published-versus-source notices; no full version archive at launch.

Resolve during the relevant implementation step: exact compatible package versions and Node patch, real published VisualGuard version, brand asset selection, hosting eligibility/canonical URL and provider-specific validation environment. These do not block preparation of the plan. Do not enable hosting, change a public homepage or claim production readiness before the deployment is concrete and verified.

### Definition of done for the documentation launch

- [ ] The requested stack is implemented in an isolated private docs workspace.
- [ ] New users can complete package and source setup from their stated starting conditions.
- [ ] Offline, SQLite, PostgreSQL and transactional MongoDB paths are clear and independent.
- [ ] Application auth, dashboard login, Google linking, upload tokens and runner credentials are correctly distinguished.
- [ ] Every implemented testing, review, baseline, policy, CI and operations topic has a verified destination.
- [ ] Every required guide includes complete steps, files, environment loading, expected outcomes and recovery links.
- [ ] Release/source availability is verified and visible; plans stay labeled as plans.
- [ ] All existing meaningful documentation sections have an explicit migration disposition.
- [ ] Production build, internal links, search, mobile layout, accessibility and base paths are verified.
- [ ] Deployment/backup guides disclose their actual validation scope and constraints.
- [ ] The public URL works before README/homepage cutover; historical/legacy links remain navigable.
- [ ] Contributors have a complete website setup and article-maintenance guide.
- [ ] Planning and feature commits follow `AGENTS.md`; deferred checks are accurately reported.

## 16. Reference material

Repository migration inputs are listed in section 10. Implementation contracts include `packages/visualguard/src/cli/program.ts`, `src/cli/commands/*`, `src/config/schema.ts`, `src/config/load.ts`, `src/config/resolve.ts`, `src/core/errors.ts`, `src/core/status.ts`, `src/index.ts`, the Playwright entrypoint, `apps/platform/server/*`, `apps/platform/.env.example`, `action/action.yml` and their focused tests.

Upstream primary references checked while planning:

- [Astro installation and runtime requirements](https://docs.astro.build/en/install-and-setup/).
- [Astro React integration](https://docs.astro.build/en/guides/integrations-guide/react/).
- [Starlight getting started](https://starlight.astro.build/getting-started/) and [manual setup](https://starlight.astro.build/manual-setup/).
- [Starlight Tailwind/CSS setup](https://starlight.astro.build/guides/css-and-tailwind/).
- [Starlight authoring content](https://starlight.astro.build/guides/authoring-content/) and [frontmatter/schema extension](https://starlight.astro.build/reference/frontmatter/).
- [Starlight site search](https://starlight.astro.build/guides/site-search/).
- [Astro deployment overview](https://docs.astro.build/en/guides/deploy/) and [GitHub Pages deployment](https://docs.astro.build/en/guides/deploy/github/).

Recheck upstream APIs and engines when implementing. This planning pass inspected documentation and source contracts only; it did not install dependencies, scaffold/build/deploy the site, execute product walkthroughs, or run formatting, lint or type checks.
