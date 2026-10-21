# VisualGuard command reference

Every VisualGuard command on one page: what it does, how to type it, the flags that matter, and an example you can copy.

**How to run a command**

- In your own app (VisualGuard installed as a dependency): `npx visualguard <command>`
- From a source checkout of this repository (after building): `node packages/visualguard/dist/cli.js <command>`
- Add `--help` to any command to see its exact options, for example `npx visualguard test --help`.

The examples use `npx visualguard`; swap in the source-checkout form if that is how you run it. "Repeatable" means you can give the flag more than once. Setup walkthroughs: [NPM-PACKAGE-SETUP.md](NPM-PACKAGE-SETUP.md) and [LOCAL-SETUP.md](LOCAL-SETUP.md). Feature overview: [PRODUCT-FEATURES.md](PRODUCT-FEATURES.md).

## Contents

1. [Zero-config scan](#1-zero-config-scan)
2. [Testing commands](#2-testing-commands): [init](#init), [doctor](#doctor), [test](#test), [report](#report), [analyze](#analyze), [accept](#accept), [fix](#fix), [watch](#watch), [monitor](#monitor), [auth](#auth), [merge](#merge), [comment](#comment)
3. [Dashboard commands](#3-dashboard-commands): [dashboard](#dashboard-start-the-dashboard), [runner](#dashboard-runner), [project create](#dashboard-project-create), [import](#dashboard-import), [publish](#dashboard-publish), [export](#dashboard-export), [restore](#dashboard-restore), [assets](#dashboard-assets), [init](#dashboard-init), [baseline pull](#dashboard-baseline-pull), [policy assess](#dashboard-policy-assess), [policy reconcile](#dashboard-policy-reconcile)
4. [Exit codes](#4-exit-codes)
5. [Useful environment variables](#5-useful-environment-variables)

## 1. Zero-config scan

Scan one site, or compare two, with no config file.

```text
visualguard <url> [url2] [options]
```

- One URL scans that site; two URLs compare production (first) against staging (second). A bare origin discovers pages; a URL with a path tests just that page.
- Flags: `-c, --config <path>`, `--only <glob>`, `--viewport <name>`, `--concurrency <n>`, `--fail-on <regression|review|any>`, `--ci`, `--json`, `--junit <path>`, `--debug`, `--a11y`, `--perf`, `--provider <gemini|ollama|none>`, `--model <id>`, `--no-ai`, and `-v, --version`.

```bash
npx visualguard https://example.com
npx visualguard https://example.com https://staging.example.com --no-ai
```

## 2. Testing commands

### init

Create `visualguard.config.ts`, by asking questions or using defaults.

```text
visualguard init [options]
```

- `-y, --yes` accept defaults. `--force` overwrite an existing config.
- `--production <url>`, `--staging <url>`: the two URLs. `--ai <gemini|ollama|none>`: AI provider.
- `--workflow`: also write `.github/workflows/visualguard.yml`.

```bash
npx visualguard init --yes --production https://example.com --staging http://localhost:3000 --workflow
```

### doctor

Check Playwright, your config, both URLs and the AI provider. Run this first when something fails.

```text
visualguard doctor [-c, --config <path>]
```

```bash
npx visualguard doctor
```

### test

Capture production and staging, compare every route, and report the differences. This is the main command.

```text
visualguard test [project] [options]
```

- Config and URLs: `-c, --config <path>`; `--production <url>`, `--staging <url>` override the base URLs.
- Routes and viewports (repeatable): `--route <path>` (replaces configured routes), `--only <glob>` (for example `"/blog/**"`), `--viewport <name>`.
- Browser and speed: `--browser <chromium|firefox|webkit>`, `--output-dir <path>`, `--concurrency <n>`.
- AI: `--provider <gemini|ollama|none>`, `--model <id>`, `--no-ai` (heuristics only).
- Extra checks: `--a11y` (accessibility, axe-core), `--perf` (load time, layout shift, page weight).
- Baselines: `--update-baselines` saves this run's screenshots as the references (baseline mode).
- Shards: `--shard <i/n>` runs part `i` of `n` (for example `1/4`); `--run-group <id>` ties shards together. Join them with [merge](#merge).
- CI output: `--ci` (no prompts or colours), `--json` (manifest to stdout), `--junit <path>`, `--debug` (Playwright traces).
- Policy: `--fail-on <regression|review|any>` sets what makes the exit code non-zero (default `regression`).
- Preview: `--list` prints the URL pairs that would be tested, then exits.

Section framing is a config setting, not a separate CLI flag: set `screenshot.selector` globally or on route objects. Use `--only` to filter configured section jobs; `--route` replaces route entries and therefore removes their per-route selectors. See [section screenshot testing](SECTION-SCREENSHOT-TESTING.md).

Project-bound form: add a dashboard project ID or exact name to save the run to the dashboard.

- `--dashboard <url>`: dashboard origin (or `VISUALGUARD_DASHBOARD_URL`). Needs a project. Without it the run goes to local dashboard storage.
- Labels: `--environment <name>` (default `staging`), `--run-name <name>` (needs a project), `--branch <name>`, `--commit <sha>`, `--pr <number>`, `--deployment <id>`.

```bash
npx visualguard test --staging http://localhost:3000 --only "/blog/**" --viewport mobile --no-ai
npx visualguard test --list
npx visualguard test --shard 1/4 --run-group build-42 --ci
npx visualguard test storefront --dashboard https://dashboard.example.com --branch main --commit abc1234
```

### report

Open the HTML report for the latest run, or a chosen one.

```text
visualguard report [options]
```

- `--run <id>`: run id, prefix or number (default: latest). `--port <n>`: port (default: random).
- `--no-open`: do not open a browser. `--no-serve`: only write `index.html` and print its path. `-c, --config <path>`.

```bash
npx visualguard report --run 3 --no-open
```

### analyze

Run (or re-run) AI analysis on a saved run without capturing again.

```text
visualguard analyze [options]
```

- `--run <id>`, `--provider <gemini|ollama>`, `--model <id>`, `--no-cache` (ignore cached answers), `--only <glob>` (repeatable).
- `--fail-on <regression|review|any>`, `--ci`, `--json`, `-c, --config <path>`.

```bash
npx visualguard analyze --provider gemini --no-cache --only "/pricing"
```

### accept

Mark changes as intentional so they stop failing. Writes `visualguard.accepted.json`; commit it.

```text
visualguard accept [routes...] [options]
```

- `[routes...]`: routes or globs such as `/pricing` or `'/blog/**'`. `--all`: accept every change marked review in the run.
- `--note <text>`: why it is intentional. `--run <id>`, `--viewport <name>` (repeatable), `-c, --config <path>`.

```bash
npx visualguard accept /pricing --note "New pricing layout approved by design"
```

### fix

Propose, apply and visually verify code fixes for regressions. It asks before every change unless told not to.

```text
visualguard fix [routes...] [options]
```

- `[routes...]`: routes or globs (default: every regression in the run). `--run <id>`, `--viewport <name>` (repeatable), `-c, --config <path>`.
- `--include-review`: also try changes marked review. `--allow-dirty`: allow uncommitted changes. `-y, --yes`: apply without asking.
- `--provider <gemini|ollama|none>`, `--model <id>`, `--no-ai`.
- Automatic mode: `--auto` (no prompts; fixes verified in a separate git worktree on a new branch, then committed); with it, `--pr` pushes and opens a pull request, `--base <branch>` (with `--pr`) sets the base branch, `--branch <name>` names the branch (default `visualguard/fix-<run>-<id>`), `--in-place` uses the current checkout (CI), `--keep-worktree` keeps the worktree.

```bash
npx visualguard fix /pricing
npx visualguard fix --auto --pr --base main
```

### watch

Re-test changed routes against your local dev server whenever you save.

```text
visualguard watch [routes...] [options]
```

- `[routes...]`: routes or globs (default: all configured routes).
- `--staging <url>`: local URL to test (default: `fix.verify.server.url`, then `baseURL.staging`).
- `--viewport <name>` (repeatable), `--provider`, `--model`, `--no-ai`, `-c, --config <path>`.

```bash
npx visualguard watch /pricing --staging http://localhost:3000 --no-ai
```

### monitor

Compare a live site with its own previous capture (for example nightly) to catch CMS edits and broken third-party scripts.

```text
visualguard monitor [url] [options]
```

- `[url]`: site to monitor (default: `baseURL.production`).
- Same capture flags as [test](#test): `--config`, `--browser`, `--output-dir`, `--production`, `--staging`, `--route`, `--only`, `--viewport`, `--concurrency`, `--a11y`, `--perf`, `--provider`, `--model`, `--no-ai`, `--fail-on`, `--ci`, `--json`, `--junit`, `--debug`.
- `--reset`: replace every stored snapshot with this run's captures.
- `--workflow [schedule]`: write `.github/workflows/visualguard-monitor.yml` and exit (cron, default `"0 3 * * *"`).

```bash
npx visualguard monitor https://example.com --no-ai
npx visualguard monitor --workflow "0 6 * * *"
```

### auth

Log in once in a real browser window and save the session so captures can reach protected pages.

```text
visualguard auth <env> [options]
```

- `<env>`: `production` or `staging`. `--url <url>`: page to open (default: that environment's base URL).
- `--out <path>`: where to save (default `.visualguard/auth/<env>.json`). `-c, --config <path>`.
- `--until-url <glob>`: save automatically when the page reaches this URL, for example `'**/dashboard'`.

```bash
npx visualguard auth staging --until-url '**/dashboard'
```

### merge

Combine the runs from `test --shard` jobs into one run, one report and one exit code.

```text
visualguard merge <paths...> [options]
```

- `<paths...>`: run directories, `.visualguard` folders, or a folder of downloaded CI artifacts.
- `--allow-partial`: write an incomplete report when shards are missing (exit code stays non-zero).
- `--fail-on <regression|review|any>`, `--ci`, `--json`, `--junit <path>`, `-c, --config <path>`.

```bash
npx visualguard merge ./artifacts --junit merged.xml --ci
```

### comment

Post or update the VisualGuard comment on a pull request (for CI).

```text
visualguard comment [options]
```

- `--run <id>` (default: latest). `--link <url>`: link to the full report. `--pr <number>` (default: from the GitHub event). `--repo <owner/name>` (default: `GITHUB_REPOSITORY`).
- `--dry-run`: print the comment instead of posting it. `-c, --config <path>`.

```bash
npx visualguard comment --dry-run
```

## 3. Dashboard commands

The dashboard is a web app for reviewing runs with your team. Options of `dashboard` itself go before any subcommand, for example `visualguard dashboard --env-file .env publish ...`. Full tables: [dashboard CLI reference](../apps/docs/src/content/docs/reference/cli/dashboard.md) and [dashboard overview](../apps/docs/src/content/docs/dashboard/overview.md).

### dashboard (start the dashboard)

Start a dashboard on your machine.

```text
visualguard dashboard [options]
```

- `--port <number>`: HTTP port (default: `PORT` or 4400). `--host <host>`: listener address; access from other machines requires login.
- `--data-dir <directory>`: local data directory. `--env-file <file>`: load dashboard settings from a file.
- `--file <sqlite-file>`: open an existing local SQLite file (fails if it is missing or an external database URL is set).

The dashboard also runs tests itself, with no token and no extra process, through its built-in runner. It is on by default except on Vercel and needs Chromium on the host; control it with `VISUALGUARD_BUILT_IN_RUNNER` and `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY`.

```bash
npx visualguard dashboard --port 4400 --data-dir .visualguard/platform
```

### dashboard runner

Connect a private browser runner that executes tests the dashboard requests. Use it when the built-in runner is off or the browser must run elsewhere. The credential comes from `VISUALGUARD_RUNNER_TOKEN`.

```text
visualguard dashboard runner --project <id> --server <url> [options]
```

- `--project <id>` and `--server <url>` (dashboard origin) are required.
- `--once`: poll once, run pending work if any, then exit. `--poll <milliseconds>`: interval, 1000 to 30000 (default 3000). `--work-dir <directory>`: private evidence folder.

```bash
VISUALGUARD_RUNNER_TOKEN=... npx visualguard dashboard runner --project storefront --server https://dashboard.example.com
```

### dashboard project create

Create a project if its ID does not exist yet. Alias: `add`.

```text
visualguard dashboard project create <id> [options]
```

- `--name <name>`: display name (default: the ID).
- `--server <url>`: dashboard origin (or `VISUALGUARD_DASHBOARD_URL`); otherwise the local database.

```bash
npx visualguard dashboard project create storefront --name "Storefront"
```

### dashboard import

Import a saved run directory into the dashboard database on this machine.

```text
visualguard dashboard import <run-directory> --project <id> [options]
```

- `--project <id>` (required) project slug; `--name <name>` display name.
- Labels: `--environment <name>` (default `staging`), `--run-name <name>`, `--branch <name>`, `--commit <sha>`, `--pr <number>`, `--deployment <id>`.

```bash
npx visualguard dashboard import .visualguard/runs/RUN_ID --project storefront --branch main
```

### dashboard publish

Upload a saved run to a remote dashboard using `VISUALGUARD_UPLOAD_TOKEN`.

```text
visualguard dashboard publish <run-directory> --project <id> --server <url> [options]
```

- `--project <id>` and `--server <url>` are required. Same labels as import: `--environment`, `--run-name`, `--branch`, `--commit`, `--pr`, `--deployment`.

```bash
VISUALGUARD_UPLOAD_TOKEN=... npx visualguard dashboard publish .visualguard/runs/RUN_ID --project storefront --server https://dashboard.example.com
```

### dashboard export

Write a portable backup of runs and evidence (no account secrets).

```text
visualguard dashboard export <file>
```

```bash
npx visualguard dashboard export /absolute/path/team-evidence.vgbackup.gz
```

### dashboard restore

Merge a portable backup into this dashboard without overwriting existing evidence.

```text
visualguard dashboard restore <file>
```

```bash
npx visualguard dashboard restore /absolute/path/team-evidence.vgbackup.gz
```

### dashboard assets

Copy the prebuilt dashboard UI for static or serverless hosting.

```text
visualguard dashboard assets --out <directory>
```

```bash
npx visualguard dashboard assets --out public/dashboard
```

### dashboard init

Generate a minimal deployable project for Vercel or Cloud Run.

```text
visualguard dashboard init --target <vercel|cloud-run> [options]
```

- `--target <host>` (required): `vercel` or `cloud-run`. `--out <directory>`: new project folder (default `visualguard-dashboard`).
- `--package <tarball>`: use a local release-candidate package.

```bash
npx visualguard dashboard init --target cloud-run --out my-dashboard
```

### dashboard baseline pull

Download an immutable approved baseline set into a new folder.

```text
visualguard dashboard baseline pull <set> --project <id> --out <directory> [options]
```

- `--project <id>` and `--out <directory>` are required; the output directory must not already exist.
- `--version <number>`: pin an earlier version (default: current). `--server <url>`: dashboard origin; otherwise the local database.

```bash
npx visualguard dashboard baseline pull main --project storefront --version 1 --out .visualguard/approved-v1 --server https://dashboard.example.com
```

### dashboard policy assess

Check whether a commit satisfies the project's visual regression policy. Prints JSON.

```text
visualguard dashboard policy assess --project <id> --revision <sha> [options]
```

- `--project <id>` and `--revision <sha>` (exact commit) are required. `--run <id>`: assess a specific stored run.
- `--server <url>`: dashboard origin; otherwise local storage. `--enforce`: exit with a failure code unless the policy is satisfied.

```bash
npx visualguard dashboard policy assess --project storefront --revision abc1234 --enforce
```

### dashboard policy reconcile

Re-verify and republish the exact-revision GitHub check for one pull request or all tracked ones. Prints JSON; exits non-zero if errors are reported.

```text
visualguard dashboard policy reconcile --project <id> (--pr <number> | --all) [options]
```

- `--project <id>` is required, plus exactly one of `--pr <number>` or `--all`. `--server <url>`: dashboard origin; otherwise local storage.

```bash
npx visualguard dashboard policy reconcile --project storefront --pr 42
```

## 4. Exit codes

| Code | Meaning | What to do |
| --- | --- | --- |
| `0` | The run meets your `--fail-on` policy. | Done; review any "review" items yourself. |
| `1` | A visual check failed, or merged results are incomplete. | Open the report; look for regressions, errors or missing shards. |
| `2` | Invalid config or command usage. `policy assess --enforce` and `policy reconcile` also use it for an unsatisfied policy or reported errors. | Fix the flag, path or value and retry. |
| `3` | Environment problem: browser, URL or AI provider unavailable. | Run `visualguard doctor`. |

`--fail-on regression` (default) fails on regressions and errors; `review` also fails items marked review; `any` currently behaves like `review`. More: [exit codes](../apps/docs/src/content/docs/reference/exit-codes.md).

## 5. Useful environment variables

CLI flags win over environment variables. Capture commands read `.env`, then `.env.local`, from your app root without overwriting values already set. Full list: [environment reference](../apps/docs/src/content/docs/reference/environment.md).

| Variable | Used by | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` (fallback `GOOGLE_API_KEY`) | capture, analyze, fix | Gemini AI provider key. |
| `OLLAMA_HOST` | capture, analyze, fix | Local Ollama address (default `http://127.0.0.1:11434`). |
| `VISUALGUARD_AI_PROVIDER` | capture | `gemini`, `ollama` or `none`; `--provider` wins. |
| `VISUALGUARD_PRODUCTION_URL`, `VISUALGUARD_STAGING_URL` | capture | Override the config's base URLs. |
| `VISUALGUARD_BROWSER` | capture | `chromium`, `firefox` or `webkit`. |
| `VISUALGUARD_OUTPUT_DIR` | capture, report | Where run evidence is written. |
| `VISUALGUARD_RUN_GROUP` | `test --shard` | Shared id for all shards of one execution. |
| `VISUALGUARD_DASHBOARD_URL` | `test PROJECT`, `project create` | Dashboard origin when `--dashboard`/`--server` is not given. |
| `VISUALGUARD_UPLOAD_TOKEN` | `dashboard publish` | Project-scoped upload credential. |
| `VISUALGUARD_RUNNER_TOKEN` | `dashboard runner` | Project-scoped runner credential. |
| `VISUALGUARD_BUILT_IN_RUNNER` | dashboard | `on`/`off`; lets the dashboard run tests itself (default on, except on Vercel). |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` | dashboard | Maximum simultaneous built-in tests (default 1). |
| `VISUALGUARD_DATABASE_URL` (fallback `DATABASE_URL`) | dashboard | PostgreSQL or MongoDB connection; unset means local SQLite. |
| `VISUALGUARD_PLATFORM_DATA_DIR` | dashboard | Local data directory (same as `--data-dir`). |
| `VISUALGUARD_PLATFORM_PORT` (fallback `PORT`) | dashboard | Listener port when `--port` is not given. |
| `VISUALGUARD_HOST` | dashboard | Listener address; public binding needs login. |
| `VISUALGUARD_AUTH_MODE` | dashboard | `local` for a trusted loopback trial, `login` for shared use. |
| `VISUALGUARD_PUBLIC_URL` | dashboard | Exact public HTTPS origin of a shared dashboard. |
| `GITHUB_TOKEN` | `comment` | Authorizes the pull request comment. |
