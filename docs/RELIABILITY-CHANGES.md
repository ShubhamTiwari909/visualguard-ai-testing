# Reliability changes: F01–F12

Implemented from the [project analysis](PROJECT-ANALYSIS-AND-ROADMAP.md), 9 October 2026. The findings in that report describe the original checkout; this document records the new behavior and migration requirements.

| Finding | Change                                                                                                                                                                                     | User-visible result                                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| F01     | Automatic fixing requires a visual verification server and only selects `fixed` outcomes for commits                                                                                       | `fix --auto` stops before branch creation when visual verification is unavailable                                                           |
| F02     | Independent health/check findings block both exact and similar visual acceptance                                                                                                           | An accepted screenshot cannot waive a new request, accessibility, or performance failure/review                                             |
| F03     | Jobs retain capture policy; repair uses saved reference images and DOM/health; a final full original-run check verifies the accumulated batch                                              | Production drift cannot change the repair target; route masks/waits/hides and viewport settings replay; collateral changes revert the batch |
| F04     | Baselines store rendering metadata; fixture identities include relative test file, project, browser and viewport                                                                           | Incompatible platform/theme/viewport settings produce an actionable diagnostic; legacy snapshots require explicit migration                 |
| F05     | Shared classification/policy, fixture AI/cache/acceptance/checks/noise support, opt-in early event instrumentation, `referenceSetup` and missing-baseline policy                           | Playwright users can compare the same interactive state and use the same result policy                                                      |
| F06     | Cache hashes the complete generated request, image content, schema, prompt, settings and selector allowlist; cached records are validated and expire                                       | Mode/settings/context changes invalidate cache; model revision is retained when returned                                                    |
| F07     | AI ledger tracks generation/repair/network attempts and tokens; patch invocations inherit saved run usage; deadlines/cancellation and limits are supported                                 | Reports and fix artifacts expose actual work; subsequent requests stop when the known budget is exhausted                                   |
| F08     | Shards record shared execution/config/revision identity and expected jobs; merging checks compatibility, duplicate shards/jobs and completeness                                            | Partial merges require `--allow-partial`, have a visible incomplete banner and return nonzero from the CLI                                  |
| F09     | Dataset defines applicable cases; unexpected passes and missing captures remain scored; hybrid policy and model-only metrics are separate; confidence bins and threshold gates are emitted | Detection misses cannot disappear from recall; PR CI runs deterministic eval gates and weekly/manual workflows can evaluate Gemini          |
| F10     | Bounded change-intent configuration, untrusted-context prompt rules, advisory mode, health-review preservation and supplied-file patch validation                                          | Claimed intent cannot downgrade deterministic failures; stricter teams can keep all AI status changes advisory                              |
| F11     | Multi-file rollback, stale-proposal checks, report proposal expiry/mutation lock, and bounded process-tree termination                                                                     | Failed/expired edits and hung verification commands produce recoverable outcomes                                                            |
| F12     | Current support guide, fixture capability table, baseline/shard migration instructions, configurable Action browser/output/artifact/JUnit paths, and Firefox/WebKit smoke CI               | Installation, CI artifacts and documented behavior match the implementation                                                                 |

## Migration

### Baselines

Missing baselines now fail by default. Create/update them explicitly:

```sh
npx visualguard test --update-baselines
# Inside Playwright tests:
npx playwright test --update-snapshots
```

For intentionally permissive local onboarding, set `baseline.missing: "create"`. In the CLI this permits an uninitialised reference result; screenshots are only persisted through an explicit update request. The Playwright fixture creates its baseline in this mode. Keep the default `error` in CI.

New baselines include `.meta.json`, `.dom.json`, `.health.json` and PNG files. Commit metadata and sidecars together. Existing CLI baselines can be read with `baseline.legacy: "allow"`; regenerate them to acquire metadata, then remove that override. Fixture baseline IDs have changed to include project/rendering identity, so regenerate fixture baselines explicitly. Metadata mismatches require using the original rendering settings or regeneration, even when `legacy: "allow"` is configured.

No persisted cookies, headers or source contents are added to baseline metadata. Verification still uses the current project's hooks and authentication settings, because functions and credentials are not serialised. Keep those callbacks/settings consistent with the original capture.

### Automatic fixing and verification

Set `fix.verify.server` before using `fix --auto`. Interactive application without a server remains labelled `unverified`. Source proposals are checked against the exact file contents read during generation; regenerate after an intervening edit.

Verification uses saved artifacts from the selected run. After individual repairs, the complete original job set is checked: repaired routes must match their saved expected look at every captured viewport (accepted variants retain their accepted staging look); other routes must retain their pre-fix staging look. This conservative scope can reject an intentional collateral change. Recapture/review that change in a new run. Routes/viewports absent from the original run cannot be verified; run the complete intended scope before automatic fixing.

`fix-results.json` records cumulative known AI usage, batch outcomes and final verification directories (stored under the source run so retention keeps evidence together). `fixes/` records per-attempt proposals and verification results. These artifacts contain source edits and should be shared with the same care as code reviews.

### Sharding

Use one unique group value for each execution, shared by all its shards:

