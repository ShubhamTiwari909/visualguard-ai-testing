# VisualGuard 3.1.0 release validation

Validated on October 16, 2026, using macOS, Node.js 22.14.0, and pnpm 9.0.0.
This cleanup starts from merged `main` commit `c05d71d` and includes the shared
dashboard, collaborative review inbox, and editable project and run names.

## Result

Local release checks passed. Merge the cleanup branch and require its GitHub CI
checks to pass before publishing. No npm publication or cloud deployment was
performed during validation.

| Check                                                                                            | Result                                                                                 |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pnpm format`, then `pnpm format:check`                                                          | Passed                                                                                 |
| `pnpm lint`                                                                                      | Passed                                                                                 |
| `pnpm typecheck`                                                                                 | Passed for the CLI, report app, and platform                                           |
| `pnpm build`                                                                                     | Passed, including declarations and bundled dashboard assets                            |
| `pnpm platform:build`                                                                            | Passed                                                                                 |
| `pnpm platform:test` with PostgreSQL and MongoDB URLs configured                                 | 109 tests passed; includes SQLite contracts                                            |
| `VG_DETERMINISM_RUNS=10 pnpm test`                                                               | 209 tests passed; the opt-in Next.js test was skipped here and passed separately below |
| `VG_SMOKE_BROWSER=firefox pnpm --filter visualguard exec vitest run test/browser-smoke.test.ts`  | Passed                                                                                 |
| `VG_SMOKE_BROWSER=webkit pnpm --filter visualguard exec vitest run test/browser-smoke.test.ts`   | Passed                                                                                 |
| `VG_E2E_NEXT=1 pnpm --filter visualguard exec vitest run test/nextjs-example.test.ts`            | Passed                                                                                 |
| `node evals/run.mjs --provider none --min-regression-recall 0.6 --min-regression-precision 0.85` | Passed: regression recall 64.7%, precision 100%, false-green rate 0%, error cases 0    |
| `pnpm platform:test:package`                                                                     | Passed in a fresh consumer installation                                                |
| `node scripts/pack-smoke.mjs`                                                                    | Passed in a fresh consumer installation; CLI reports 3.1.0                             |

The packaged dashboard smoke covers the core and dashboard public APIs, local
startup, UI assets, direct `/reviews` navigation, importing and uploading evidence,
backup/restore, CLI commands, and Cloud Run/Vercel scaffold generation. Cloud Run
and Vercel deployments and paid AI providers were not exercised. The full GitHub
CI operating-system and Node.js matrix remains the remote release check.

Database tests used disposable local PostgreSQL and MongoDB databases. Both were
removed after validation; existing application databases and services were retained.

The complete 43-case heuristic evaluation is saved in
[`evals/results/2026-10-16T06-07-19-167Z-none.json`](../evals/results/2026-10-16T06-07-19-167Z-none.json).

## Cleanup included

- Apply the deferred repository formatting.
- Include platform type checking in the workspace `typecheck` command.
- Allow the CLI TypeScript project to include its shared dashboard source imports.
- Type the dashboard runtime environment explicitly and fix typed test fixtures.
- Serve the dashboard HTML for direct `/reviews` requests, with runtime and
  installed-package regression coverage.

## Version preparation

The public npm registry reported 3.0.0 as the latest release and no published
3.1.0. The repository already declared 3.1.0 while retaining eleven unconsumed
changesets; applying them directly would have produced 3.2.0.

To prepare the intended release, the package version was temporarily restored to
the published 3.0.0 baseline before running `pnpm version-packages`. Changesets
then produced the 3.1.0 changelog and consumed those eleven changesets. The final
package version remains 3.1.0. Future features should add new changesets normally.

The existing release workflow runs on pushes to `main`. With the release
changesets consumed, it can publish the unpublished 3.1.0 package automatically.
Merging this release preparation therefore participates in the publication flow.
