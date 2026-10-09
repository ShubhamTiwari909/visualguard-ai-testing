# VisualGuard: project analysis and improvement roadmap

Reviewed on **9 October 2026**, against local commit **`6e918a5`**. The package manifest declares **1.1.0**; this review does not independently verify the published npm version.

## 1. Recommendation

VisualGuard already goes well beyond screenshot comparison. Its strongest product direction is **a local-first visual review and repair workflow for Playwright projects**: show the change, explain the evidence, propose a small source edit, and demonstrate whether that edit worked.

The next release should prioritize **trustworthy results and consistent verification** before adding more AI providers or diff engines. A developer will keep using this tool if it reliably answers three questions:

1. Is this a real problem or an expected change?
2. Which source change is likely responsible?
3. Did the proposed fix resolve the problem without breaking another page or viewport?

The biggest opportunities are stricter automatic-fix guarantees, baseline provenance, better Playwright fixture parity, measurable AI quality, and a faster review workflow. There are also several specific implementation issues worth resolving first.

## 2. Scope and confidence

This is a **static source and documentation review**, with official documentation consulted for selected integration recommendations. It covers the CLI, configuration, capture pipeline, diff orchestration, AI providers and prompts, source locator, fixer, report server and UI structure, baseline acceptance, sharding, CI workflows, tests, and evaluation runner.

- **Observed behavior** below means it follows directly from the inspected code. It is not a claim that a reproduction was executed.
- **Risk/inference** means a plausible consequence that should be confirmed with the proposed focused test.
- **Proposal** means a new capability or policy; proposed configuration and commands are not available APIs.
- No build, lint, type check, browser suite, live Gemini request, or benchmark was run. No API credentials were read, and no application code was changed.
- Existing test files were inspected for coverage and intent; their presence is not evidence that they currently pass.

## 3. What is already implemented

Avoid spending roadmap time on capabilities the project already has.

| Area                       | Existing implementation                                                                                                                                | Assessment                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Installation and first use | npm CLI, `init`, `doctor`, zero-config commands, getting-started guide                                                                                 | A useful foundation for adoption                                |
| Capture                    | Playwright contexts per capture, retries, fonts/images/network waits, scroll loading, clock/media pausing, masks, hiding, stability loop               | Substantial attention to screenshot noise                       |
| Discovery and environments | Explicit routes, Next.js discovery, sitemap/crawl, dynamic parameters, route mappings, headers and storage state                                       | Supports real staging/production workflows                      |
| Comparison                 | pixelmatch, regions/crops, layout shifts, noise maps, DOM/style explanations                                                                           | More actionable than a red pixel image alone                    |
| AI                         | Gemini and Ollama, optional heuristics-only mode, structured outputs, repair attempt, caching, concurrency and analysis-call budget                    | A good separation between provider transport and analysis tasks |
| Review                     | React HTML report, side-by-side/slider/onion/diff views, region navigation, keyboard support, acceptance and served fix actions                        | Already has the core visual review experience                   |
| Fixing                     | Source ranking, deterministic CSS/Tailwind edits, AI search/replace proposals, validation, confirmation, command and visual verification, retry/revert | The most distinctive part of the project                        |
| Automation                 | Worktree-based auto-fix, optional PR creation, watch mode, sharding and merge                                                                          | Useful capabilities that now need stronger guarantees           |
| CI                         | GitHub Action, sticky PR comments, JUnit, job summaries, webhooks, artifact upload                                                                     | Do not describe CI integration as missing                       |
| Additional checks          | Opt-in accessibility and performance checks, baseline and monitoring modes                                                                             | Valuable adjuncts to visual regression testing                  |
| Quality infrastructure     | Unit/integration/browser-oriented tests, provider mocks, fixture pages, package smoke test, OS/Node CI matrix, labelled eval runner                    | Strong breadth; live effectiveness still needs measurement      |

Primary entry points: [configuration schema](../packages/visualguard/src/config/schema.ts), [run orchestration](../packages/visualguard/src/core/run.ts), [capture](../packages/visualguard/src/capture/capture.ts), [fix loop](../packages/visualguard/src/fixer/fix.ts), [package documentation](../packages/visualguard/README.md).

