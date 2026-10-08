# VisualGuard example: Next.js + Tailwind

A small Next.js app for trying VisualGuard end to end, including `visualguard fix`.

```bash
pnpm install                     # from the repository root
cd examples/nextjs

pnpm build && pnpm start &       # "production" on :3101, from good code
pnpm seed                        # add three regressions to the source
pnpm dev &                       # "staging" on :3100

npx visualguard test             # finds the alignment, colour and spacing changes
npx visualguard report           # look at them
npx visualguard fix --include-review   # restores production's classes and verifies on :3100

git diff                         # review what changed
pnpm unseed                      # or undo the seeded regressions
```

The regressions are Tailwind class changes, so `fix` repairs them without AI: it restores the
classes production renders, re-captures each page on the dev server and checks it matches
production. Set `ai.provider` to fix changes that need judgment.
