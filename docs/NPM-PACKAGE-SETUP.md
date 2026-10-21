# Use VisualGuard in your project

This guide takes the published `visualguard` npm package from install to a shared team dashboard in your own application. You do not need to clone this repository. Each section says what and why, gives copy-paste commands, then tells you what you should see. Follow sections 1 to 4 for a first result and open the others when you need them. To work on VisualGuard itself, use [local source setup](LOCAL-SETUP.md). For what the product can do, read the [product feature guide](PRODUCT-FEATURES.md). Every command and option is in the [command reference](COMMAND-REFERENCE.md).

Run every command from your application's root folder.

## Contents

1. [Choose your setup](#1-choose-your-setup)
2. [Install and run your first test](#2-install-and-run-your-first-test)
3. [Accept changes and keep local baselines](#3-accept-changes-and-keep-local-baselines)
4. [Add AI explanations](#4-add-ai-explanations)
5. [Test pages behind a login](#5-test-pages-behind-a-login)
6. [More checks and modes](#6-more-checks-and-modes)
7. [Run in CI](#7-run-in-ci)
8. [Start a dashboard with local SQLite](#8-start-a-dashboard-with-local-sqlite)
9. [Run a test from the dashboard](#9-run-a-test-from-the-dashboard)
10. [Store the dashboard in PostgreSQL](#10-store-the-dashboard-in-postgresql)
11. [Store the dashboard in MongoDB](#11-store-the-dashboard-in-mongodb)
12. [Turn on login, tokens and teammates](#12-turn-on-login-tokens-and-teammates)
13. [Deploy to Vercel or Cloud Run](#13-deploy-to-vercel-or-cloud-run)
14. [Storage, backups and recovery](#14-storage-backups-and-recovery)
15. [Team workflow: reviews, baselines and policies](#15-team-workflow-reviews-baselines-and-policies)
16. [Troubleshooting](#16-troubleshooting)
17. [Command cheat sheet](#17-command-cheat-sheet)

## 1. Choose your setup

| You want to...                            | Do this          | You also need                    |
| ----------------------------------------- | ---------------- | -------------------------------- |
| Compare two sites and read a report       | Sections 2 and 3 | Nothing else                     |
| Add AI explanations of changes            | Section 4        | Gemini key or Ollama             |
| Test logged-in pages                      | Section 5        | A login for your app             |
| Run checks in pull requests               | Section 7        | A CI system                      |
| Keep history and reviews on your computer | Sections 8 and 9 | Nothing (SQLite is built in)     |
| Keep dashboard data in your own database  | Section 10 or 11 | PostgreSQL or MongoDB            |
| Share a dashboard with a team             | Sections 12, 13  | Hosting and an external database |

The dashboard needs no database service to start: it uses a built-in SQLite file. PostgreSQL and MongoDB are alternatives, so choose at most one.

## 2. Install and run your first test

You need Node.js 22.12 or newer. Install the package and a browser:

```bash
npm install --save-dev visualguard playwright
```

```bash
npx playwright install chromium
```

On Linux or CI, use `npx playwright install --with-deps chromium` to include system libraries. Check the install:

```bash
npx --no-install visualguard --version
```

You should see a version number. Add these lines to `.gitignore`:

```gitignore
.visualguard/
.env.local
.env.visualguard
```

### Try it with no config

Scan one site:

```bash
npx --no-install visualguard https://your-app.example.com
```

Or compare production with staging. Both servers must be running:

```bash
npx --no-install visualguard https://your-app.example.com http://127.0.0.1:3000
```

To test one page, put its path on the URLs, for example `https://your-app.example.com/pricing http://127.0.0.1:3000/pricing`. You should see a result for each page and viewport, and a saved report under `.visualguard/runs/`. A one-URL scan compares with your previous scan, so the second run is the first real comparison.

### Create a config file

For routes and viewports you choose, run the setup wizard. It writes `visualguard.config.ts`, which the CLI finds automatically. Choose **None** for AI the first time:

```bash
npx --no-install visualguard init
```

To skip the questions, pass real URLs:

```bash
npx --no-install visualguard init --yes --production https://your-app.example.com --staging http://127.0.0.1:3000 --ai none
```

A minimal config looks like this. Edit the generated file instead of replacing it, and see the [configuration reference](../apps/docs/src/content/docs/reference/configuration.md) for every field:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://your-app.example.com",
    staging: "http://127.0.0.1:3000",
  },
  routes: ["/", "/pricing"],
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
  ai: { provider: "none" },
});
```

### Run, check and report

Check your setup, config and URLs:

```bash
npx --no-install visualguard doctor
```

You should see a pass or fail line for the browser, the config and each URL. List the pages that will be tested without capturing anything:

```bash
npx --no-install visualguard test --list
```

Run the comparison with AI off:

```bash
npx --no-install visualguard test --no-ai
```

You should see a result for every route and viewport. A nonzero exit code usually means a real change was found. It does not mean the install failed. To test less, repeat `--only` and `--viewport` as needed:

```bash
npx --no-install visualguard test --only "/blog/**" --viewport mobile --no-ai
```

Choose what makes the command fail with `--fail-on regression` (default), `review` or `any`. Open the latest report, which shows the reference, candidate and diff for each page. Press Ctrl+C to stop it. Use `--run RUN_ID` for an older run:

```bash
npx --no-install visualguard report
```

You should see the report open in your browser.

## 3. Accept changes and keep local baselines

If a change is on purpose, accept it. This writes `visualguard.accepted.json`, so commit that file:

```bash
npx --no-install visualguard accept --all --note "New pricing layout"
```

To accept one route, run `accept /pricing --note "Approved pricing redesign"`. You should see the accepted routes listed, and the next `test` no longer fails for the same change. A different change is still flagged, and acceptance never hides a new accessibility, performance or page-health problem. See [accepting changes](../apps/docs/src/content/docs/guides/accepting-changes.md).

### Compare with saved screenshots

Baseline mode compares your app with screenshots you saved earlier instead of a second site. Create `visualguard.baseline.ts`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  mode: "baseline",
  baseURL: { staging: "http://127.0.0.1:3000" },
  routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } },
  baseline: { dir: "visualguard/baselines", missing: "error" },
  ai: { provider: "none" },
});
```

Save the current look as the baseline. Do this only when the current look is correct:

```bash
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines --no-ai
```

You should see PNG files plus `.meta.json`, `.dom.json` and `.health.json` files in `visualguard/baselines`. Commit them together. After you change the app, compare without the update flag:

```bash
npx --no-install visualguard test --config visualguard.baseline.ts --no-ai
```

Keep browser, viewport and settings the same between runs, and never update baselines just to make CI pass. See [local baselines](../apps/docs/src/content/docs/guides/local-baselines.md).

## 4. Add AI explanations

AI explains uncertain changes. It is off unless you ask. If a key or model is missing or fails, the run falls back to the normal comparison, so check the report for AI notes. Screenshots and page context go to the provider you choose.

### Gemini

Get a key from [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key) and save it in `.env.local`:

```dotenv
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

```bash
npx --no-install visualguard test --provider gemini
```

You should see AI notes on uncertain changes in the report. Add `--model MODEL_ID` to pick a model your account supports.

### Ollama (local model)

Start Ollama and download a vision model:

```bash
ollama pull qwen2.5vl
```

```bash
npx --no-install visualguard test --provider ollama --model qwen2.5vl
```

You should see the same AI notes, produced on your computer. Ollama is expected at `http://127.0.0.1:11434`. Set `OLLAMA_HOST` to change that.

### Re-analyze a saved run

Run AI on the latest saved run without capturing again. Add `--run ID` to choose another run or `--no-cache` to ignore cached answers:

```bash
npx --no-install visualguard analyze --provider gemini
```

To turn AI off again, add `--no-ai`. Set call, token and time limits in your config for repeatable CI. See [Gemini](../apps/docs/src/content/docs/guides/ai-gemini.md), [Ollama](../apps/docs/src/content/docs/guides/ai-ollama.md) and [AI policy and budgets](../apps/docs/src/content/docs/guides/ai-policy-and-budgets.md).

## 5. Test pages behind a login

Save a browser login once, then let captures reuse it. This opens a browser. Log in there, and the session is saved to `.visualguard/auth/staging.json`:

```bash
npx --no-install visualguard auth staging
```

Do the same with `auth production` if production needs a login. Add `--until-url '**/dashboard'` to save automatically when login finishes. Then add the saved files inside `defineConfig({ ... })`:

```ts
  environments: {
    production: { storageState: ".visualguard/auth/production.json" },
    staging: { storageState: ".visualguard/auth/staging.json" },
  },
```

Run the test again:

```bash
npx --no-install visualguard test --no-ai
```

You should see logged-in pages in the screenshots, not a login screen. Session files hold credentials, so never commit them, and renew them when they expire. This is your app's login, separate from any dashboard account. See [application authentication](../apps/docs/src/content/docs/guides/application-auth.md).

## 6. More checks and modes

### Section screenshot testing with data attributes

Use an installed release that supports `screenshot.selector`. Add a unique attribute to the container in both production and staging:

```html
<section data-visualguard="checkout">Your checkout content</section>
```

Keep your existing URLs and routes in `visualguard.config.ts` and add:

```ts
screenshot: { selector: '[data-visualguard="checkout"]' },
```

Start your application, then run `npx --no-install visualguard test --no-ai` and `npx --no-install visualguard report`. Confirm each screenshot contains only that container. Older releases can ignore unknown settings, so check the screenshot dimensions rather than assuming the field is active.

For route-specific sections, use `{ path: "/checkout", screenshot: { selector: '[data-visualguard="checkout"]' } }`. Different selectors can create separate checks for the same page; a route override with `selector: null` captures the page. Missing, hidden, or duplicate targets cause errors. Page-wide health checks still apply, and section baselines need explicit creation.

The [repository walkthrough](SECTION-SCREENSHOT-TESTING.md) and [Astro guide](../apps/docs/src/content/docs/guides/section-capture.md) cover the full setup, multiple sections, baseline migration, Playwright states, and troubleshooting.

### Accessibility and performance

`--a11y` reports new accessibility problems. `--perf` reports slower loads, layout shift and heavier pages:

```bash
npx --no-install visualguard test --a11y --perf --no-ai
```

You should see these findings next to the screenshots. Compare equivalent builds, because a development server is a poor performance reference. See [accessibility and performance](../apps/docs/src/content/docs/guides/accessibility-and-performance.md).

### Playwright fixture

Check one screen from inside a Playwright test. Install `@playwright/test`, set `use.baseURL` in your Playwright config to the staging URL, and write a test:

```ts
import { test } from "visualguard/playwright";

test("checkout summary", async ({ page, visualguard }) => {
  await page.goto("/checkout");
  await visualguard.check(page, { name: "checkout-summary" });
});
```

```bash
npx playwright test
```

You should see VisualGuard screenshots and a `result.json` attached to the test result. See [Playwright](../apps/docs/src/content/docs/guides/playwright.md) for interactive states.

### Watch mode

Re-test the pages you change while you code. Keep your dev server running:

```bash
npx --no-install visualguard watch --staging http://localhost:3000
```

You should see a new comparison each time you save a file. Press Ctrl+C to stop. See [watch](../apps/docs/src/content/docs/guides/watch.md).

### Monitor mode

Compare a live site with its own previous capture, for example every night. The first run saves a reference and later runs compare with it:

```bash
npx --no-install visualguard monitor https://your-app.example.com
```

Add `--reset` to replace every saved reference with the current look. To write a scheduled GitHub workflow, run:

```bash
npx --no-install visualguard monitor --workflow "0 3 * * *"
```

You should see `.github/workflows/visualguard-monitor.yml`. See [monitoring](../apps/docs/src/content/docs/guides/monitoring.md).

### Fix regressions

`fix` proposes a code change, shows the diff and checks the result visually. It is off by default. Turn it on in your config:

```ts
  fix: {
    enabled: true,
    include: ["app/**", "components/**", "styles/**"],
    verify: {
      server: { command: "npm run dev", url: "http://localhost:3000" },
      commands: [],
    },
  },
```

Run it after a test. It asks before every change, needs a Git repository with a clean working tree, and reverts edits that fail verification:

```bash
npx --no-install visualguard fix
```

You should see a proposed diff and a prompt. Use `fix /checkout` for one page and `--include-review` to include review items. `fix --auto` asks nothing and commits only verified fixes on a new branch in a separate worktree. Add `--pr` to push that branch and open a pull request. It needs the verification server and consent to upload source. See [fixes](../apps/docs/src/content/docs/guides/fixes.md).

## 7. Run in CI

In CI, install the browser with `npx playwright install --with-deps chromium`, then run with plain output and a JUnit file:

```bash
npx --no-install visualguard test --ci --junit visualguard-junit.xml
```

You should see no colors or prompts, a `visualguard-junit.xml` file, and a nonzero exit code if a change reaches your `--fail-on` level. Upload the whole `.visualguard/runs` folder and the JUnit file even when the test fails.

### Generated GitHub workflow

`init` can write a workflow that runs the test, uploads the report and comments on the pull request:

```bash
npx --no-install visualguard init --workflow
```

You should see `.github/workflows/visualguard.yml`. Commit it.

### GitHub Action

To write the workflow yourself, add this step after checkout, Node setup and `npm ci`. Give the job `contents: read` and `pull-requests: write` permissions:

```yaml
      - uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }} # optional
          # staging-url: ${{ vars.STAGING_URL }}
```

The Action installs the browser, runs the test, uploads the report, comments and fails on regressions. A key alone does not turn AI on: also set `ai.provider` in config or pass `args: --provider gemini`. Pin the Action to a release tag. All inputs are in [GitHub Actions](../apps/docs/src/content/docs/ci/github-actions.md).

### Pull request comment

Post or update one summary comment. It needs a `GITHUB_TOKEN` with pull request write access. Add `--dry-run` to print the comment instead:

```bash
npx --no-install visualguard comment --link REPORT_URL
```

### Shards and merge

Give every shard the same config, revision and `--run-group`:

```bash
npx --no-install visualguard test --ci --shard 1/2 --run-group ci-execution-123
```

Run `--shard 2/2` the same way on another job, then copy all shard run folders into one folder and merge them:

```bash
npx --no-install visualguard merge downloaded-shards --ci --junit merged-junit.xml
```

You should see one combined result. Merge fails if a shard is missing, and `--allow-partial` only writes a diagnostic report that still fails. GitHub Actions sets the run group for you. Other systems can set `VISUALGUARD_RUN_GROUP`. See [sharding](../apps/docs/src/content/docs/ci/sharding.md), the [CI overview](../apps/docs/src/content/docs/ci/overview.md) and [preview deployments](../apps/docs/src/content/docs/ci/preview-deployments.md).

## 8. Start a dashboard with local SQLite

The dashboard keeps run history, screenshots and reviews in one place. The local version needs no database service and no login. It is a separate server, and `test --dashboard URL` only connects to one that is already running.

Create `.env.visualguard`. These three lines select the built-in SQLite store, even if your shell has another `DATABASE_URL`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=
```

In terminal A, start the dashboard and leave it running. The default address is `http://127.0.0.1:4400`. Add `--port` or `--data-dir` before any subcommand to change the port or data folder:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

In terminal B, check that it is up:

```bash
curl --fail --show-error http://127.0.0.1:4400/api/health
```

You should see `{"status":"ok"}`. Create a project. Its ID is what tests refer to, and the name is only a label:

```bash
npx --no-install visualguard dashboard project create storefront --name "Storefront Web" --server http://127.0.0.1:4400
```

Run a test and send the result to that project:

```bash
npx --no-install visualguard test storefront --dashboard http://127.0.0.1:4400 --no-ai
```

You should see the run under the project at `http://127.0.0.1:4400`. Add `--run-name`, `--branch`, `--commit` and `--pr` to label a run. Stop the dashboard with Ctrl+C and start it again with the same env file: the history should still be there. The data file is `.visualguard/platform/metadata.sqlite`.

### Save a run you already have

Upload a saved run, for example after a failed upload. Replace `RUN_ID` with a folder in `.visualguard/runs/` that contains `manifest.json`:

```bash
npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID --project storefront --server http://127.0.0.1:4400
```

On the same computer, `dashboard --env-file .env.visualguard import .visualguard/runs/RUN_ID --project storefront` writes straight into the dashboard storage with no server running. You should see the run after a refresh. Neither command captures again, and an incomplete run stays visibly incomplete. See [projects](../apps/docs/src/content/docs/dashboard/projects.md) and [publishing](../apps/docs/src/content/docs/dashboard/publishing.md).

## 9. Run a test from the dashboard

You can start a comparison from the browser instead of the terminal.

1. Open `http://127.0.0.1:4400` and select the project.
2. Choose **Configure tests**. Enter the production URL, staging URL, routes and viewports, and save. Each project keeps its own settings.
3. Choose **Run test**. The project shows progress such as "2 of 4 comparisons".
4. When it finishes, choose **View result**.

You should see the finished run in the project's history. A finished run can still contain regressions, so read the result. Finishing is not approval.

> **Version note:** this needs a VisualGuard release newer than 3.2.3 (or a source checkout). With 3.2.3, **Run test** stays disabled until a [private runner](#optional-a-private-runner) is connected.

The dashboard server captures the pages itself with its own Chromium. The only authorization it needs is your signed-in account, and no runner token is needed. The URLs must be reachable from the machine running the dashboard, where `localhost` means that machine. `VISUALGUARD_BUILT_IN_RUNNER` turns this on or off in the dashboard env file. It is on by default, except on Vercel. `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` limits how many tests run at once (default 1). If Chromium is missing there, the run fails and tells you to run `npx playwright install chromium` on that machine.

### Optional: a private runner

Use a private runner only when the dashboard cannot reach your app (for example a staging site behind a VPN) or cannot run a browser (Vercel). A connected runner takes priority over the built-in capture.

1. In the project, open **Connect a runner for this project** and choose **Create 30-day runner credential**. Save it when shown.
2. On a computer that can reach your app, put it in an ignored `.env.visualguard-runner`:

```dotenv
VISUALGUARD_RUNNER_TOKEN=YOUR_PROJECT_RUNNER_CREDENTIAL
```

3. Start the runner and leave it running. For a hosted dashboard, use its HTTPS address in `--server`:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard-runner runner --project storefront --server http://127.0.0.1:4400
```

You should see the project show **Runner connected**. Choose **Run test** as before. `--once` runs one queued test and exits, and `--work-dir` sets where evidence is kept. Keep Gemini keys or the Ollama service on the runner machine. See [private runners](../apps/docs/src/content/docs/dashboard/private-runners.md) and [execution progress](../apps/docs/src/content/docs/dashboard/execution-progress.md).

## 10. Store the dashboard in PostgreSQL

Use PostgreSQL when you want dashboard data in a database you manage. Use a dedicated database and a real database user. A new database starts an empty workspace and does not move SQLite history. Stop any dashboard already on port 4400 first.

### Get a database

Use a hosted database and copy its URL, including TLS options such as `?sslmode=require`. Or, for local development with Docker, start a throwaway instance:

```bash
docker run --detach --name visualguard-postgres-local --publish 127.0.0.1:5433:5432 --env POSTGRES_USER=visualguard --env POSTGRES_PASSWORD=visualguard_local_only --env POSTGRES_DB=visualguard --volume visualguard_pg_local:/var/lib/postgresql/data postgres:17
```

Wait until `docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard` says "accepting connections". These passwords are for this local example only. Use strong, different credentials anywhere shared.

### Point the dashboard at it

Edit `.env.visualguard`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard
```

Start the dashboard in terminal A:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

In terminal B, create a project and run a test as in section 8:

```bash
npx --no-install visualguard dashboard project create storefront --name "Storefront Web" --server http://127.0.0.1:4400
```

```bash
npx --no-install visualguard test storefront --dashboard http://127.0.0.1:4400 --no-ai
```

You should see the run and its screenshots. Stop the dashboard, start it again with the same env file and confirm the history remains. Listing the tables (`\dt` in `psql`) should show names starting with `vg_`.

The database user must be allowed to create and update tables and indexes, because the dashboard creates its `vg_*` tables itself. A restricted user needs schema permissions from your database administrator. Replace every placeholder in the URL with real values. For hosting, see [PostgreSQL](../apps/docs/src/content/docs/deployment/postgresql.md) and [Cloud SQL](../apps/docs/src/content/docs/deployment/cloud-sql.md).

## 11. Store the dashboard in MongoDB

Use MongoDB Atlas or another MongoDB with transactions. Atlas needs no Docker, local install or replica-set setup.

### Get the URL

1. In MongoDB Atlas, create or choose a cluster.
2. Under **Database Access**, create a database user with read and write access to a dedicated database named `visualguard`. This is not your Atlas website login.
3. Under **Network Access**, add the public IP of the computer that runs the dashboard. When you host the dashboard later, allow its host instead.
4. Choose **Connect**, then **Drivers**, and copy the connection string.
5. Fill in the user and password, and put the database name `/visualguard` before any `?` options.

It should look like this:

```text
mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority
```

A URL that ends at `.mongodb.net/` with no database name fails with `MongoDB URL must include a database name`. Encode special characters in the password (`@` becomes `%40`), but not the whole URL. VisualGuard creates its collections for you.

### Point the dashboard at it

Create `.env.visualguard`:

```dotenv
VISUALGUARD_DATABASE_URL="mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
```

Start the dashboard in terminal A:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

In terminal B, create a project and run a test. The test needs the dashboard address, never the MongoDB password:

```bash
npx --no-install visualguard dashboard project create storefront --name "Storefront Web" --server http://127.0.0.1:4400
```

```bash
npx --no-install visualguard test storefront --dashboard http://127.0.0.1:4400 --no-ai
```

### Check that it is saved

Open the run in the dashboard. In Atlas or MongoDB Compass, open the `visualguard` database. You should see collections such as `vg_projects`, `vg_runs`, `vg_state`, `vg_objects` and `vg_object_chunks`. Restart the dashboard with the same env file and confirm the history remains.

### Your own MongoDB server

A replica set or sharded deployment works the same way: use its URL with an explicit database name and keep its authentication and TLS options. A single standalone server (for example `mongodb://127.0.0.1:27017/visualguard`) needs `VISUALGUARD_USER_ADMISSION=legacy`. It handles evidence, reviews and publishing, but invitations, Google linking, baseline changes and administrator recovery need transactions. See [MongoDB](../apps/docs/src/content/docs/deployment/mongodb.md).

## 12. Turn on login, tokens and teammates

Local mode trusts the person at the computer and must stay on `127.0.0.1`. Anything shared needs login mode.

### Password administrator

Stop the dashboard. Keep your database URL (or the empty SQLite value) in `.env.visualguard` and add or change these lines. For a fresh team installation, also add `VISUALGUARD_USER_ADMISSION=invite`. On a real host, the public URL is the exact HTTPS address people open, with no path:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='YOUR_UNIQUE_12_TO_256_CHARACTER_PASSWORD'
```

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

You should see a sign-in page at the exact public address. Sign in with the email and password above. They create the first administrator once, and changing them later does not change an existing account.

### Project upload tokens

A login dashboard only accepts uploads that carry a project token. A token is not a password, and it cannot create projects or read history.

1. In the dashboard, open **People & integrations**, select or create the project, and create a named project upload token. Copy it when shown.
2. In your application's `.env.local` or CI secrets, add the following. Use your real HTTPS address for a hosted dashboard:

```dotenv
VISUALGUARD_DASHBOARD_URL=http://127.0.0.1:4400
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

```bash
npx --no-install visualguard test storefront --no-ai
```

You should see the run appear in the project. `dashboard publish` does not read `.env.local`. Put the token in a private file such as `.env.visualguard-upload` and pass it before the subcommand:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard-upload publish .visualguard/runs/RUN_ID --project storefront --server https://YOUR_DASHBOARD_HOST
```

To create a project from the command line on a login dashboard, put `VISUALGUARD_DASHBOARD_URL`, the admin email and the current admin password in a private `.env.dashboard-admin`, then run the following. You can also create it in the dashboard. Keep these values out of CI:

```bash
npx --no-install visualguard dashboard --env-file .env.dashboard-admin project create storefront --name "Storefront Web"
```

See [login](../apps/docs/src/content/docs/dashboard/login.md) and [publishing](../apps/docs/src/content/docs/dashboard/publishing.md).

### Google sign-in

Add Google after password login works.

1. In your Google Cloud project, create an OAuth client of type **Web application**. Register the redirect address `https://YOUR_DASHBOARD_HOST/api/auth/callback`. If the app is in testing, add the Google accounts that may sign in.
2. Add all three settings to the dashboard env file and restart. Supply all or none:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET='YOUR_GOOGLE_CLIENT_SECRET'
```

3. Sign in as the password administrator. Under **Your sign-in methods**, choose **Link Google account** and finish the Google steps.
4. Sign out and choose **Sign in with Google**. You should land in the same account with the same history.

Matching email addresses alone never merge accounts. Keep one password administrator as a backup. See [Google sign-in](../apps/docs/src/content/docs/dashboard/google-sign-in.md).

### Users, roles and invitation links

As an administrator, open **People & integrations**. Create members and assign project roles, or create an expiring invitation link for an email, project and role. The dashboard sends no email, so share the link privately. The person signs in as the invited identity and accepts. Opening the link alone grants nothing.

| Role                    | Can do                                                       |
| ----------------------- | ------------------------------------------------------------ |
| Viewer                  | Read evidence in assigned projects                           |
| Reviewer                | Comment and record visual decisions                          |
| Maintainer              | Manage project access, upload tokens, baselines and policies |
| Workspace administrator | Manage all accounts and projects                             |

Administrators can also disable or restore accounts, reset passwords and revoke sessions and tokens. The last active administrator is protected. See [people and permissions](../apps/docs/src/content/docs/dashboard/people-and-permissions.md).

## 13. Deploy to Vercel or Cloud Run

Both hosts need an external database (PostgreSQL, or MongoDB with transactions), because their disks do not last. A new database starts empty. Set these on the host, never in `NEXT_PUBLIC_` or `VITE_` names:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_DATABASE_URL=YOUR_DATABASE_URL
VISUALGUARD_PUBLIC_URL=https://YOUR_DASHBOARD_HOST
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='YOUR_UNIQUE_INITIAL_PASSWORD'
```

Generate a deployment folder into a new, empty directory. This creates files only. It does not deploy anything. Use `--target cloud-run --out deploy/visualguard-cloud-run` for Cloud Run:

```bash
npx --no-install visualguard dashboard init --target vercel --out deploy/visualguard-vercel
```

Open the generated `package.json` and check that `visualguard` matches your installed version. If not, set it with `npm pkg set dependencies.visualguard=YOUR_VERSION`. Commit the folder's lockfile. A newer package never updates a folder you generated earlier, so regenerate after upgrading. The generated Vercel build copies the dashboard pages with `dashboard assets --out public`, so you rarely run that yourself.

### Vercel

Vercel cannot keep a browser running, so use a private runner (section 9) for **Run test**. Create a separate Vercel project for the dashboard, not your app's project. Use the **Other** framework and Node 22.x, and create a PostgreSQL database such as one from the Vercel Marketplace:

```bash
cd deploy/visualguard-vercel && npm install && npm install --global vercel && vercel login && vercel link
```

Add each of the five settings privately at the prompts, scoped to Production. Run this once per variable name, using `login` for `VISUALGUARD_AUTH_MODE`:

```bash
vercel env add VISUALGUARD_DATABASE_URL production
```

```bash
vercel --prod
```

You should see the dashboard at your Vercel address. If the address is only known after the first deploy, set `VISUALGUARD_PUBLIC_URL` to it and deploy again. Open `/api/health`, then sign in. Reloading `/reviews`, `/baselines`, `/policies` and `/settings` must not return 404. If one does, check the rewrites in the generated `vercel.json` and keep `/api/:path*` pointed at the API. Keep preview deployments off or give them their own database. See [Vercel](../apps/docs/src/content/docs/deployment/vercel.md).

### Google Cloud Run

Cloud Run can run tests itself, because the generated image includes Chromium. You need a Google Cloud project with billing and the `gcloud` CLI:

```bash
cd deploy/visualguard-cloud-run && npm install && gcloud auth login
```

```bash
export VG_PROJECT_ID="your-google-cloud-project" VG_REGION="us-central1" && gcloud config set project "$VG_PROJECT_ID" && gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Create a private `.env.cloud-run.yaml` in the generated folder and run `chmod 600` on it. The public URL is temporary until the service has an address:

```yaml
VISUALGUARD_AUTH_MODE: "login"
VISUALGUARD_PUBLIC_URL: "https://setup.invalid"
VISUALGUARD_DATABASE_URL: "postgresql://REAL_USER:REAL_PASSWORD@REAL_HOST/REAL_DATABASE?sslmode=require"
VISUALGUARD_ADMIN_EMAIL: "owner@example.com"
VISUALGUARD_ADMIN_PASSWORD: "YOUR_UNIQUE_INITIAL_PASSWORD"
```

Create `.gcloudignore` so secrets and local data are not uploaded, and keep the YAML out of Git:

```text
.gcloudignore
.git
node_modules
.env
.env.*
.visualguard
```

Deploy. `--no-cpu-throttling`, `--min-instances 1` and `--memory 2Gi` let the dashboard capture tests after the request returns. Without them, a test started from the dashboard fails as disconnected:

```bash
gcloud run deploy visualguard-dashboard --source . --region "$VG_REGION" --env-vars-file .env.cloud-run.yaml --port 8080 --max-instances 3 --no-allow-unauthenticated --no-cpu-throttling --min-instances 1 --memory 2Gi
```

Read the service address and apply it. Also write it into the YAML file, so the next deploy does not bring back `setup.invalid`:

```bash
export VG_DASHBOARD_URL="$(gcloud run services describe visualguard-dashboard --region "$VG_REGION" --format='value(status.url)')" && gcloud run services update visualguard-dashboard --region "$VG_REGION" --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_DASHBOARD_URL}"
```

Let people reach the sign-in page. The dashboard's own login and tokens still protect your data:

```bash
gcloud run services add-iam-policy-binding visualguard-dashboard --region "$VG_REGION" --member="allUsers" --role="roles/run.invoker"
```

```bash
curl --fail "$VG_DASHBOARD_URL/api/health"
```

You should see `{"status":"ok"}`. Open the address and sign in. For ongoing use, move the database URL and admin password into Secret Manager. For Cloud SQL, follow [Cloud SQL](../apps/docs/src/content/docs/deployment/cloud-sql.md). See also [Cloud Run](../apps/docs/src/content/docs/deployment/cloud-run.md) and the [deployment overview](../apps/docs/src/content/docs/deployment/overview.md).

To publish from your app or CI, create a project and its upload token and use them as in section 12. Test one real, large run before relying on it.

## 14. Storage, backups and recovery

Run files stay on the machine that ran the test, normally in `.visualguard/runs/`. Published screenshots and page snapshots are also stored in the dashboard database (the SQLite file, PostgreSQL or MongoDB), so plan database size for them. A storage bucket setting does not move images, and nothing deletes old history automatically.

### Portable export and restore

Export projects and run evidence to one file. It excludes accounts and sign-in state, so it is not a full backup. Use a new file name:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard export /absolute/path/team-evidence.vgbackup.gz
```

Restore it into a fresh local dashboard. First create `.env.visualguard-sqlite` with the three local SQLite lines from section 8:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite --data-dir ./review-workspace restore /absolute/path/team-evidence.vgbackup.gz
```

You should see your projects and runs when you start that dashboard with the same `--env-file` and `--data-dir`. Restore only adds evidence and never overwrites, so use an empty destination.

### Full backups

For complete recovery, use your database's own backup, plus your settings and secrets.

- **SQLite:** stop the dashboard, then copy the whole data directory.
- **PostgreSQL:** use managed backups, or `pg_dump`. With the Docker example from section 10, run `docker exec visualguard-postgres-local pg_dump -U visualguard -d visualguard -Fc > visualguard-native.dump`.
- **MongoDB:** use Atlas backups or your deployment's own procedure.

Restore into a separate database and check old screenshots, accounts, roles and baselines before you trust the backup. A restore also brings back old tokens and sessions, so revoke any that were exposed. Keep backups private and out of Git.

### Audit page, recovery and upgrades

Administrators open **Audit & recovery** to see filtered history and sign-in readiness. If you lose password administrator access, recovery is a host-side tool that ships with the source repository, not the npm package. Follow [operations and recovery](../apps/docs/src/content/docs/deployment/operations-and-recovery.md), and never edit user rows by hand.

To upgrade, back up first, then move the dashboard and every runner to the same package version and regenerate any hosting folder. A code rollback does not undo a database migration. See [upgrades](../apps/docs/src/content/docs/deployment/upgrades.md) and [storage and backups](../apps/docs/src/content/docs/deployment/storage-and-backups.md).

## 15. Team workflow: reviews, baselines and policies

These need login mode and a database that supports them (SQLite, PostgreSQL, or MongoDB with transactions).

### Reviews

Publish a run, open it and select a check under **Team review**. Comment, assign a reviewer and a deadline, then record **Approve visual change**, **Request changes** or **Withdraw decision** with a reason. The **Review inbox** lists your assigned and overdue items. A decision applies to that exact evidence, and a local `accept` file is not a team approval. See [reviews](../apps/docs/src/content/docs/dashboard/reviews.md).

### Approved baselines

An approved baseline is the team's agreed look. A maintainer promotes reviewed evidence to a named set such as `main` under **Approved baselines**, and each promotion becomes an immutable numbered version. Download one version into a new folder with your project upload token in the environment:

```bash
npx --no-install visualguard dashboard baseline pull main --project storefront --version 1 --out .visualguard/approved-v1 --server https://YOUR_DASHBOARD_HOST
```

Set `baseline.dir` in your baseline config (section 3) to `.visualguard/approved-v1`, and keep rendering settings the same. You should then be able to run `test --config visualguard.baseline.ts --no-ai` offline. `--update-baselines` cannot overwrite an approved version. See [approved baselines](../apps/docs/src/content/docs/dashboard/approved-baselines.md).

### Visual policies

A policy says whether the evidence for one exact commit meets the project's rules. Open **Visual regression policy**, start in **Informative** mode, choose the target branch, baseline and required approvals, and save with a reason. Capture a run with the real commit SHA, then assess it. Add `--enforce` to exit with failure unless the policy is satisfied:

```bash
npx --no-install visualguard dashboard policy assess --project storefront --revision FULL_COMMIT_SHA --server https://YOUR_DASHBOARD_HOST
```

Refresh the check for one pull request, or add `--all` for every tracked pull request:

```bash
npx --no-install visualguard dashboard policy reconcile --project storefront --pr 123 --server https://YOUR_DASHBOARD_HOST
```

Both need the project's upload token in the environment. Capture the pull request's head commit, not the temporary merge commit. See [visual policies](../apps/docs/src/content/docs/dashboard/visual-policies.md).

### GitHub checks

To publish the policy result as a GitHub check, add these to the dashboard environment and set up the webhook described in [GitHub checks](../apps/docs/src/content/docs/ci/github-checks.md):

```dotenv
VISUALGUARD_GITHUB_TOKEN=YOUR_CHECKS_WRITE_AND_PULL_REQUESTS_READ_CREDENTIAL
VISUALGUARD_GITHUB_REPOSITORIES=storefront=customer-org/customer-repo
VISUALGUARD_GITHUB_WEBHOOK_SECRET=YOUR_UNIQUE_RANDOM_SECRET
```

Run `policy reconcile --all` on a schedule, at least every five minutes, and start in Informative mode. VisualGuard does not change branch protection or merge pull requests.

## 16. Troubleshooting

| Problem                                         | Fix                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Browser or Chromium not found                   | Run `npx playwright install chromium` on the machine that captures. On Linux or CI, add `--with-deps`       |
| `test` exits nonzero                            | A change was found. Run `report`, then `accept` the intended ones                                           |
| Pages fail to load or time out                  | Start both servers, then run `doctor`. `localhost` means the machine doing the capture                      |
| AI ran but the report has no AI notes           | Check the key or model. A failed AI call falls back to the normal comparison                                |
| `Cannot bind dashboard project: fetch failed`   | The dashboard is not running or the port differs. Use the same URL in `--server` and `--dashboard`          |
| Run missing, or history empty after a restart   | Start the dashboard from the same folder with the same `--env-file`. A new database starts empty            |
| Login dashboard rejects uploads                 | Set `VISUALGUARD_DASHBOARD_URL` and a project `VISUALGUARD_UPLOAD_TOKEN` (section 12)                       |
| Run test fails because Chromium is missing      | Run `npx playwright install chromium` on the dashboard machine, or connect a private runner                 |
| Run test cannot reach your staging site         | Connect a private runner, or set `VISUALGUARD_BUILT_IN_RUNNER=off` to require one                           |
| Cloud Run test stops as "disconnected"          | Redeploy with `--no-cpu-throttling --min-instances 1 --memory 2Gi`. Vercel needs a private runner           |
| `role "USER" does not exist` (PostgreSQL)       | Use a real user in the URL, replace every placeholder, and grant that user schema permissions               |
| Dashboard uses another app's database           | Set `VISUALGUARD_DATABASE_URL` (empty means SQLite) and check for an exported `DATABASE_URL`                |
| `MongoDB URL must include a database name`      | Add `/visualguard` before the `?` options                                                                   |
| MongoDB timeout, authentication or transactions | Check the Atlas IP list, user and encoded password. Full features need Atlas or a replica set               |
| Hosted page reload returns 404, or data vanishes | Check the generated Vercel rewrites. Hosted dashboards need an external database, never a local SQLite file |

More help: [installation](../apps/docs/src/content/docs/troubleshooting/installation.md), [capture](../apps/docs/src/content/docs/troubleshooting/capture.md), [dashboard](../apps/docs/src/content/docs/troubleshooting/dashboard.md) and [CI](../apps/docs/src/content/docs/troubleshooting/ci.md).

## 17. Command cheat sheet

Put `npx --no-install visualguard` before each command, and add `--help` to any command for its options. Dashboard options such as `--env-file`, `--port`, `--host`, `--data-dir` and `--file` go before a subcommand.

| Command                                                                        | What it does                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `URL` or `PROD_URL STAGING_URL`                                                | Scan one site or compare two, with no config                   |
| `init` / `init --yes --production URL --staging URL --ai none`                 | Create `visualguard.config.ts` (`--workflow` adds a CI file)   |
| `doctor`                                                                       | Check browser, config and URLs                                 |
| `test`                                                                         | Compare using the config                                       |
| `test --no-ai` / `--provider gemini` / `--provider ollama --model ID`          | Turn AI off or choose a provider                               |
| `test --list`                                                                  | Show the pages to test, without capturing                      |
| `test --only GLOB --viewport NAME --route PATH`                                | Limit routes and viewports                                     |
| `test --fail-on regression\|review\|any`                                       | Choose what makes the exit code nonzero                        |
| `test --a11y --perf`                                                           | Add accessibility and performance checks                       |
| `test --update-baselines`                                                      | Save screenshots as baselines (baseline mode)                  |
| `test --ci --junit FILE`                                                       | Plain output and a JUnit report for CI                         |
| `test --shard 1/2 --run-group ID`                                              | Run one part of the work                                       |
| `test PROJECT --dashboard URL`                                                 | Run and publish to a dashboard project                         |
| `test PROJECT --dashboard URL --run-name NAME --branch B --commit SHA --pr N`  | Label the dashboard run                                        |
| `report`                                                                       | Open the latest report (`--run ID` for another)                |
| `analyze`                                                                      | Re-run AI on a saved run (`--no-cache` skips the cache)        |
| `accept --all` / `accept ROUTE --note TEXT`                                    | Accept intended changes                                        |
| `auth ENV`                                                                     | Save a browser login for `production` or `staging`             |
| `fix` / `fix --auto` / `fix --auto --pr`                                       | Propose and verify repairs, commit them, or open a pull request |
| `watch`                                                                        | Re-test changed pages as you save                              |
| `monitor URL` / `monitor --workflow CRON`                                      | Compare a live site with its last capture, or write a schedule |
| `merge PATHS...`                                                               | Combine shard results into one report                          |
| `comment`                                                                      | Post or update the pull request comment                        |
| `dashboard --env-file FILE`                                                    | Start the dashboard                                            |
| `dashboard project create ID --name NAME --server URL`                         | Create a dashboard project                                     |
| `dashboard publish RUN_DIR --project ID --server URL`                          | Upload a saved run                                             |
| `dashboard import RUN_DIR --project ID`                                        | Add a saved run straight into local dashboard storage          |
| `dashboard runner --project ID --server URL`                                   | Connect an optional private runner                             |
| `dashboard baseline pull SET --project ID --out DIR --server URL`              | Download an approved baseline                                  |
| `dashboard policy assess --project ID --revision SHA --server URL`             | Check a commit against the visual policy                       |
| `dashboard policy reconcile --project ID --pr N --server URL`                  | Refresh a pull request's policy check (`--all` for every one)  |
| `dashboard export FILE` / `dashboard restore FILE`                             | Back up or restore evidence                                    |
| `dashboard init --target vercel\|cloud-run --out DIR`                          | Generate hosting files                                         |
| `dashboard assets --out DIR`                                                   | Copy the prebuilt dashboard pages for static hosting           |

Every option of every command is in the [command reference](COMMAND-REFERENCE.md).
