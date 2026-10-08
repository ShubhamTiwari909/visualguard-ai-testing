# VisualGuard

Visual regression testing for websites, as a CLI. VisualGuard captures the same pages on production
and staging with Playwright, diffs them pixel by pixel, and tells you what changed and where.

```bash
npm install -D visualguard playwright
npx playwright install chromium
npx visualguard init
npx visualguard test
```

```
  ✓  /             desktop   PASS
  ✓  /pricing      desktop   PASS
  ⚠  /text-change  desktop   REVIEW      0.13% changed · 1 region
  ✖  /checkout     mobile    REGRESSION  Horizontal overflow: page is 480px wide at a 390px viewport

  2 passed · 1 review · 1 regression · 0 errors   (6.4s)
```

## Try it without a config

```bash
# Scan one site: finds routes (sitemap.xml, then links), captures them, checks health,
# and saves snapshots. The next scan compares against them.
npx visualguard https://example.com

# Compare two sites (routes are discovered from the first one)
npx visualguard https://example.com https://staging.example.com

# Compare one page
npx visualguard https://example.com/pricing https://staging.example.com/pricing
```

## Commands

| Command                       | What it does                                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| `visualguard <url> [url2]`    | Zero-config scan of one site, or comparison of two                    |
| `visualguard init`            | Interactive setup; writes `visualguard.config.ts`                     |
| `visualguard doctor`          | Checks Node, Playwright, the browser, the config and the URLs         |
| `visualguard test`            | Captures production and staging, diffs every route, reports           |
| `visualguard analyze`         | Re-runs AI analysis on a run (`--provider`, `--model`, `--no-cache`)  |
| `visualguard accept [routes]` | Accepts changes as intentional (`--all`, `--viewport`, `--note`)      |
| `visualguard comment`         | Posts or updates the sticky PR comment (CI; `--link`, `--dry-run`)    |
| `visualguard fix [routes]`    | Proposes, applies and visually verifies fixes (asks first)            |
| `visualguard watch [routes]`  | Re-tests changed routes against your dev server on save               |
| `visualguard report`          | Opens the HTML report for the latest run (`--run <id>`, `--no-serve`) |

Useful `test` flags:

| Flag                                   | Meaning                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `--production <url>` `--staging <url>` | Override the base URLs, e.g. `--staging http://localhost:3000` |
| `--route <path>`                       | Test only this path (repeatable)                               |
| `--only <glob>`                        | Filter routes, e.g. `--only "/blog/**"`                        |
| `--viewport <name>`                    | Run one configured viewport                                    |
| `--list`                               | Print the resolved URL pairs without opening a browser         |
| `--fail-on <regression\|review\|any>`  | What makes the exit code non-zero (default `regression`)       |
| `--ci` `--json` `--debug`              | Plain output · manifest JSON on stdout · Playwright traces     |

Exit codes: `0` ok, `1` failures at or above `--fail-on` (or capture errors), `2` config or usage
error, `3` environment error (browser missing, URL unreachable).

## Configuration

```ts
// visualguard.config.ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: "https://staging.example.com", // VISUALGUARD_STAGING_URL overrides this
  },
  routes: [
    "/",
    "/pricing",
    { path: "/checkout", waitFor: "[data-testid=order-summary]" },
    { path: "/blog/[slug]", params: [{ slug: "hello-world" }] },
    { path: "/pricing", staging: "/plans" }, // renamed on staging
  ],
  // or discover them: routes: { discover: ["nextjs", "sitemap"], exclude: ["/admin/**"] },
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
  stabilize: {
    freezeTime: "2026-01-01T00:00:00Z",
    hide: [".cookie-banner"],
    mask: ["[data-testid=live-price]"], // mask fixed-size containers
  },
  diff: { threshold: 0.1, maxDiffPixels: 20 },
});
```

A page URL is the base URL plus the route: `https://example.com/app` + `/pricing` becomes
`https://example.com/app/pricing`. Query params on a base URL are added to every page. Settings
are resolved in this order: CLI flags, then environment variables
(`VISUALGUARD_PRODUCTION_URL`, `VISUALGUARD_STAGING_URL`), then the config file.

## Explanations, with or without AI

Every capture records a compact DOM snapshot. Changed regions are mapped to the elements under
them and to what changed: computed styles, text, position, added or removed elements. That gives a
plain-language reason for each difference without any AI:

```
⚠  /alignment   REVIEW      Alignment changed: align-items center → flex-start on div.actions
✖  /hidden      REGRESSION  [data-testid="cta"] “Start free trial” is missing on staging
✖  /contrast    REGRESSION  Low contrast: .hero > p is 1.2:1 (was 7.6:1)
```

