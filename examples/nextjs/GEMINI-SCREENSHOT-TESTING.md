# Run VisualGuard Screenshot Tests with Gemini

This guide runs the example Next.js application, compares a good production build with a
staging/dev build, sends changed regions to Gemini, and opens the generated HTML report.

## Requirements

- Node.js `>= 22.12`
- pnpm 9
- A Gemini API key from <https://aistudio.google.com/app/apikey>
- Chromium installed for Playwright

## 1. Configure Gemini

Create `.env.local` in this directory:

```env
GEMINI_API_KEY=your_actual_gemini_api_key
```

The key must not be added to `visualguard.config.ts` or committed to Git.

In `visualguard.config.ts`, enable Gemini:

```ts
ai: {
  provider: "gemini",
  model: "gemini-flash-latest",
},
```

The existing example configuration is compare mode: it compares the production URL on port
`3101` with the staging URL on port `3100`. Do not pass `--update-baselines` for this flow;
that flag is only for `mode: "baseline"`.

## 2. Install dependencies and build VisualGuard

Run these commands from the repository root:

```bash
cd "/Users/shubham/Desktop/Repos/NEXT JS/visualguard"
pnpm install
pnpm --filter visualguard exec playwright install chromium
pnpm build
```

## 3. Start the production server

In Terminal 1:

```bash
cd "/Users/shubham/Desktop/Repos/NEXT JS/visualguard/examples/nextjs"
pnpm build
pnpm start
```

Leave this server running at `http://localhost:3101`.

## 4. Seed and start staging

In Terminal 2:

```bash
cd "/Users/shubham/Desktop/Repos/NEXT JS/visualguard/examples/nextjs"
pnpm seed
pnpm dev
```

Leave this server running at `http://localhost:3100`.

The seed command introduces example visual changes such as alignment, color, and spacing
regressions in the staging source.

## 5. Check the planned routes

In Terminal 3:

```bash
cd "/Users/shubham/Desktop/Repos/NEXT JS/visualguard/examples/nextjs"
node ../../packages/visualguard/dist/cli.js test --provider gemini --list
```

`--list` only prints the resolved routes; it does not capture pages or call Gemini.

## 6. Run the screenshot comparison with Gemini

```bash
node ../../packages/visualguard/dist/cli.js test --provider gemini
```

VisualGuard captures both servers, computes the pixel and DOM differences, runs deterministic
health/heuristic checks, and sends eligible changed regions to Gemini. Gemini can classify a
change as `regression`, `intentional`, `content`, or `noise`, and can provide a likely cause and
suggested fix.

Hard failures detected by VisualGuard, such as broken images, missing controls, overflow, and
low contrast, cannot be downgraded by Gemini.

## 7. Open the generated HTML report

```bash
node ../../packages/visualguard/dist/cli.js report
```

The report is generated locally by VisualGuard, not by Gemini. It includes:

- production and staging screenshots
- pixel diff regions
- DOM and computed-style changes
- heuristic findings
- Gemini classification, confidence, explanation, likely cause, and suggested fix when available

Run data is stored under:

```text
.visualguard/runs/
```

Each run contains an `index.html` report and a manifest with the analysis data.

## 8. Ask VisualGuard to propose and verify fixes

Because `pnpm seed` modifies the working tree, use `--allow-dirty` for this demo:

```bash
node ../../packages/visualguard/dist/cli.js fix --include-review --allow-dirty
```

VisualGuard locates the relevant source, proposes a change, asks for confirmation, applies it,
re-captures staging, and keeps the change only when visual verification succeeds.

Review the result:

```bash
git diff
pnpm exec tsc --noEmit
node ../../packages/visualguard/dist/cli.js test --provider gemini
```

Restore the seeded example changes when finished:

```bash
pnpm unseed
```

## One-command key alternative

Instead of `.env.local`, a key can be supplied for a single command:

```bash
GEMINI_API_KEY="your_actual_gemini_api_key" \
node ../../packages/visualguard/dist/cli.js test --provider gemini
```

Avoid this form on shared machines because shell history or process inspection may expose the key.
