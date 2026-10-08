# VisualGuard

AI visual regression agent, shipped as an npm CLI. VisualGuard compares production against staging,
explains every visual difference (with or without AI), and can fix regressions and verify the fix.

```bash
npm install -D visualguard playwright
npx playwright install chromium
npx visualguard init
npx visualguard test
```

The package documentation is in [packages/visualguard/README.md](packages/visualguard/README.md).
The design and roadmap are in [PLAN.md](PLAN.md), which starts with the implementation status.

## Repository layout

| Path                   | What it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `packages/visualguard` | The published npm package: CLI, programmatic API, report app, Playwright fixture |
| `action/`              | Composite GitHub Action                                                          |
| `examples/nextjs`      | Next.js + Tailwind app with seedable regressions for trying `fix`                |
| `fixtures/site`        | Static pages with known differences, used by tests and evals                     |
| `evals/`               | Labelled cases and the runner for measuring classification quality               |
| `scripts/`             | Pack smoke test and the fixture server                                           |

## Development

Requires Node ≥ 22.12 and pnpm 9.

```bash
pnpm install
pnpm --filter visualguard exec playwright install chromium
pnpm build
pnpm test                 # unit, integration, report (browser) and fixer tests
pnpm lint && pnpm typecheck
pnpm test:pack            # pack the CLI, install it in a temp project, run it via npx
pnpm eval                 # classification evals (heuristics; -- --provider gemini for AI)
VG_E2E_NEXT=1 pnpm --filter visualguard exec vitest run test/nextjs-example.test.ts
node scripts/serve-fixtures.mjs   # fixture site on :4100 (production) and :4101 (staging)
```

Releases use changesets (`pnpm changeset`); the Release workflow publishes with npm trusted
publishing once the package is set up on npm.
