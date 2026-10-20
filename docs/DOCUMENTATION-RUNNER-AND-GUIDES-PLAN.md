# Documentation completion plan

Reviewed 20 October 2026. Branch: `codex/documentation-runner-and-guides`.

## Goal and current state

Make the Astro documentation website the complete, navigable guide to installing and using VisualGuard. Keep the README as a short entry point. Use Astro, Starlight, React and Tailwind in the existing `apps/docs` workspace, preserving the CLI and offline workflows.

Continue Claude's expanded guide drafts and the dashboard-host runner already implemented in source. The branch starts at source revision `e2c69cc`, including the manifest version bump to 3.2.4. The npm artifact reviewed for this work is 3.2.3; a source version bump alone does not establish publication. Every guide must distinguish these channels where their behavior differs.

## Phase 1 — Preserve the existing work and audit coverage

1. Work only on the requested branch and preserve unrelated local files.
2. Review the existing articles, package commands, source exports, dashboard behavior, deployment scaffolds and release metadata.
3. Map retained repository documentation to website destinations. Preserve historical release evidence as historical material.
4. Inventory every website route and the reader journeys that depend on it. Identify missing articles and contradictory instructions.
5. Commit this planning document before committing the implementation.

Acceptance: the requested branch is selected, prior work is retained, source/release boundaries are recorded and the remaining work has explicit completion criteria.

## Phase 2 — Complete the reader journeys

### Getting started and concepts

- Explain the CLI, local dashboard and hosted team choices before asking readers to install anything.
- Give supported Node/package-manager/browser requirements and OS-specific setup context.
- Provide a reproducible first comparison with two tiny local servers, a complete config, commands, expected artifacts and cleanup steps.
- Explain statuses, pixel differences, AI interpretation, routes, viewports and all three distinct baseline workflows.
- Add a common-task index, glossary and FAQ with direct links to the next useful action.

### Testing guides

- Cover zero-config scans, complete configuration, route mapping, browsers/viewports and stable captures.
- Explain authenticated apps, Playwright hooks, interactive setup and the limits of dashboard-saved profiles.
- Cover deterministic differences, masking/noise, accepting changes, local baselines, watch and monitoring.
- Document Gemini and Ollama prerequisites, environment placement, privacy, fallback, policy and budgets.
- Explain HTML/JSON/JUnit output, custom reporters, the public JavaScript API, suggested fixes and accessibility/performance evidence.
- Give a complete Next.js integration example with commands in the correct working directories.

### Dashboard and teams

- Walk through local startup, the UI, sign-in, Google setup, projects and project permissions.
- Show evidence publishing, saved test profiles, Run test, live progress and result review.
- Clearly explain private-runner priority, dashboard-host fallback, required browsers/network access and source-only availability.
- Cover runner tokens, host environment, disconnection/timeouts, credential revocation and execution limits.
- Explain collaborative review, approved baseline sets and visual release policies without conflating them with local accepted files.

### CI, deployment and operations

- Cover GitHub Actions inputs, browser installation, secrets, artifacts, previews, checks and sharding.
- Explain persistent database and artifact-storage requirements separately.
- Give complete Cloud Run, Vercel, PostgreSQL/Cloud SQL and MongoDB paths, including post-deployment verification.
- Document dashboard-host background execution requirements on Cloud Run and private-runner use on Vercel.
- Cover backups, restore rehearsal, health checks, upgrades and operational recovery.

### Reference and troubleshooting

- Generate CLI flags and configuration reference from source; check all 142 configuration entries for drift.
- Cover public exports, environment variables, artifact structure, exit codes and compatibility.
- Provide installation, capture, CI and dashboard troubleshooting linked from relevant tutorials.
- State published/source availability and migration caveats, including the npm 3.2.3 CLI's stale embedded version label.
- Keep contributor setup, architecture, code-reading, testing, release and documentation maintenance guides complete.

Acceptance: readers can follow a complete path from prerequisites to a checked result. Tutorials include verification and troubleshooting. Examples state which machine, folder and environment they use. No guide promises behavior that the published release does not provide.

## Phase 3 — Navigation and documentation safeguards

1. Maintain a shared navigation manifest used by Starlight and content validation.
2. Order pages by the learning journey and divide the long testing-guide group into understandable sections.
3. Reject missing, duplicate or unlisted public routes before building.
4. Keep automatic search, mobile navigation, theme switching, page contents and per-page source/review metadata.
5. Validate article links, anchors and assets for both root hosting and a project subpath.
6. Keep source-heading migration coverage and generated references checked without invoking formatting, lint or type checks.

Acceptance: every public article is reachable, critical tasks are easy to find, and missing navigation targets fail a focused check.

## Phase 4 — Verify the instructions against real behavior

1. Run the focused documentation checks: metadata, route coverage, links, examples and generated contracts.
2. Build the documentation website and inspect search, navigation, key guides and mobile layout in a real browser.
3. Run the exact published-package quickstart in a temporary clean project, including SQLite publish/restart checks.
4. Run focused dashboard-host runner tests already present in the repository.
5. Add a real Chromium smoke for the source dashboard host: create a project, save its profile, request a test without a runner token, observe progress, verify stored evidence and reopen it after restart.
6. Record validation boundaries honestly: local Chromium/SQLite checks do not validate live Google sign-in, cloud deployment, PostgreSQL or MongoDB services.

Acceptance: runnable first-use instructions work, built-in capture has actual browser evidence, both hosting paths resolve links and no deferred checks are reported as passed.

## Phase 5 — Handoff

1. Keep the plan in its own preceding commit, then commit the completed documentation and its focused safeguards together.
2. Inspect the final diff and status, excluding unrelated local work.
3. Push only `codex/documentation-runner-and-guides`.
4. Report the completed coverage, validation results, branch and any external deployment boundaries.

The existing documentation deployment workflow remains a manual main-branch publication step. This branch work does not itself publish a website or npm package. Formatting, lint and type checking remain deferred under the repository instructions.