## 4. Architecture and the main design opportunity

```text
Config + environment + route discovery
                 |
          route × viewport jobs
                 |
    production/baseline + staging captures
                 |
      pixel diff + regions + noise handling
                 |
         DOM mapping + health findings
                 |
       accepted-change matching + optional AI
                 |
     manifest + terminal/HTML/CI/report outputs
                 |
      source ranking → patch proposal → validation
                 |
       apply → commands → visual verification
                 |
            keep or revert/retry
```

The separation into capture, diff, mapping, AI, reporters, and fixer modules is sensible. Keep these boundaries rather than undertaking a framework rewrite.

The important weakness is that related workflows implement different subsets of the pipeline. The CLI runner, Playwright fixture, fix verifier, and merge path can therefore disagree about identity, checks, or what constitutes success. Extract shared comparison and policy services while retaining separate capture adapters for a CLI-created page and a page owned by an existing Playwright test.

## 5. Source-backed findings to prioritize

Priority definitions: **P0** = misleading success or broken repair guarantee; **P1** = important reliability/integration gap; **P2** = usability or maintainability improvement. These are engineering priorities, not security severity ratings. Effort estimates are relative: S = focused change, M = several modules, L = broader design work.

### F01 — Automatic fixing includes unverified edits in commits

**Priority: P0 · Effort: S–M · Confidence: observed behavior**

In [fixer/fix.ts](../packages/visualguard/src/fixer/fix.ts), `applyAndVerify()` returns `unverified` after applying edits when no verification server is configured. In [fixer/auto.ts](../packages/visualguard/src/fixer/auto.ts), `autoFix()` includes both `fixed` and `unverified` outcomes in the files it commits and can push into a PR. The package README says automatic mode commits only verified fixes.

**Impact:** the strongest product promise is weaker than the documentation suggests. With the default empty verification-command list and no server, an automatic edit can be committed without command or visual validation.

**Recommendation:** require a visual verification configuration for automatic mode by default. If proposal-only or explicitly unverified operation is supported, give it a separate result and clearly labelled draft artifact. Preserve interactive application as an explicit user choice.

**Acceptance criterion:** an automatic run without a verification server does not commit or publish an edit as a successful fix; documentation and PR wording match the result.

### F02 — Exact acceptance can suppress a new health regression

**Priority: P0 · Effort: S · Confidence: observed control flow**

[core/accepted.ts](../packages/visualguard/src/core/accepted.ts), `applyAccepted()`, checks for an exact screenshot hash first. The check that blocks acceptance when a health regression exists is only inside the similar-match fallback. An exact match therefore becomes `accepted` even if a new nonvisual health problem is present. `accepted` does not fail the run under the current status policy.

A concrete case is an already accepted visual change whose pixels stay identical while staging starts reporting an additional failed request. The current [acceptance test](../packages/visualguard/test/accepted.test.ts) for a new health problem changes the screenshot shade, so it exercises the similar-match branch.

**Recommendation:** apply visual acceptance independently from health/accessibility/performance policy, then combine the results. At minimum, guard both matching paths against new blocking health findings.

**Acceptance criterion:** identical accepted PNGs plus a new blocking health finding still fail; add separate exact and similar acceptance cases.

### F03 — Fix verification does not faithfully replay the original comparison

**Priority: P0 · Effort: M–L · Confidence: observed behavior, with scenario-dependent impact**

[fixer/verify.ts](../packages/visualguard/src/fixer/verify.ts), `verifyAgainstProduction()`, rebuilds a route from URLs, selects one viewport, and runs a new live comparison against production. It does not use the original saved reference screenshot. It also reconstructs the route without its route-specific `waitFor`, `mask`, or `hide` settings.

**Consequences:** production can change between diagnosis and verification; masked dynamic content can reappear; a baseline-origin job can be verified against a live reference instead of its stored expected image. A shared CSS fix is only verified for the selected route and viewport.

**Recommendation:** persist a replayable comparison specification and immutable reference artifact. Reuse the original capture policy; make baseline/live reference choice explicit. After the local check succeeds, verify affected routes at their configured viewports, with a full-suite fallback when dependency mapping is uncertain. Recheck the accumulated edits before committing a batch, because a later fix can undo an earlier one.

