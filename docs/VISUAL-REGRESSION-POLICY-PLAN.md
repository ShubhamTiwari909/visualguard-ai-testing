# F07 — Visual regression policy and exact-revision GitHub checks

## Scope

F05 named journeys is deferred. Use existing screenshot check IDs, rendering profiles, F03 decisions, F04 approved references, and F06 validated complete uploads. Keep the offline engine unchanged.

## Delivery

- Versioned, reasoned project policy saved with compare-and-swap: required check IDs, approved baseline set, evidence age, environment, changed-check approval, informative/required mode, optional GitHub repository. Preserve policy history and actor attribution in persistent platform state.
- Fresh assessment of an explicit candidate revision: complete merged evidence, exact source revision, required coverage, compatible current approved baseline identity and reference bytes, reliable screenshot pairs, independent failures, active exact-evidence visual decisions. No policy or missing evidence stays pending. Never use AI confidence, local accepts, or stale approvals to waive independent failures.
- Maintainer exceptions are explicit, revision/check scoped, reasoned and expiring; only the visual approval requirement may be waived. Structural coverage, capture, source revision and reference failures cannot be waived.
- Dashboard policy editor, recent run assessment, clear reasons and manual GitHub reconciliation. Project viewers can inspect; maintainers change policy and exceptions. Upload credentials may only assess/reconcile their own project, never edit policies or reviews.
- GitHub adapter verifies the live PR head and base branch, publishes an exact-commit Check Run, retries transient requests, and reconciles an existing external ID after ambiguous delivery. Informative mode reports neutral conclusions; required mode reports success/failure only for current assessments. Failures never invent success. Credentials remain server-side and repositories must be explicitly allowed by the operator.
- Signed pull-request webhooks and an explicit reconciliation command provide delivery recovery. Reconcile on demand after review/baseline/policy changes; periodically reconcile tracked PRs to catch missed events, permission revocation and expired evidence/exceptions. Serverless operators schedule the reconciliation command; no in-process timer is assumed.

## Validation

Focused behavior tests cover exact revisions, missing/sharded evidence, health/capture failures, unchanged/changed screenshots, reference lineage and identity, reviewer revocation, policy conflicts, exceptions, HTTP roles/CSRF/credential scope, GitHub retries/idempotence/head changes and persistence. A feature UI build may be used. Formatting, lint and type checks were initially deferred under AGENTS.md; the user subsequently authorized them for PR #52 review and merge.

## Rollout

Default to informative mode. Local assessment requires no new environment variables and uses the existing local SQLite data directory. Optional GitHub delivery needs a Checks-write/Pull-requests-read credential, repository allowlist, public dashboard origin and webhook secret. Document local setup, repeatable smoke checks, CI upload binding, webhook configuration and scheduled reconciliation. No automatic merging, branch-protection mutation, hosted browser scheduler or named journey catalog.