Removed controls, new overlaps, low contrast, cut-off text, broken images, horizontal overflow and
HTTP errors are regressions. Layout shifts are reported once ("New element: div.banner; content
below y=95 moved 72px down") instead of as a page full of red. Tiny changes with no DOM change are
treated as rendering noise.

Add an AI provider to classify the rest (regression, intentional, content or noise) and suggest
fixes:

```ts
ai: { provider: "gemini" },            // reads GEMINI_API_KEY; model defaults to gemini-flash-latest
ai: { provider: "ollama", model: "qwen2.5vl" },   // local and private; OLLAMA_HOST
```

The model sees crops of each changed region and the DOM changes, never your source code. It can
raise or lower a heuristic "review", but it can never downgrade a hard failure. Answers are cached
by their inputs, `ai.maxCallsPerRun` caps spending, and any AI error falls back to the heuristics.
`npx visualguard analyze` re-runs the AI on the latest run without capturing again.

On Google's free (unpaid) tier, submitted content may be used to improve Google products; that
includes screenshots of unreleased pages. Use Ollama or a paid key for confidential work.

## Fixing regressions

```ts
fix: {
  enabled: true,                       // off by default
  include: ["app/**", "components/**"],
  verify: {
    server: { command: "pnpm dev", url: "http://localhost:3000" },
    commands: ["pnpm exec tsc --noEmit"],
  },
},
```

`npx visualguard fix` (add `--include-review` to also try changes marked review) works through
the regressions in the latest run:

1. **Find the source.** Files are ranked by what changed since `fix.compareRef`, the route's
   page and its imports, test ids, class lists and visible text.
2. **Propose an edit.** Common cases need no AI: if an element's utility classes changed,
   production's classes are restored; if a CSS declaration changed, production's value is put
   back. Otherwise the AI proposes search/replace edits, after asking once before any source
   code is sent.
3. **Show the diff and ask** before changing anything.
4. **Verify.** Your commands run, the page is captured again on the local dev server, and it must
   match production. If it doesn't, the edit is reverted and retried with the reason, up to
   `fix.maxAttempts`.

`fix` needs a git repository with a clean working tree (or `--allow-dirty`), and never touches
lockfiles, `.env` files or config files. The `examples/nextjs` app in the repository walks
through the whole loop.

**Without prompts.** `npx visualguard fix --auto` works on a new branch in a separate git
worktree (your checkout is untouched, `node_modules` is linked in), starts its own dev server
there, and commits only the fixes it could verify. Add `--pr` to push the branch and open a pull
request (with the `gh` CLI, or `GITHUB_TOKEN` and the REST API). In CI, `--in-place` skips the
worktree. AI patches in `--auto` mode need consent given once in a terminal, or
`fix.allowSourceUpload: true`.

**From the report.** With `fix.enabled`, the served report (`npx visualguard report`) has a
"Generate fix" button: it shows the proposed diff and applies and verifies it only when you
click "Apply and verify".

## Watch mode

`npx visualguard watch` compares your local dev server (`fix.verify.server.url`, or `--staging`)
with production and re-tests whenever you save. Only the routes whose page imports the changed
file are captured again; changes that can't be traced to a page (global CSS) re-test everything.

## Baseline mode

No staging site? Compare the site against screenshots you commit:

```ts
mode: "baseline",
baseURL: { staging: "http://localhost:3000" },
baseline: { dir: "visualguard/baselines" },   // commit this (Git LFS works well)
```

`npx visualguard test --update-baselines` saves the current screenshots; later runs compare
against them with the same diff, explanations and AI.

## CI and pull requests

`npx visualguard init` can write `.github/workflows/visualguard.yml` for you. It:

1. runs `visualguard test --ci --junit visualguard-junit.xml`,
2. uploads `.visualguard/runs/` as an artifact (the report opens straight from it),
3. runs `visualguard comment --link <artifact-url>` to post one sticky comment on the PR, updated
   on every push,
4. fails the job afterwards if there are regressions.

In GitHub Actions the run also writes a Markdown summary to the job page (no token needed). The
workflow needs `pull-requests: write`. On pull requests from forks `GITHUB_TOKEN` is read-only, so
post the comment from a separate `workflow_run` workflow.

**Preview deployments.** If each PR gets a preview URL (Vercel, Netlify…), trigger on
`deployment_status` and pass the URL as staging:

```yaml
on:
  deployment_status:
jobs:
  visualguard:
    if: github.event.deployment_status.state == 'success'
    # …same steps as the generated workflow, with:
    env:
      VISUALGUARD_STAGING_URL: ${{ github.event.deployment_status.environment_url }}
```

`visualguard comment` finds the PR from the commit when the event has no PR number. For protected
previews, add the bypass header in the config: `environments: { staging: { headers: {
"x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET ?? "" } } }`.

**Intentional changes.** `npx visualguard accept /pricing` (or `--all` for everything marked review,
or the "Accept change" button in `visualguard report`) records the exact screenshots in
`visualguard.accepted.json`. Commit it: those pages pass as "accepted" until either side changes
again.

**Other integrations.** `--junit <path>` writes JUnit XML for CI test dashboards. `report.webhook`
(or `VISUALGUARD_WEBHOOK_URL`) POSTs a JSON summary after each run, for n8n, Slack workflows or
Zapier.

## How captures stay stable

Before each screenshot VisualGuard disables CSS animations and transitions, hides common cookie
banners and chat widgets, waits for fonts, scrolls through the page so lazy content loads, waits
for a quiet network, pauses the page clock (timers and `requestAnimationFrame`) and media, and
takes screenshots until two in a row match. Each capture runs in its own browser context.

## Output

Every run writes `.visualguard/runs/<run>/` with `manifest.json`, the screenshots, a diff image,
crops of each changed region and `index.html`: a self-contained report with side-by-side, slider,
onion-skin and diff views. It opens straight from disk, so you can upload the run directory as a
CI artifact. `npx visualguard report` serves it locally. Add `.visualguard/` to `.gitignore`
(`init` does this for you).

## Requirements

Node.js 22.12 or newer, and Playwright 1.45 or newer (`npx playwright install chromium`).

## License

MIT
