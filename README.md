# VisualGuard

AI visual regression agent, shipped as an npm CLI. VisualGuard compares production against staging,
explains every visual difference, and can fix regressions if you opt in.

> **Status:** pre-release. See [PLAN.md](PLAN.md) for the design and roadmap.

## Repository layout

| Path                   | What it is                                         |
| ---------------------- | -------------------------------------------------- |
| `packages/visualguard` | The published npm package (CLI + programmatic API) |
| `fixtures/site`        | Static pages with known differences, used in tests |
| `examples/`            | Example apps that use VisualGuard                  |
| `evals/`               | Labelled cases for measuring AI accuracy           |

## Development

Requires Node ≥ 22.12 and pnpm 9.

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm test:pack   # pack the CLI, install it in a temp project, run it via npx
```
