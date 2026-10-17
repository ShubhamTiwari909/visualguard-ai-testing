# F04 — Approved baselines implementation plan

Status: implementation in `codex/approved-baselines-f04`, based on merged main.

## Scope

Add project-scoped named baseline sets (for example `main` or `release-1`) with immutable, numbered versions. Each version records all check identities, rendering identities, content hashes, source run/revision, exact review decisions, promoting actor, reason, policy version, and parent version. Promotion uses compare-and-swap against the expected current version. Restore copies an older snapshot into a new version; history is never rewritten.

The dashboard gains a Baselines page with project/set selection, paginated history, source evidence links, candidate promotion, and restore. Viewers can inspect; maintainers can promote/restore. Upload credentials can download only approved references for their own project, without gaining dashboard browsing or promotion rights.

## Promotion policy v1

- Require complete, nonempty evidence with a source revision and recorded rendering identity for every check. Reject errors, truncated/unstable captures, health failures, and independent regression findings even when visual review approved the pixels.
- Require current F03 visual approval for every exact candidate check. Revalidate evidence scope and active reviewer authority within the promotion transaction. New evidence cannot inherit a previous run's decision.
- A maintainer confirms the source revision has landed on the set's target branch, recording the landed revision and a reason. This is an explicit operator attestation; F04 does not verify Git ancestry or GitHub merge status. Automatic repository/release enforcement belongs to later features.
- Existing compatible checks must have compared against the current approved image hash. Reject evidence based on a stale reference. Check identity includes the engine job, route, viewport, and complete rendering identity (including browser/context options); variants cannot silently replace each other.
- Changed coverage (added/removed identities) requires an explicit coverage-change reason. No silent removal. New sets are explicitly initialized by the first reviewed snapshot.
- Serialize project deletion, run deletion, review changes, account/membership revocation, and promotions using transactional state guards/CAS. Retain source runs referenced by any baseline version so artifact cleanup cannot invalidate history. Explicit project deletion removes its evidence and baseline state.
- Require SQLite, PostgreSQL, or a transaction-capable MongoDB replica set for mutations. No partial fallback writes.

## Reference consumption

Provide `visualguard dashboard baseline pull <set> --project <id> --out <new-directory> [--version N] [--server URL]`. A local database or a project upload token for a remote dashboard can supply an immutable snapshot. Download/check hashes before atomically installing a new directory; refuse overwriting existing files. Keep payloads bounded and use chunked artifact reads.

Export standard PNG/DOM/health/metadata sidecars, plus version/check provenance in metadata. Existing CLI baseline mode and Playwright fixtures consume those files through the existing rendering-identity check, verify approved content hashes, reject local baseline updates, and attach selected-reference provenance to run evidence. Offline baselines remain usable without a database, server, or token. Approved snapshots remain usable offline after pull.

## Validation and delivery

Focused tests cover authorization, exact reviews and withdrawals, independent failures, stale/equal-version races, rendering/coverage changes, restore lineage, source retention/deletion races, scoped HTTP access, export integrity, and engine compatibility/provenance. Build the dashboard and exercise real browser flows at desktop/mobile widths. Include a from-scratch local guide and a changeset. Formatting, lint, and type checking remain deferred by AGENTS.md; do not report them as passed.

Commit this plan first. Keep implementation, docs, and focused tests in one following feature commit. Push the new branch and open a reviewable PR; merging requires the user's subsequent request.