```sh
npx visualguard test --shard 1/2 --run-group my-ci-execution-123
npx visualguard test --shard 2/2 --run-group my-ci-execution-123
npx visualguard merge downloaded-artifacts
```

GitHub Actions uses its run ID and attempt automatically. Other CI systems can set `VISUALGUARD_RUN_GROUP`. Legacy runs without provenance must be recaptured. `merge --allow-partial` creates an explicitly incomplete diagnostic report and returns a failing exit code.

### AI policy and budgets

```ts
ai: {
  provider: "gemini",
  model: "<pinned model ID available to your account>",
  advisory: true,
  maxCallsPerRun: 30,          // job analyses
  maxGenerationAttempts: 60, // includes JSON repair generations
  maxNetworkAttempts: 120,   // includes provider retries/fallback settings
  maxTokens: 200_000,
  timeoutMs: 120_000,
  cacheTTLHours: 24,
  intent: {
    title: "Update pricing copy",
    description: "The layout and checkout flow should stay the same.",
    changedFiles: ["app/pricing/page.tsx"],
  },
}
```

The default Gemini model remains a moving alias. Pin a model for reproducible CI; cached records expire after 24 hours by default. A returned model revision is displayed when available. Confidence is self-reported and does not imply a calibrated probability.

The ledger stops future requests once known token usage exceeds the limit; a completed or concurrently in-flight generation can take usage past the limit. Providers do not return billable usage for every failed request, so this is best-effort usage accounting, not an exact invoice. Built-in providers count internal retries. Custom providers without budget support can only be counted at their public generation boundary.

Analysis and a later fix share accumulated token/attempt limits through the saved run/fix usage. Each invocation has its own deadline. `RunOptions.signal` and `FixOptions.signal` support programmatic cancellation. The fixture shares an AI session within each test, rather than across separate Playwright worker processes.

## Playwright fixture capability contract

| Capability                                      | CLI                                                | Fixture                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DOM classification and independent-check policy | Shared implementation                              | Shared implementation                                                                                                     |
| AI, request cache, analysis budgets, acceptance | Supported                                          | Supported; session per test                                                                                               |
| Second-capture noise map                        | Live reference/current in baseline mode            | Fresh production reference when available; no automatic replay of a test-owned current page                               |
| Accessibility/performance                       | Capture pipeline                                   | Enabled configured checks at check time; performance preservation before navigation on provided page                      |
| Console/request events                          | Attached before navigation                         | Set `visualguardOptions.collectHealth: true` for the provided `page`; externally created pages cannot recover past events |
| Clock control                                   | Installed before navigation and paused for capture | Existing test clock stays test-owned; CSS/media/stability handling applies                                                |
| Interactive reference state                     | Global hooks                                       | Per-check `referenceSetup` plus global hooks                                                                              |
| Missing baseline                                | Error by default                                   | Error by default; explicit update or `missing: "create"`                                                                  |
| Output                                          | Run manifest and reporters                         | Test attachments and `result.json`                                                                                        |

```ts
import { test } from "visualguard/playwright";

test.use({ visualguardOptions: { collectHealth: true } });
test("open cart", async ({ page, visualguard }) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: "Cart" }).click();
  await visualguard.check(page, {
    name: "cart-open",
    referenceSetup: async (reference) => {
      await reference.getByRole("button", { name: "Cart" }).click();
    },
  });
});
```

## Supported and validated environments

| Area           | Policy                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node           | Declared minimum 22.12.0; CI matrix covers Node 22 and 24                                                                        |
| Playwright     | Declared optional peer range ≥1.45.0; full repository tests use the pinned development version from package.json                 |
| Chromium       | Full repository test matrix on Linux/macOS/Windows                                                                               |
| Firefox/WebKit | Focused Linux CI smoke tests; this is narrower than the Chromium suite                                                           |
| Baselines      | Browser/platform/project/settings compatibility checked; regenerate on mismatch                                                  |
| Manifests      | Schema version 1 with additive provenance/policy/usage fields; older reports remain readable, older shard runs are not mergeable |
| Report sharing | Upload the entire run directory; HTML inlines application JS/CSS but references image files                                      |

CI workflow coverage describes configured checks, not a claim that every remote workflow has already passed. Live Gemini quality, the declared minimum Playwright version, and Firefox/WebKit behavior beyond smoke coverage require their own measured runs.

## Validation recorded on 9 October 2026

| Check                                               | Result                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Full repository suite                               | 202 passed; 1 opt-in Next.js integration test skipped                                                      |
| Type checking, ESLint, Prettier and diff whitespace | Passed                                                                                                     |
| Package build and installation smoke test           | Passed                                                                                                     |
| Local Firefox and WebKit capture smoke tests        | Passed for each browser                                                                                    |
| Heuristic evaluation                                | 43 scored cases; regression precision 100%; regression recall 64.7%; false-green rate 0%; capture errors 0 |
| Live Gemini evaluation                              | Not run; the scheduled/manual workflow supports a bounded run with credentials                             |

The heuristic recall result exposes six regression cases currently classified for review rather than as regressions; these remain in the denominator. It does not establish model quality or confidence calibration. The evaluation record is saved in [the measured result](../evals/results/2026-10-09T12-11-41-419Z-none.json).