**Acceptance criteria:** a masked authenticated route reproduces its original policy; changing live production does not change the repair target; a desktop fix that breaks mobile is not marked fully verified.

### F04 — Baseline identity omits rendering dimensions

**Priority: P1 · Effort: M · Confidence: observed behavior**

[core/jobs.ts](../packages/visualguard/src/core/jobs.ts) identifies CLI jobs by route slug and viewport name. [core/run.ts](../packages/visualguard/src/core/run.ts) stores baselines under that job ID. Browser, platform, color scheme, locale, and actual viewport configuration are not part of this filename. The Playwright fixture also uses a test/check-derived identity without explicitly incorporating the Playwright project or rendering fingerprint.

**Impact:** changing the width of a viewport named `desktop`, switching browsers, or sharing baseline storage across platforms can select an incompatible reference. A browser matrix needs stronger isolation before it is convenient to support.

**Recommendation:** add baseline metadata and a rendering fingerprint covering browser, viewport dimensions, scale/mobile settings, locale, timezone, theme, stabilization policy, and environment/build provenance. Separate hard compatibility rules from informative metadata; every patch-level browser update need not create a new namespace. Provide explicit migration for old snapshots.

Playwright itself documents that screenshots vary across browsers and platforms and recommends matching the baseline environment. This supports adding compatibility checks rather than treating these differences as application defects. [Official visual comparison guidance](https://playwright.dev/docs/test-snapshots).

**Acceptance criterion:** incompatible references produce a clear diagnostic or a distinct baseline key instead of a misleading application diff.

### F05 — The Playwright fixture offers only part of the CLI pipeline

**Priority: P1 · Effort: M–L · Confidence: observed behavior**

[playwright/index.ts](../packages/visualguard/src/playwright/index.ts) reuses capture and classification utilities, but implements its own flow. It does not invoke the CLI's AI analysis session, accepted-change handling, or second-capture noise-map path. It initializes current-page console/request health arrays during the check, after earlier page activity, so those earlier events are unavailable. Missing baseline files are saved and returned as `pass` even without an explicit update request.

The fixture also captures a fresh production page by URL. If a test opens a modal or fills a cart before checking staging, production will not automatically replay those actions. Global hooks can help, but they are not a first-class per-check paired scenario.

**Recommendation:** publish a CLI/fixture capability table immediately. Share comparison, policy, and optional AI services. Add a deliberate missing-baseline policy, particularly for CI, and an explicit reference setup callback or baseline-first workflow for interactive states. Make fixture instrumentation opt-in and early enough to capture relevant events.

**Acceptance criteria:** parity tests explain intentional differences between adapters; CI can reject missing baselines; a modal-open comparison checks the same state on both sides.

### F06 — The AI cache does not cover every meaningful input

**Priority: P1 · Effort: M · Confidence: observed key construction**

[ai/cache.ts](../packages/visualguard/src/ai/cache.ts) hashes provider/model, prompt version, route/viewport, findings, region data, and production/staging crops. [ai/tasks/analyze-diff.ts](../packages/visualguard/src/ai/tasks/analyze-diff.ts) also supplies the diff crop, mode-dependent labels, health counts, and overall comparison context. Those inputs are not all explicitly represented in the key; provider thinking/image settings are also absent. Some omitted fields may correlate with hashed fields, but that is not a complete cache contract.

The default Gemini model is a moving alias, `gemini-flash-latest`, in [providers/gemini.ts](../packages/visualguard/src/ai/providers/gemini.ts). An unchanged alias string does not identify an immutable model revision.

**Recommendation:** construct a canonical request descriptor once, use it for both request generation and hashing, include effective provider settings and schema/prompt versions, and record a returned model revision when available. Offer pinned model configuration for reproducible CI and a cache expiry/refresh policy for aliases. Validate cached records on read.

**Acceptance criterion:** changing any semantic request input invalidates the cached analysis; reproducibility metadata explains which model and settings produced a result.

### F07 — AI budgets measure analysis tasks, not total provider work

**Priority: P1 · Effort: M · Confidence: observed behavior**

[AnalysisSession](../packages/visualguard/src/ai/analyze-job.ts) increments a counter once per job analysis. [BaseProvider](../packages/visualguard/src/ai/provider.ts) can issue a schema-repair completion, and Gemini can retry transport requests. Patch generation has its own attempts and returns usage, but the fix proposal/outcome path does not retain that usage or share the analysis budget.

**Impact:** `maxCallsPerRun` is not a strict bound on HTTP attempts or total AI cost. Users cannot readily see the complete cost of diagnosis plus repair.

**Recommendation:** distinguish analysis tasks, generation attempts, network retries, input/output tokens, and estimated monetary cost. Add a shared budget/deadline context for analysis and repair, with best-effort accounting for failed requests. Use configurable, dated pricing data if displaying cost; never imply that an estimate is an exact bill.

**Acceptance criterion:** the report includes patch usage and repair attempts, and explains why further AI work stopped. Cancellation propagates through capture and AI tasks.

### F08 — Shard merge does not establish that inputs form one complete run

**Priority: P1 · Effort: M · Confidence: observed behavior**

[core/merge.ts](../packages/visualguard/src/core/merge.ts) checks that modes match, keeps the first occurrence of duplicate job IDs, and inherits much of the first manifest. It does not establish shared commit/configuration/deployment identity or require the complete expected shard set.

**Impact:** missing artifacts or artifacts from different executions can produce a plausible combined report whose coverage is incomplete or mixed.

**Recommendation:** persist a shared run-group ID, capture/config fingerprint, expected job IDs, shard count, and source revision. Reject incompatible inputs and incomplete shard sets by default. Keep partial reporting available through an explicit mode with a visibly incomplete status.

**Acceptance criterion:** missing shard 2/3 and mixed deployment/config inputs cannot produce a normal complete result.

### F09 — Evaluation can exclude the misses it needs to measure

**Priority: P1 · Effort: M · Confidence: observed behavior**

[evals/run.mjs](../evals/run.mjs) skips non-noise labelled cases when the base status is `pass`. That handles fixtures that legitimately have no difference at a viewport, but it also means an unexpected pass can disappear from the denominator. Applicability should come from the dataset, not from the system being evaluated.

The runner uses an AI classification when available and status-derived labels otherwise. With the default `ai.analyze: "uncertain"`, some cases deliberately skip the model. These are useful hybrid-system metrics, but they should not be presented as pure model accuracy. The runner prints metrics without a quality-threshold failure gate; [.github/workflows/evals.yml](../.github/workflows/evals.yml) is manually triggered.

**Recommendation:** explicitly label applicable route/viewport cases, track missing captures as failures, and separately score detection, classification, final CI policy, and patch success. Add deterministic gates to PR CI and bounded live-provider evaluations to a scheduled/manual workflow. Publish model, prompt, dataset version, sample size, skips, and fallback rate.

**Acceptance criterion:** making a known regression return `pass` lowers recall instead of removing that case from evaluation.

### F10 — The AI lacks change intent, and confidence is not calibrated

**Priority: P1 · Effort: M · Confidence: observed inputs; quality impact requires measurement**

The analysis prompt sees pixels, DOM changes, and findings but no explicit PR intent. The roadmap already notes this limitation. A visually coherent change can still be accidental, and a source edit need not be correct merely because a response matches its JSON schema.

Current strengths should be retained: hard heuristic regressions are not downgraded by AI, and an AI `intentional` label remains `review`. However, high-confidence `noise` can turn an uncertain job into `pass`; the model's self-reported confidence should be validated against a dataset before being treated as probability.

**Recommendation:** allow bounded PR title/description/changed-file context, show that context in the report, and label it as supporting evidence. Add a policy that keeps AI advisory in stricter CI environments. Calibrate the noise threshold against false-negative rates. Keep source validation and recapture as the authority for fixes.

Google's structured-output documentation distinguishes schema compliance from semantic correctness; retain application-level validation. [Official structured-output guidance](https://ai.google.dev/gemini-api/docs/structured-output).

**Acceptance criterion:** an intent claim cannot waive a deterministic failure, and evaluation includes deliberately misleading intent/context examples.

### F11 — Repair operations need stronger transaction and timeout behavior

**Priority: P1 · Effort: M · Confidence: observed implementation; failure cases not executed**

[fixer/edits.ts](../packages/visualguard/src/fixer/edits.ts) writes files sequentially. If a later write fails, `applyEdits()` throws before returning the originals map to its caller. [fixer/verify.ts](../packages/visualguard/src/fixer/verify.ts), `runCommand()`, sends `SIGTERM` to the spawned shell on timeout, without escalation or explicit process-tree termination.

**Recommendation:** prepare and validate all edits first; maintain rollback state throughout application; recover partial writes. Detect source changes since proposal generation, so a user's intervening edit is not overwritten. Add bounded process-tree shutdown with escalation and clear timeout outcomes.

**Acceptance criteria:** failure on the second file restores the first; a verification command that ignores termination cannot hang forever; cancellation leaves a recoverable patch or clean rollback.

### F12 — Documentation and supported-platform claims need reconciliation

**Priority: P2 · Effort: S–M · Confidence: observed documentation/configuration**

[PLAN.md](../PLAN.md) simultaneously describes 1.0.0 as published, 1.1.0 as pending, and an older 0.7.0 state as unpublished. Its old phase descriptions and metrics should be labelled historical. The configuration accepts Firefox/WebKit, but the inspected CI workflow installs Chromium; the plan explicitly lists Firefox/WebKit testing as unfinished.

The [GitHub Action](../action/action.yml) installs Chromium and uploads `.visualguard/runs/`, while configuration supports alternate browsers and output directories. Its JUnit output is not included in that report path.

**Recommendation:** maintain one current support/status table. Document tested versions separately from allowed peer ranges. Add focused Firefox/WebKit smoke coverage and Action inputs for browser, output path, artifact name, and JUnit upload. Replace historical release TODOs with dated notes.

**Acceptance criterion:** the documented configuration works through the Action without silently omitting configured artifacts or requiring an undocumented browser install.

## 6. Features that would make VisualGuard more useful every day

### A. Named scenarios and component checks

**Value:** high · **Effort:** L · **Sequence:** after shared comparison/identity work.

Routes alone do not cover menus, validation states, dialogs, hover/focus, checkout steps, and responsive navigation. Add named scenarios with paired setup callbacks, deterministic data setup, and multiple named checkpoints. Existing global hooks are useful escape hatches and should remain supported.

Add locator-level/component captures to reduce irrelevant page noise and make small regressions easier to review. Start with Playwright-native callbacks rather than inventing a large interaction DSL.

For Storybook, add an optional adapter that discovers stories, records story IDs as provenance, and captures after a story's interaction sequence. Storybook already supports interaction tests through play functions; use that existing behavior instead of duplicating its runner. [Official interaction-test documentation](https://storybook.js.org/docs/writing-tests/interaction-testing).

**Success measure:** users can cover a modal, error state, and mobile menu without duplicating orchestration across environments.

### B. A first-class browser/theme/locale matrix

**Value:** high · **Effort:** L.

The current schema has multiple viewports but one selected browser, locale, and color scheme per configuration. Introduce named projects or matrix dimensions after fixing baseline identity. Support a small PR matrix and a wider scheduled matrix to control runtime.

Prioritize mobile/desktop plus light/dark, then browser and locale variants. Include RTL and long translated text in examples because they reveal bugs ordinary desktop screenshots miss.

**Success measure:** a single configuration can test named variants, each with an isolated baseline and intelligible report label.

### C. Review decisions at the region or finding level

**Value:** high · **Effort:** M–L.

Current acceptance is job-level. A page can contain an intentional hero redesign and an accidental broken button simultaneously. Let reviewers accept the intended region/finding while preserving unresolved findings elsewhere.

Store reason, author, timestamp, optional expiry, and the scope of the acceptance. Show exact versus similar acceptance and the matched evidence. Provide a direct way to inspect excluded/noise-mapped areas, so a green result is explainable.

Add grouping by shared selector/component or likely source cause: one shared header regression across 20 routes should be reviewable as one group with 20 affected pages. Grouping must not implicitly accept every member.

**Success measure:** measure review time per PR and the rate at which reviewers undo an overbroad acceptance.

### D. A complete, reviewable patch artifact

**Value:** high · **Effort:** M.

Store proposals and verification evidence as durable artifacts: source revision, candidate ranking, edited file hashes, patch, model/prompt/settings, attempts, command results, before/after crops, verification run IDs, affected-route checks, and failure reasons.

Offer patch-only export for users who want to apply changes through their editor or existing agent. Add a structured context export containing selectors, computed style deltas, source candidates, screenshots, and a suggested verification command. This is useful before investing in a full editor extension or agent server.

**Success measure:** a reviewer can understand and reproduce a proposed fix from the artifact without the original terminal session.

### E. Better source localization across frameworks

**Value:** high for repair quality · **Effort:** M–L.

[fixer/locate.ts](../packages/visualguard/src/fixer/locate.ts) already combines route files, imports, changed files, text, test IDs, classes, components, and style properties. Extend it incrementally:

1. Resolve TypeScript path aliases and workspace packages using project configuration.
2. Use parser-backed imports and CSS declarations for cases where regex matching becomes ambiguous.
3. Track CSS variables/design tokens and shared stylesheet ownership.
4. Add opt-in development source metadata or source-map integration.
5. Explain candidate scores and ambiguity in the report; abstain when evidence is weak.

Prioritize adapters based on actual users. Next.js/React has the existing example and should be solid first; then add a small Vite example and a component-library example.

**Success measure:** track correct-file top-1/top-5 ranking and verified fix success on held-out cases, not just whether an edit was emitted.

### F. Deterministic data and reference provenance

**Value:** high · **Effort:** M.

Extend existing clock/mask/hook support with documented recipes for seeded data, API fixtures, authenticated roles, and application-ready selectors. Record the capture environment and deployment revision. Show redirects/login-page captures prominently.

Noise maps should remain transparent: add cases where a real defect overlaps a changing widget, test whether expanding noise to an entire DOM element suppresses useful evidence, and report the excluded area. A more permissive mask should not silently become the default answer to flakiness.

**Success measure:** unchanged-page false alarms decrease without increasing missed regressions in mixed dynamic/defect fixtures.

### G. Setup profiles and a reproducible demo

**Value:** high for adoption · **Effort:** S–M.

Build on existing `init`, `doctor`, zero-config flows, and fixture server. Offer clear setup profiles for “compare two URLs,” “baseline my app,” and “use inside Playwright.” Explain `review` versus `regression` and the default CI failure policy before users see their first green run.

Add a guided local demo that intentionally introduces a defect, displays the report, previews a fix, and verifies the result. It should work without an API key; Gemini can be an optional second step. Include authenticated-page and intentional-change walkthroughs.

**Success measure:** observe new users completing the first useful report without assistance; target a few minutes after dependencies and browsers are installed.

### H. Public extension contracts

**Value:** medium · **Effort:** M.

The [public entry point](../packages/visualguard/src/index.ts) exposes the runner and reporter contracts, but not a documented provider/fixer extension surface. The internal provider abstraction is already a good starting point.

Export supported provider types and stable schemas through deliberate package subpaths. Supply a tiny custom-provider and reporter example, contract tests, version compatibility rules, and documented failure behavior. Do this before adding a long list of built-in providers.

Defer a general diff-engine plugin until performance measurements demonstrate a need. A faster engine alone will not improve incorrect reference selection or repair verification.

### I. Sharing and history without requiring a hosted service

**Value:** medium · **Effort:** M.

The report inlines its JavaScript/CSS but references screenshots relative to the run directory. Document “portable report bundle” precisely: copying only `index.html` is insufficient. Add a one-command ZIP export with an artifact manifest and optional data redaction.

Offer a compact local history view for recurring regressions, flaky routes, accepted changes, and fix success. Keep hosting integrations optional and maintain the ability to inspect reports offline.

**Success measure:** another contributor can download, open, and understand a complete report without recreating the original environment.

## 7. Open-source adoption and maintenance

The repository has licensing, package metadata, CI, changesets, and documentation. Make contribution and support equally approachable.

| Improvement                 | Concrete deliverable                                                                                   | Why it helps                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Contributor onboarding      | `CONTRIBUTING.md` with architecture map, focused test commands, fixture authoring, and release process | Makes a first contribution feasible without reading the entire plan |
| Issue quality               | Bug template requesting versions, redacted config, expected/actual status, and a minimal fixture       | Reduces time spent reproducing screenshot problems                  |
| Public support policy       | Tested Node/Playwright/browser/platform matrix and schema compatibility policy                         | Sets expectations for an npm dependency used in CI                  |
| Privacy clarity             | Document exactly which crops, DOM text, source excerpts, and logs may leave the machine                | Helps teams choose Gemini, Ollama, or heuristics-only operation     |
| Real examples               | Small examples for baseline mode, authenticated SaaS, Playwright interactions, and components          | Demonstrates practical workflows instead of adding abstract options |
| Maintainer-friendly backlog | Small issues with expected behavior and acceptance tests                                               | Makes external contributions reviewable                             |
| Evidence of usefulness      | Opt-in case studies from two or three real repositories                                                | Measures adoption through successful use rather than feature count  |
| Release clarity             | User-facing changelog with migrations and changed defaults                                             | Prevents a dependency update from unexpectedly changing CI policy   |

Avoid creating a large documentation site before fixing contradictory content. A short, accurate workflow guide and searchable configuration reference are more immediately valuable.

## 8. Evaluation and testing plan

Expand the existing suite around decisions that could hide problems or misstate success. The following are proposed additions, not tests executed during this review.

| Layer              | Focused cases                                                                                                                           | Evidence to retain                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Policy             | Exact/similar acceptance plus new health findings; AI noise plus independent review findings; explicit missing-baseline policy          | Expected final status and exit code                              |
| Reference identity | Same viewport name with different dimensions; browser/theme/project differences; baseline-origin repair                                 | Fingerprint selection and mismatch diagnostic                    |
| Fixture parity     | Interactive state replay, early console/network capture, configured checks, AI and acceptance behavior                                  | CLI/fixture capability contract                                  |
| Repair             | No-server auto mode; failed second write; stale proposal; command timeout; desktop fix breaking mobile; later patch undoing earlier fix | Final source state and verification scope                        |
| Cache and budgets  | Mode/settings changes, diff-crop change, malformed cache, repair request, retries, cancellation                                         | Cache hit/miss reason and usage ledger                           |
| Merge              | Missing/duplicate shards, mixed commits/configurations, explicit partial merge                                                          | Complete/incomplete result                                       |
| Capture            | Dynamic widgets with nearby genuine defects, delayed fonts, RTL, theme variants, tall-page truncation                                   | Repeatability and missed-defect rate                             |
| Packaging          | Nondefault output path, artifact export, advertised browsers, minimum supported peer version                                            | Installed-package behavior                                       |
| AI quality         | Held-out intentional/content/noise/regression cases and bounded source-fix tasks                                                        | Classification, policy, calibration, and verified repair metrics |

Keep cheap deterministic tests in PR CI. Use a smaller browser smoke matrix on PRs and broader repeatability/live-provider checks on controlled schedules. Do not multiply the entire current OS × Node matrix by every browser and scenario indiscriminately.

## 9. Metrics to publish

Do not publish new accuracy, speed, or cost claims until measured. Historical numbers in the project plan are not fresh validation of this checkout.

| Metric                    | Definition                                                                         | Suggested initial goal                                                          |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Regression recall         | Detected labelled regressions / all applicable labelled regressions                | Retain the existing eval ambition of ≥90%, with sample size and uncertainty     |
| Regression precision      | Correct regression classifications / all regression classifications                | Retain the existing ambition of ≥85%; show per-category results                 |
| False-green rate          | Blocking labelled problems that produce a successful final policy outcome          | Zero for deterministic invariant tests; publish empirical rate on broader evals |
| Verified repair success   | Repairs passing target and affected-scope checks / attempted eligible repairs      | Establish a baseline first                                                      |
| Repair collateral failure | Repairs that fix the target but break a checked neighbor                           | Track separately from target success                                            |
| Capture repeatability     | Unchanged scenarios producing unexpected differences over repeated captures        | Publish by browser/environment/scenario                                         |
| AI fallback rate          | Eligible cases falling back because of budget, invalid output, or provider failure | Report alongside accuracy                                                       |
| AI work and cost          | Analysis + patch attempts, tokens, cache hits, and estimated cost                  | Show actual counts; avoid a cost target before measurement                      |
| Latency                   | Capture/diff/AI/verification p50 and p95                                           | Establish reproducible benchmark workloads                                      |
| Review effort             | Time and actions to classify a representative PR                                   | Use guided user sessions initially                                              |
| First useful report       | Time from installation prerequisites to a meaningful result                        | Validate with newcomers                                                         |

The current evaluation corpus is small and fixture-based. Add real-world reproductions contributed with permission, retain a holdout set, and avoid tuning prompts against every evaluation example.

## 10. Suggested delivery sequence

This is a planning sequence for a small maintainer team, not a measured delivery estimate. Complete each phase's acceptance criteria before broadening scope.

### Phase 1 — Repair trust and result correctness

- Fix F01 and F02.
- Preserve original comparison/reference semantics in verification (F03).
- Correct the evaluation denominator (F09).
- Reconcile release/support documentation and show verification limitations accurately.
- Add focused tests for these guarantees.

**Release outcome:** a green result and an automatically committed fix mean what users expect.

### Phase 2 — Reproducible integration

- Introduce baseline metadata/identity and migration (F04).
- Extract shared comparison/policy code and document fixture parity (F05).
- Strengthen cache keys, usage accounting, transactions, and shard completeness (F06–F08, F11).
- Add a compact browser smoke matrix and configurable Action artifact paths.

**Release outcome:** users can reproduce results across CLI, Playwright, and CI workflows.

### Phase 3 — Faster review and stronger repairs

- Add bounded PR intent context with an advisory-policy option.
- Persist complete patch/verification artifacts and support patch-only export.
- Verify affected routes/viewports and improve source localization.
- Add region-level review, grouping, and clear noise/acceptance explanations.

**Release outcome:** fewer manual investigation steps and better evidence for every proposed edit.

### Phase 4 — Broader adoption

- Add named scenarios/component checks and a small Storybook adapter.
- Expand the project matrix after baseline identity is stable.
- Publish provider contracts, contribution guides, reproducible examples, and measured case studies.
- Consider alternate diff engines or hosted collaboration only in response to demonstrated demand.

**Release outcome:** the project becomes easier to integrate into existing frontend workflows without losing its focused core.

## 11. A concrete first backlog

| Order | Issue title                                            | Definition of done                                                                                  |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1     | Do not auto-commit unverified fixes                    | No-server automatic flow stops or emits an explicitly unverified proposal; regression test included |
| 2     | Preserve health failures after exact visual acceptance | Exact and similar acceptance tests both preserve blocking health findings                           |
| 3     | Replay the original capture policy during verification | Stored reference and route-level masks/hides/waits are retained                                     |
| 4     | Keep unexpected passes in the eval denominator         | Dataset controls applicability; false negatives remain scored                                       |
| 5     | Document CLI and Playwright fixture differences        | Capability table includes AI, checks, noise handling, acceptance, and baseline creation             |
| 6     | Namespace and validate baseline environments           | Metadata migration and actionable mismatch diagnostics                                              |
| 7     | Reject incomplete or incompatible shard merges         | Shared run identity and expected-job coverage are checked                                           |
| 8     | Persist fix evidence and token usage                   | Patch artifact links original and verification runs and records attempts                            |
| 9     | Verify all affected viewports before auto-commit       | Shared-style collateral regression prevents fully verified status                                   |
| 10    | Publish a current support table and contributor guide  | Historical plan content is labelled and focused contribution commands are documented                |

## 12. What to defer

- A full hosted dashboard, accounts, billing, and organization management: these would substantially increase maintenance before the local workflow is proven.
- Many AI providers at once: establish provider contracts and comparable evals first.
- Automatic acceptance based only on model confidence: classification is not authorization, and confidence needs calibration.
- A replacement diff engine without profiling: capture and AI may dominate latency; measure each stage first.
- Framework-wide source instrumentation by default: start with explicit metadata and opt-in adapters.
- More unrelated audits: accessibility and performance are already present; improve their reporting and policy consistency before expanding into a general testing platform.

The highest-value investment is a dependable chain of evidence from visual change to source proposal to verified repair. That is where VisualGuard can become substantially more useful than a screenshot diff alone.
