# visualguard

## 1.0.0

### Major Changes

- First release

## 0.7.0

### Minor Changes

- Add `visualguard/playwright`: a `visualguard` fixture for Playwright Test (`await visualguard.check(page)`) that compares the page with production or a baseline, explains differences, attaches screenshots and fails the test per `failOn`. Add `visualguard auth <env>` to save a logged-in session as storageState, `reporters` in the config for custom reporters, and a composite GitHub Action in `action/`.

## 0.6.0

### Minor Changes

- Add `visualguard fix --auto` (fixes on a new branch in a separate git worktree with its own dev server, commits verified fixes; `--pr` pushes and opens a pull request via `gh` or the REST API; `--in-place` for CI), `visualguard watch` (re-tests the routes affected by each saved file against the local dev server), baseline mode (`mode: "baseline"`, `test --update-baselines`, committed screenshots in `visualguard/baselines`), and a "Generate fix" button in the served report that shows the diff and applies and verifies it on confirmation.

## 0.5.0

### Minor Changes

- Add `visualguard fix`: ranks the likely source files, proposes an edit (restoring production's utility classes or CSS values without AI, or search/replace edits from the AI provider after asking for consent), shows the diff and asks before applying, then runs `fix.verify.commands`, re-captures the page on the local dev server and keeps the change only if it matches production; otherwise it reverts and retries. Needs `fix.enabled: true` and a clean git tree. Also: lab/oklch colours are shown as hex, layout-shift detection ignores content moving inside fixed-height boxes, and an `examples/nextjs` app demonstrates the loop.

## 0.4.0

### Minor Changes

- CI and GitHub integration: `visualguard accept` records intentional changes in `visualguard.accepted.json` (matching screenshots then pass as "accepted"), with an "Accept change" button in the served report; `visualguard comment` posts or updates one sticky PR comment (finds the PR from the commit for `deployment_status` events); a Markdown job summary is written to `$GITHUB_STEP_SUMMARY`; `--junit <path>` writes JUnit XML; `report.webhook` posts a JSON summary; `init --workflow` writes a GitHub Actions workflow for the project's package manager.

## 0.3.0

### Minor Changes

- Add AI analysis. Gemini (`@google/genai`, structured output) and Ollama (local, JSON-schema `format`) providers classify each changed page as regression, intentional, content or noise, explain it and suggest a fix. The AI can raise or lower a heuristic "review" but never downgrades a hard failure; answers are cached, `ai.maxCallsPerRun` caps calls, and AI errors fall back to heuristics. New `visualguard analyze` re-runs AI on an existing run; `test` gains `--provider`, `--model` and `--no-ai`; `doctor` checks the model. New heuristics flag low text contrast and cut-off text. Adds an eval runner (`pnpm eval`) over 41 labelled fixture cases.

## 0.2.0

### Minor Changes

- Explain differences without AI: every capture now records a compact DOM snapshot; changed regions are mapped to the elements under them and to style, text, position and added/removed-element changes, described in plain language ("Alignment changed: align-items center → flex-start on div.actions"). Layout shifts are detected and reported as one root cause, removed controls and new overlaps are regressions, and tiny changes with no DOM change are treated as rendering noise. Captures are steadier: scrollbars are hidden through CDP and a few re-rasterised pixels no longer count as a moving page.
- 18bcadb: Add the HTML report: every run writes a self-contained `index.html` (works from `file://`, CI artifacts and any static host) with a job list, side-by-side / slider / onion-skin / diff views, region overlays and crops, findings, page health, keyboard shortcuts and a dark theme. `visualguard report` serves the latest run (or `--run <id>`) on localhost with a token-protected action API; `--no-serve` prints the file path.

## 0.1.0

### Minor Changes

- 3bd87f8: Add the capture and diff pipeline: `visualguard test` captures production and staging with Playwright, stabilises pages (animations, fonts, lazy content, network, clock), diffs them with pixelmatch, groups changes into regions, and writes a versioned `manifest.json`. Includes the URL resolver (`--production`, `--staging`, `--route`, `--only`, `--viewport`, `--list`), terminal and JSON reporters, and exit codes.
- Add `visualguard init` (interactive or `--yes`), `visualguard doctor`, zero-config runs (`visualguard <url>` scans one site and saves snapshots; `visualguard <url> <url>` compares two), route discovery from Next.js `app/` and `pages/`, `sitemap.xml` and crawling, and health findings (HTTP errors, broken images, horizontal overflow) that raise a job's status.
