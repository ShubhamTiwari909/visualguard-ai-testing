---
title: "Run from source locally"
description: "Clone VisualGuard, build it from source and walk through every local flow: comparisons, AI, dashboards on SQLite, PostgreSQL and MongoDB, team features and dashboard-run tests."
audience: "contributor"
docType: "tutorial"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/LOCAL-SETUP.md", "package.json", "apps/platform/package.json", "scripts/serve-fixtures.mjs", "apps/platform/server/dev.ts", "apps/platform/server/runtime.ts", "apps/platform/server/config.ts", "apps/platform/server/built-in-runner.ts", "apps/platform/server/test-runner.ts", "apps/platform/server/test-executions.ts", "apps/platform/server/operations-command.ts", "apps/platform/client/project-tests.tsx"]
sidebar: {"order": 1}
---

This tutorial runs VisualGuard from a clone of this repository, on your own computer. It walks through every local flow, from a first offline comparison to a team dashboard on PostgreSQL or MongoDB with sign-in, reviews, baselines and dashboard-run tests.

Use it when you want to develop VisualGuard, or try features that are merged but not yet on npm. To add the published package to your own app instead, follow [install VisualGuard](/start/install/). For a tour of what the product does, read [how VisualGuard works](/concepts/how-it-works/).

## Before you start

- **Git**, to clone the repository.
- **Node.js 22.22 or newer** on an even-numbered release; Node 24 is recommended. The engine alone needs only 22.12, but the full workspace includes the docs site, which needs 22.22.
- **pnpm 9.0.0**. Step 1 shows how to turn it on with Corepack.
- About 1 GB of disk space for dependencies and the Chromium browser.
- Optional, only for the sections that use them: [Docker](https://docs.docker.com/get-started/get-docker/) for PostgreSQL, a [MongoDB Atlas](https://www.mongodb.com/atlas) account, a Google Cloud project for Google sign-in, a Gemini API key or [Ollama](https://ollama.com/) for AI.

Run every command from the **repository root** unless a step says otherwise. Examples use macOS/Linux shells; on Windows use WSL. The CLI and dashboard also run on Windows itself, but host-side password recovery (step 10) needs a macOS or Linux host.

### How the pieces fit together

A local trial uses up to three separate processes. Open three terminals and keep them open.

| Terminal | Runs | Needed for |
| --- | --- | --- |
| **A** | The demo "production" and "staging" websites on ports 4100 and 4101. | Every step after step 2. |
| **B** | The dashboard on port 4400. | Steps 5 to 12. Skip it for offline comparisons. |
| **C** | The `visualguard` commands that capture and compare pages. | Every comparison. |

Starting the dashboard does not start the demo sites and does not take screenshots. Each process does only its own job. AI runs wherever the capture runs, so you can add it to any step without changing the dashboard's database.

## 1. Install and build the repository

Clone the repository, install dependencies and the Chromium browser, and build the CLI with its report and dashboard assets.

```bash
git clone https://github.com/ShubhamTiwari909/visualguard-ai-testing.git visualguard
cd visualguard
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
pnpm --filter visualguard exec playwright install chromium
pnpm --filter visualguard build:dashboard
```

On Linux, Chromium may also need system libraries. Install them with `pnpm --filter visualguard exec playwright install --with-deps chromium`.

You should see the build finish without errors, and a new file at `packages/visualguard/dist/cli.js`. Check it:

```bash
node packages/visualguard/dist/cli.js --version
```

You should see the version from `packages/visualguard/package.json`.

If you already have a clone, start in its root. Use `main` for a stable starting point, or the feature branch you are reviewing. Rebuild with `pnpm --filter visualguard build:dashboard` whenever you change code that `dist/cli.js` uses. The build compiles JavaScript and assets only; it does not run formatting, lint or type checks.

:::note
In this guide, `node packages/visualguard/dist/cli.js` runs the CLI you just built. In an app that installed the npm package, the same commands start with `npx --no-install visualguard` instead.
:::

## 2. Start the demo sites

The repository has small fixture websites in two versions, so you have something to compare. In **terminal A**:

```bash
node scripts/serve-fixtures.mjs
```

You should see:

```text
production http://127.0.0.1:4100
staging    http://127.0.0.1:4101
```

Leave it running. Open `http://127.0.0.1:4100/color-change` and `http://127.0.0.1:4101/color-change`. The button has a different color on staging. That is the deliberate change you will detect.

Now create a configuration file for the demo. This guide uses a hand-written JSON file in `output/`, so it stays separate from the repository's own configs. For a normal app, `visualguard init` writes a `visualguard.config.ts` instead; see [install VisualGuard](/start/install/). Both formats accept the same fields, but a JSON file always needs `--config`.

In **terminal C**:

```bash
mkdir -p output
cat > output/local-demo.json <<'JSON'
{
  "baseURL": {
    "production": "http://127.0.0.1:4100",
    "staging": "http://127.0.0.1:4101"
  },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" },
  "output": { "dir": ".visualguard/local-demo-runs" }
}
JSON
```

| Field | What it does |
| --- | --- |
| `baseURL.production` | The reference site: what the page should look like. |
| `baseURL.staging` | The candidate site: the version you are checking. |
| `routes` | The pages to compare. Add `/identical`, `/hidden`, `/alignment` or `/dynamic-change` to try other cases. |
| `viewports` | The browser window sizes to capture. |
| `ai.provider` | `none` turns AI off. Step 4 turns it on. |
| `stabilize.freezeTime` | Sets the page clock to a fixed time, so clocks and dates do not cause differences. |
| `output.dir` | Where run results are saved. |

## 3. Run a comparison without a dashboard

Compare the two sites and open the report. This needs no dashboard, database, upload token, Google account or AI key. Everything is saved on this computer.

In **terminal C**:

```bash
node packages/visualguard/dist/cli.js test --config output/local-demo.json --no-ai
node packages/visualguard/dist/cli.js report --config output/local-demo.json
```

You should see a summary with one page and a status, usually **review** for this color-only change, and a `Results` line with the run folder. The `report` command starts a local server and opens the report in your browser. Look at the reference, candidate and difference images and the findings. Press Ctrl+C in terminal C to stop the report server.

A non-zero exit code from `test` can mean a regression was found, not that the install is broken. Read the report before you debug the setup. See [exit codes](/reference/exit-codes/).

Useful extra commands:

| Command | What it does |
| --- | --- |
| `node packages/visualguard/dist/cli.js doctor --config output/local-demo.json` | Checks the config and whether both sites are reachable. |
| `node packages/visualguard/dist/cli.js test --config output/local-demo.json --list` | Prints the page pairs it would compare, without capturing. |
| `node packages/visualguard/dist/cli.js report --config output/local-demo.json --run RUN_ID` | Opens an older run instead of the latest. |

## 4. Add AI explanations

AI adds plain-language explanations and helps classify changes. It runs on the computer that captures, independently of any dashboard. Steps 1 and 2 are enough; no dashboard is needed.

### Use Gemini

1. Create a Gemini API key in [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key).
2. Put it in an ignored `.env.local` file in the **repository root** (not in `apps/platform/.env.local`):

   ```dotenv
   GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
   ```

3. Run the comparison with the Gemini provider:

   ```bash
   node packages/visualguard/dist/cli.js test --config output/local-demo.json --provider gemini
   node packages/visualguard/dist/cli.js report --config output/local-demo.json
   ```

You should see AI analysis in the report's findings.

`--provider gemini` overrides `"provider": "none"` in the demo config. Removing `--no-ai` alone is not enough, because the config still turns AI off. The CLI reads `.env` and `.env.local` from the folder you run it in, and variables already set in your shell win. This API key has nothing to do with Google sign-in (step 8).

If the key, quota, model or network fails, VisualGuard falls back to its built-in rules and still produces a report. So a saved report alone does not prove the AI call worked; check the findings. Two config options change how AI is used:

| Option | What it does | Default |
| --- | --- | --- |
| `ai.analyze` | `"uncertain"` sends only unclear changes to AI. `"all"` also explains clear regressions. | `"uncertain"` |
| `ai.advisory` | `true` keeps the rule-based status and adds the AI explanation alongside it. | `false` |

### Use a local Ollama model

[Install and start Ollama](https://docs.ollama.com/quickstart), then download a vision model, such as [Qwen2.5-VL](https://ollama.com/library/qwen2.5vl):

```bash
ollama pull qwen2.5vl
```

Keep Ollama running (start it with `ollama serve` if the app did not). In **terminal C**:

```bash
export OLLAMA_HOST=http://127.0.0.1:11434
node packages/visualguard/dist/cli.js test \
  --config output/local-demo.json --provider ollama --model qwen2.5vl
```

You should see the run finish with AI analysis. A local model needs enough memory and CPU or GPU, but no API key. Use `--no-ai` to go back to rule-based comparison only.

### Combine AI with a dashboard

After you start a dashboard and create a project (steps 5 to 7), run with your AI settings in **terminal C**:

```bash
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --provider gemini
```

Use the project ID you created (`storefront`, `source-postgres` or `source-mongodb`). A dashboard in login mode also needs the project's upload token (step 8). AI does not need database credentials. It never approves a change and never fills in missing evidence.

## 5. Run a dashboard with SQLite

The **dashboard** is a web app that stores runs and lets a team review them. With SQLite, it saves everything in one file on disk, so you do not install a database server.

### Start the dashboard

In **terminal B**, clear any database settings and choose a separate data folder:

```bash
export VISUALGUARD_DATABASE_URL="" DATABASE_URL=""
export VISUALGUARD_DASHBOARD_URL="" VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-dev"
pnpm platform:dev
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. Open it. Keep this terminal running.

| Setting | What it does | Default |
| --- | --- | --- |
| `VISUALGUARD_AUTH_MODE` | `local` trusts the person at this computer as the workspace owner. No login and no upload token. Only works on a loopback address such as `127.0.0.1`. `login` turns on accounts (step 8). | `local` |
| `VISUALGUARD_PLATFORM_DATA_DIR` | The folder for the SQLite file and stored objects. Use an absolute path. | `.visualguard/platform` in the folder you ran the command from |
| `VISUALGUARD_DATABASE_URL` | A PostgreSQL or MongoDB address. Empty means SQLite. | empty |
| `VISUALGUARD_PLATFORM_PORT` | The port for `platform:dev` and `platform:start`. | `4400` |

`pnpm platform:dev` runs the dashboard API and its web client with live reload. It does not start the demo sites or take screenshots.

### Create a project and publish a run

A **project** groups the runs of one app. In **terminal C**, use the **same** data folder as terminal B:

```bash
export VISUALGUARD_DATABASE_URL="" DATABASE_URL=""
export VISUALGUARD_DASHBOARD_URL="" VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-dev"
node packages/visualguard/dist/cli.js dashboard project create storefront --name "Storefront demo"
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 \
  --config output/local-demo.json \
  --branch main --commit "$(git rev-parse HEAD)" --no-ai
```

You should see the project **Storefront demo** in the dashboard, with one run. Open the run and its comparison viewer.

Naming a project in `test storefront` binds this run to that project and uploads its evidence to the dashboard given by `--dashboard`. Without a project, `test` stays offline.

To upload the offline run from step 3 instead, replace `RUN_DIRECTORY` with the run folder that contains `manifest.json`:

```bash
node packages/visualguard/dist/cli.js dashboard import RUN_DIRECTORY \
  --project storefront --branch main --commit "$(git rev-parse HEAD)"
```

Only use a branch and commit that really describe the captured pages. Importing the same evidence twice is ignored. Changed evidence cannot overwrite an existing run.

### Know what is saved

In this example the database is `.visualguard/platform-dev/metadata.sqlite`. Screenshots, page structure, accounts, runs, reviews, baselines, policies and dashboard state are all stored there. The original run folders stay in `.visualguard/local-demo-runs/` on their own. Restart the dashboard with the same folder and your history is still there.

## 6. Run a dashboard with PostgreSQL

Use this when you want the dashboard's runs, images and team state in PostgreSQL. Offline comparisons still need no database. Keep terminal A running and stop the dashboard in terminal B before you switch databases.

If you already have PostgreSQL, skip the container and use your own dedicated database address. Otherwise, start one with Docker:

```bash
docker run --detach --name visualguard-postgres-local \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=visualguard \
  --env POSTGRES_PASSWORD=visualguard_local_only \
  --env POSTGRES_DB=visualguard \
  --volume visualguard_pg_local:/var/lib/postgresql/data \
  postgres:17

docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard
```

You should see `accepting connections`. If you created this container while following another guide, reuse it; do not start a second one on the same port. This password and loopback-only port are for local development, not production.

### Start the dashboard on PostgreSQL

In **terminal B**:

```bash
export VISUALGUARD_DATABASE_URL='postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard'
export DATABASE_URL="" VISUALGUARD_PUBLIC_URL=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-postgres-dev"
pnpm platform:dev
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. On first start, the dashboard creates its `vg_*` tables, so the database user needs permission to create them. Screenshots and history are stored in PostgreSQL.

### Create a project and run a test

In **terminal C**, talk to the running dashboard with `--server` and `--dashboard`, so this terminal never needs the database password:

```bash
node packages/visualguard/dist/cli.js dashboard project create source-postgres \
  --name "Source PostgreSQL demo" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test source-postgres \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

You should see the run in the dashboard. Restart the dashboard with the same address and check that the run is still there. For AI, use the flags from step 4 instead of `--no-ai`. Local mode needs no upload token; login mode does.

## 7. Run a dashboard with MongoDB

Use this when you want dashboard storage in MongoDB. This guide uses MongoDB Atlas, so you need no Docker or local replica set. If you already have a MongoDB deployment that supports transactions, use its address instead.

### Get the connection address

1. Create or select an Atlas cluster.
2. Create a database user with read and write access to a database named `visualguard`.
3. Under **Network Access**, allow this computer's current public IP address.
4. Copy the address from **Connect → Drivers**. Put in the database user's name and password, and add `/visualguard` before the `?`.

See [Atlas connection instructions](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) or [the MongoDB deployment guide](/deployment/mongodb/). The database user is not your Atlas website login. URL-encode special characters in the password, for example `@` becomes `%40`.

### Save the settings and start the dashboard

Create an ignored `.env.visualguard` file in the repository root:

```dotenv
VISUALGUARD_DATABASE_URL="mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
```

Replace the example with your real address. Keep the database name: an address that ends at `.mongodb.net/` fails with `MongoDB URL must include a database name`. VisualGuard creates its collections itself.

Stop any dashboard on port 4400. In **terminal B**, start the built dashboard with the file:

```bash
node packages/visualguard/dist/cli.js dashboard \
  --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. Leave it running.

`--env-file` loads the file for this process. Variables already exported in your shell win over the file, so clear old database settings first. For live reload while you develop, load the file into the shell and use `pnpm platform:dev` instead. The development server does not read the file by itself.

```bash
set -a; . ./.env.visualguard; set +a
pnpm platform:dev
```

### Create a project and run a test

Keep the demo sites from step 2 running in terminal A. In **terminal C**:

```bash
node packages/visualguard/dist/cli.js dashboard project create source-mongodb \
  --name "Source MongoDB demo" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test source-mongodb \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

You should see the run and its images in the dashboard. Restart the dashboard with the same file and check the history is still there. In Atlas or MongoDB Compass, the `visualguard` database has `vg_projects`, `vg_runs`, `vg_state`, `vg_objects` and `vg_object_chunks`. Only the dashboard needs the MongoDB credentials.

:::caution
A different database address is a different workspace. It does not move your existing history. The full team workflow needs a MongoDB deployment with transactions, such as Atlas or another replica set. A standalone MongoDB server needs `VISUALGUARD_USER_ADMISSION=legacy` and cannot support invitations, Google account linking, user management, baseline changes or administrator recovery.
:::

## 8. Turn on login, Google sign-in and more users

### Password login

Stop the dashboard in terminal B. Create an ignored `apps/platform/.env.local` file with your own private values:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_USER_ADMISSION=invite
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='use-a-unique-password-of-12-to-256-characters'
```

| Setting | What it does |
| --- | --- |
| `VISUALGUARD_AUTH_MODE=login` | Requires sign-in for people and an upload token for the CLI, even on this computer. |
| `VISUALGUARD_USER_ADMISSION` | `invite` lets new people in only through an invitation. `legacy` keeps older open behavior. |
| `VISUALGUARD_PUBLIC_URL` | The exact address people open. Sign-in cookies and Google callbacks use it. |
| `VISUALGUARD_ADMIN_EMAIL`, `VISUALGUARD_ADMIN_PASSWORD` | Create the first administrator, once. |

Start with a **fresh, separate** workspace, so this trial does not mix with the local-mode data. In **terminal B**:

```bash
set -a
. apps/platform/.env.local
set +a
export VISUALGUARD_DATABASE_URL="" DATABASE_URL=""
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/team-demo"
pnpm platform:dev
```

You should see the sign-in page at `http://127.0.0.1:4400`. Sign in with the administrator email and password.

The source server **never loads environment files by itself**. Loading the file in another terminal does not affect this one. To use PostgreSQL or MongoDB, set `VISUALGUARD_DATABASE_URL` to the real address instead of empty.

The administrator is created only once. Changing `VISUALGUARD_ADMIN_PASSWORD` later does not reset the saved account. A new data folder is a new workspace; it is not a way to reset accounts in a real deployment.

Create the `storefront` project with **+ New project**, then open **People & integrations** and choose **Create upload token** for it. Copy the token when it is shown. In login mode, uploads need it, even on this computer. In **terminal C**:

```bash
export VISUALGUARD_UPLOAD_TOKEN='YOUR_PROJECT_UPLOAD_TOKEN'
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

You should see the run in the project. A token can upload only to its own project; it cannot create projects or manage users. Keep real tokens out of shared terminal logs.

### Google sign-in and account linking

1. In your Google Cloud project, set up Google Auth Platform branding and audience, and create an OAuth client of type **Web application**. If the audience is in testing, add the Google accounts that will sign in.
2. Register this exact redirect address: `http://127.0.0.1:4400/api/auth/callback`. A hosted dashboard uses its HTTPS address plus `/api/auth/callback`.
3. Add these values to `apps/platform/.env.local`, load the file again and restart the dashboard:

   ```dotenv
   VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
   VISUALGUARD_OIDC_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
   VISUALGUARD_OIDC_CLIENT_SECRET='YOUR_GOOGLE_CLIENT_SECRET'
   ```

4. Sign in as the password administrator. Under **Your sign-in methods**, choose **Link Google account**, confirm with your current password, and finish the Google steps. This keeps the administrator's account ID and history. A matching email address alone never merges two accounts.
5. Sign out and choose **Sign in with Google**. Check that you land in the same account with the same project access, and that your profile lists both sign-in methods.
6. Keep a working password administrator for recovery. Linking signs out your other sessions, so sign in again in other browsers.

All three `VISUALGUARD_OIDC_*` values are needed together. Leave all three unset to turn Google sign-in off. Half-filled placeholder values can stop the dashboard from starting. Local mode ignores them. See [Google's OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect) and [Google sign-in](/dashboard/google-sign-in/).

### Users, roles and invitations

In **People & integrations**:

- Create password accounts for members when that suits your team, then give them project access.
- For Google users, create an invitation with an email, project, role and expiry. Copy the one-time link and share it privately. The dashboard does not send emails.
- Open the link in a separate browser profile. Sign in as the invited account, look at what access it grants, and accept. Opening the link alone grants nothing. An existing account can accept without changing its ID.
- Check each role. A **Viewer** can read the project's evidence. A **Reviewer** can also comment and decide on visual changes. A **Maintainer** can also manage project access, tokens, baselines and policies. Workspace administrators manage the whole installation.
- Try cancelling, replacing and expiring an invitation, a wrong recipient and an unrelated project. A new identity cannot get past invite-only admission.
- Search and filter users and open their details. Promoting or demoting an administrator is a separate, deliberate action. Disabling, restoring, resetting a password and revoking sessions or upload tokens need your current administrator password and an up-to-date record. The last active administrator cannot be removed.

:::note
These user controls are part of the current source. Do not describe them as part of an older npm release. An existing deployment that has users but no recorded admission policy must take a backup and choose `invite` or `legacy` explicitly when it upgrades, with every dashboard instance upgraded together.
:::

## 9. Review changes, approve baselines and assess policies

The quickest trial uses the local-mode workspace from step 5. Use the same workspace and database in every terminal. These features also work in login mode for users with the right role. See [the local dashboard guide](/dashboard/local/) for the same setup with the npm package.

### Review the exact evidence

1. Open a stored run and select its color-change check. The **Team review** panel opens.
2. Compare the screenshots and findings. Add a comment or a reply, assign an active reviewer and an optional deadline, then open the **Review inbox**.
3. Choose **Approve visual change**, **Request changes** or **Withdraw decision**, and give a reason. If you see a version conflict, refresh and try again.

You should see the decision in the check's history and in the inbox. A decision applies only to that exact evidence. A comment, or a local `accept` file from the CLI, is not a shared approval. Another run needs its own review. Deadlines are entered in UTC and shown in your browser's time zone.

### Promote and pull an approved baseline

An **approved baseline** is a reviewed set of reference screenshots that later runs are compared against.

1. Make sure the candidate run is complete, has its full source commit, captured reliably, and has current approvals for every check.
2. Open **Approved baselines**, select `storefront`, set the name `main`, open the set and choose the reviewed candidate run.
3. Enter the commit that landed and a reason, and confirm the change has landed. For this fixture trial, use the checked-out commit. In real work, wait until the change has really landed.
4. Choose **Promote as new version** to create version 1. Promotion records a maintainer's statement; it does not check Git history or a GitHub merge.
5. Pull the version into a **new** folder:

   ```bash
   node packages/visualguard/dist/cli.js dashboard baseline pull main \
     --project storefront --version 1 --out .visualguard/approved-v1
   ```

   Use the same workspace settings as the dashboard. For a hosted or login dashboard, add `--server` and provide the project's upload token.

Create `output/approved-demo.json`, which compares the staging site against the pulled screenshots:

```json
{
  "mode": "baseline",
  "baseURL": { "staging": "http://127.0.0.1:4101" },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" },
  "baseline": { "dir": ".visualguard/approved-v1", "missing": "error" }
}
```

Compare and publish a new run:

```bash
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/approved-demo.json \
  --branch main --commit "$(git rev-parse HEAD)" --no-ai
```

You should see the unchanged staging page match the approved screenshot. After pulling, `test --config output/approved-demo.json --no-ai` also works fully offline, with no dashboard, token or database. Keep the same browser, operating system, viewport, locale, theme and stabilization settings, or screenshots will differ. Tampered or mismatched approved evidence is rejected, and `--update-baselines` cannot overwrite it.

Each promotion creates a new version that never changes. Restoring an older version creates yet another version. New candidates must be based on the current approved version. Evidence that a baseline uses is protected from normal cleanup.

### Assess a visual policy

A **visual policy** is a rule set that decides whether a commit's visual evidence is good enough to release.

1. Open **Visual regression policy** and select `storefront`.
2. Start in **Informative** mode. Select baseline `main`, target branch `main`, environment `staging`, how long evidence stays fresh, and the approval rules. Leaving the required check IDs empty uses the baseline's checks. Leave the GitHub repository blank for this local trial.
3. Save with a reason, select the run you just captured against the baseline, and choose **Assess current policy**. Unchanged evidence that matches the current baseline should pass without another approval.
4. Now compare the old production design instead, by adding `--staging http://127.0.0.1:4100` to the `test` command above, and assess that new run. Changed screenshots need an exact approval. Capture errors, missing pages, wrong commits, outdated baselines and expired evidence cannot be fixed with a comment.

You can also assess from the CLI against the same local database:

```bash
node packages/visualguard/dist/cli.js dashboard policy assess \
  --project storefront --revision "$(git rev-parse HEAD)"
```

You should see the policy result. Add `--enforce` to make the command fail unless the policy is satisfied. Operational errors always fail. For GitHub checks on pull requests and scheduled reconciliation, see [visual policies](/dashboard/visual-policies/) and the [dashboard overview](/dashboard/overview/). Named journeys are not available yet.

### Rename and delete

Maintainers can change display names, run names and the project's public ID. Old IDs keep working as aliases. `--run-name` sets the name of a new run. Deleting needs explicit confirmation and permission. It keeps evidence that other runs or baselines still use, and it does not delete the original run folders or backups. A deleted project's ID stays reserved, so pick a new ID instead of reusing it.

## 10. Audit, recover and back up

Administrators open **Audit & recovery** at `/operations`. The audit list has filters and **Previous** and **Next** pages. The readiness summary shows the admission policy, transaction support and administrators; it is not a production certification.

### Inspect from the host

These source-only commands connect straight to the dashboard's storage. In the terminal where you run them, set exactly the same database address or absolute data folder as the running dashboard.

```bash
pnpm platform:operations status
pnpm platform:operations admins
pnpm platform:operations preview --user ACCOUNT_ID
```

You should see JSON output. If `admins` returns a `nextCursor`, fetch the next page with `pnpm platform:operations admins --after CURSOR`. `preview` shows the account's current version, never its password hash. Recovery is not an npm command and has no HTTP endpoint.

### Recover a password administrator

1. Stop every dashboard instance and take a native database backup. Confirm which existing password administrator you will recover by ID, and preview their current version.
2. On a macOS or Linux host, create a private password file outside the repository, owned by you, not a symbolic link, with mode `600`. Put one new password of 12 to 256 characters in it. Use an editor, so the password never appears in a shell command.
3. Run the recovery with the exact values from the preview:

   ```bash
   pnpm platform:operations recover \
     --user ACCOUNT_ID --version PREVIEW_VERSION --confirm ACCOUNT_ID \
     --backup-confirmed --reason "Restore administrator access after an incident" \
     --password-file /absolute/private/path/recovery-password
   ```

4. Restart the dashboard and sign in with the new password. Check that old sessions and upload tokens were revoked, and that the audit list shows the recovery. Then delete the password file.

Recovery cannot create or promote users, merge identities, or add a password to a Google-only account. It needs storage with transactions and an up-to-date account version. If only Google administrators exist, restore Google access or restore a native backup; do not edit identity records by hand.

### Back up

| Backup type | What it contains | Use it for |
| --- | --- | --- |
| Native database backup | Everything: accounts, reviews, baselines, policies, dashboard state and images. | Recovering the whole installation. |
| Portable evidence export | Projects, run evidence and images, without accounts or sign-in state. | Sharing evidence offline. Not for recovery. |

For SQLite, stop every dashboard first, then copy the whole data folder, including any separate SQLite file you set with `VISUALGUARD_SQLITE_FILE`. Never copy only the main file while the dashboard is still writing. For PostgreSQL and MongoDB, use the provider's consistent backup tools.

To create a portable export:

```bash
node packages/visualguard/dist/cli.js dashboard export /absolute/path/team-evidence.vgbackup.gz
```

Test a restore into a fresh, separate location, and check accounts, permissions, old screenshots and baseline selection before you rely on a backup. Keep deployment secrets in a separate safe place. Rolling back the code does not roll back a migrated database. See [storage and backups](/deployment/storage-and-backups/).

## 11. Run tests from the dashboard

Each project can store its own test settings, and anyone with the right role can start a capture with **Run test** in the browser.

### Save the project's test settings

1. In the dashboard, select the project and choose **Configure tests**.
2. Fill in the form for this guide's demo:

   | Field | Value |
   | --- | --- |
   | Production / reference URL | `http://127.0.0.1:4100` |
   | Staging / candidate URL | `http://127.0.0.1:4101` |
   | Routes (one per line) | `/color-change` |
   | Viewports (JSON) | `{ "desktop": { "width": 1280, "height": 800 } }` |
   | AI provider | None |

3. Choose **Save test configuration**.

You should see the saved settings in the project. Other projects keep their own settings. Files such as `output/local-demo.json` still control CLI tests separately.

### Run with the built-in runner

In the source checkout, the dashboard runs **Run test** itself. This is the **built-in runner**: the dashboard host captures the pages with its own Chromium, authorized by your sign-in. You need no runner credential. Chromium is already installed from step 1.

Keep terminals A and B running, then choose **Run test**. You should see live stages and a count of finished page-and-viewport comparisons. When it ends, choose **View result** to open the new run.

| Setting | What it does | Default |
| --- | --- | --- |
| `VISUALGUARD_BUILT_IN_RUNNER` | `off`, `false`, `no` or `0` turns the built-in runner off. Any other value turns it on. | On, except on Vercel, where it is off |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` | How many projects can run a dashboard test at the same time. | `1` |

How it behaves:

- Each project runs one test at a time. If the dashboard is busy, **Run test** says to try again shortly.
- A connected private runner always takes priority over the built-in runner.
- If Chromium is missing on the dashboard host, the run fails with a message telling you to run `npx playwright install chromium` there, or to connect a private runner.
- If you choose an AI provider in the test settings, the dashboard process needs the provider's key, such as `GEMINI_API_KEY`, in its environment.
- Each test stops after 15 minutes. Temporary files are deleted after the upload.

In the code, `apps/platform/server/built-in-runner.ts` claims the queued request, and `executeClaimedTest` in `apps/platform/server/test-runner.ts` captures and uploads. The private runner uses the same function.

:::caution
The built-in runner is in the source checkout and in the next release after 3.2.3 only. With the published 3.2.3 package, **Run test** needs a connected private runner.
:::

### Run with a private runner instead

A **private runner** is a `visualguard` process on another computer or CI worker that polls the dashboard for work. Use one when the app's URLs are reachable from that computer but not from the dashboard host.

1. In the project, open **Use a private runner instead** and choose **Create 30-day runner credential**. The credential is shown once.
2. Save it in an ignored `.env.visualguard-runner` file in the repository root:

   ```dotenv
   VISUALGUARD_RUNNER_TOKEN=THE_CREDENTIAL_SHOWN_ONCE
   ```

3. Start the runner from the repository root:

   ```bash
   node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-runner \
     runner --project storefront --server http://127.0.0.1:4400
   ```

4. Choose **Run test** in the dashboard.

You should see the runner terminal pick up the request and the dashboard show progress, then **View result**. Revoke old credentials under **People & integrations → Upload credentials**. See [private runners](/dashboard/private-runners/) for every option and limit.

### Read the progress

The project section shows live stages and how many page-and-viewport comparisons have finished. The percentage counts finished comparisons; it is not a time estimate. Upload and finishing have their own stages without a percentage. Refreshing the page reloads the stored progress. An older runner build shows only a generic running indicator. The result link does not change the run's regression or review status. See [execution progress](/dashboard/execution-progress/).

To test the private-runner path automatically, run `pnpm platform:test:runner` after `pnpm build`. It starts its own dashboard and two small local sites, captures with real Chromium and cleans up. It never connects to a real dashboard or database. See [run the test suites](/contributing/testing/).

## 12. Run a built dashboard or a package candidate

The development server rebuilds the web client on every change. To run the compiled client instead, build it and start the production server, with the same settings loaded in that terminal:

```bash
pnpm platform:build
pnpm platform:start
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. The production server also serves direct links to every page.

To try the current source in another project before it reaches npm, build and pack a **package candidate**:

```bash
pnpm --filter visualguard build:dashboard
mkdir -p output/package-candidate
pnpm --dir packages/visualguard pack --pack-destination "$PWD/output/package-candidate"
```

You should see a `visualguard-<version>.tgz` file in `output/package-candidate`. Install that file by its path in a separate project, for example `npm install --save-dev /absolute/path/to/visualguard-<version>.tgz`. The normal [npm install](/start/install/) needs no tarball or source checkout. A real release goes through [the release process](/contributing/releases/).

## Verify your setup

Check each flow you followed:

- **Offline comparison:** `test` prints a status and a `Results` folder, and `report` opens the report with three images.
- **Dashboard:** `curl http://127.0.0.1:4400/api/health` prints `{"status":"ok"}`, and the project shows your run.
- **Persistence:** after restarting the dashboard with the same data folder or database address, the runs are still there.
- **Login:** an upload without `VISUALGUARD_UPLOAD_TOKEN` is rejected, and with the token it succeeds.
- **Run test:** a dashboard-run test reaches **View result** and creates a new run.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Browser executable is missing | Run `pnpm --filter visualguard exec playwright install chromium`. On Linux, add `--with-deps`. |
| The dashboard history is empty or wrong | Use the same absolute data folder or database address in every terminal. Relative `.visualguard/` paths depend on the folder you run from. Use `test PROJECT --dashboard URL` to target the running dashboard. |
| `role "USER" does not exist` | Replace placeholder credentials with the real PostgreSQL user and password, and make sure that user can create tables in the database. |
| `MongoDB URL must include a database name` | Add `/visualguard` before the `?` in the address. |
| MongoDB times out or rejects the login | Check the Atlas IP access list, the database user and its permissions, and URL-encoding in the password. |
| The dashboard will not start with MongoDB and `invite` | Use a replica set or sharded cluster with transactions, or choose the limited `VISUALGUARD_USER_ADMISSION=legacy` mode on purpose. |
| Google sign-in buttons are missing | Use login mode with all three `VISUALGUARD_OIDC_*` values, load them in the dashboard's own terminal, and restart. |
| Google shows `redirect_uri_mismatch` | Match the scheme, host, port and `/api/auth/callback` exactly. Do not mix `localhost` and `127.0.0.1`. |
| The upload token is rejected | Use the right project's token, the right dashboard address, and an account with access. Login mode needs a token even on this computer. |
| A direct link returns 404 in development | Navigate from the dashboard sidebar, or run the built dashboard with `platform:start`. |
| **Run test** says to connect a runner | The built-in runner is off. Unset `VISUALGUARD_BUILT_IN_RUNNER`, or start a private runner. |
| **Run test** fails with "Chromium is not installed on the dashboard host" | Install Chromium where the dashboard runs, or connect a private runner. |
| A feature is missing in the UI or CLI | Check you are on the right branch and rebuild. Old `dist` folders and npm installs do not update themselves. |
| A baseline or policy is blocked | Read the exact reasons: evidence, commit, coverage, rendering, freshness or approval. Do not relabel old evidence. |

For more, see [dashboard troubleshooting](/troubleshooting/dashboard/) and [capture troubleshooting](/troubleshooting/capture/). For changes to VisualGuard itself, run the focused tests from [run the test suites](/contributing/testing/). The repository's `AGENTS.md` currently defers formatting, lint and type-check commands, so do not report them as passed.

## Command reference

Run these from the repository root after the build in step 1. In an app with the npm package, replace `node packages/visualguard/dist/cli.js` with `npx --no-install visualguard`. The [CLI reference](/reference/cli/) explains every option for both.

### Common source commands

| Command | What it does |
| --- | --- |
| `node scripts/serve-fixtures.mjs` | Starts the demo production and staging sites on ports 4100 and 4101. Keep it running while you capture. |
| `pnpm platform:dev` | Starts the dashboard with live reload. Export its settings in the same terminal first. |
| `pnpm platform:start` | Serves the built dashboard. Run `pnpm platform:build` first and export its settings. |
| `node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard` | Starts the packaged dashboard with settings from a file, for SQLite, PostgreSQL or MongoDB. |
| `node packages/visualguard/dist/cli.js test --config output/local-demo.json --no-ai` | Runs an offline comparison and saves the evidence locally. |
| `node packages/visualguard/dist/cli.js report --config output/local-demo.json` | Opens the latest report. Add `--run RUN_ID` for another run. |
| `node packages/visualguard/dist/cli.js doctor --config output/local-demo.json` | Checks the config and whether the sites are reachable. |
| `node packages/visualguard/dist/cli.js test --config output/local-demo.json --list` | Shows the planned page pairs without capturing. |
| `pnpm platform:operations status` | Shows host-side dashboard status for operators. |
| `node packages/visualguard/dist/cli.js --help` | Lists commands. Every command and subcommand also accepts `--help`. |

The demo sites, the dashboard and the test runner are separate processes. `dashboard init` creates hosting files; `dashboard project create` creates a project inside a running dashboard.

### Create a project and bind a test

With the dashboard running on port 4400:

```bash
node packages/visualguard/dist/cli.js dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai \
  --run-name "Local color-change check"
```

The first command creates `storefront`, or reuses it if it exists; `--name` sets its display name. The second runs the comparison for that project and uploads the evidence. Name the project again on every later test; there is no separate `bind` command. An exact, unique display name also works in place of the ID. Without a project, `test` stays offline.

`--dashboard` sends results to the running dashboard, even when this terminal has different database settings. Without it, `test PROJECT` may write to this terminal's local storage instead. `--server` does the same job for `project create`, `publish` and the other dashboard subcommands. `--config` says what to test; `--dashboard` says where to store the result. Keep database and administrator credentials on the dashboard side.

### Upload an existing run or create hosting files

Replace `RUN_DIRECTORY` with a real run folder that contains `manifest.json`:

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard \
  import RUN_DIRECTORY --project storefront
node packages/visualguard/dist/cli.js dashboard publish RUN_DIRECTORY \
  --project storefront --server http://127.0.0.1:4400
```

`import` writes straight into the configured database. `publish` uploads through the running dashboard and can retry a saved run without capturing again. In login mode, give `publish` the project's upload token in the environment or through an ignored `--env-file`; it does not read `.env.local` by itself.

```bash
node packages/visualguard/dist/cli.js dashboard init --target vercel --out output/vercel-dashboard
node packages/visualguard/dist/cli.js dashboard init --target cloud-run --out output/cloud-run-dashboard
```

Pick one host. `dashboard init` writes files into a new, empty folder. It does not create cloud resources or deploy anything. Follow the [hosting guide](/deployment/overview/).

## Next steps

- [Run the test suites](/contributing/testing/) before you change behavior.
- [Read the architecture](/contributing/architecture/) to see how the engine, dashboard and docs fit together.
- [Learn the codebase](/contributing/reading-the-code/) file by file.
- [Deploy the dashboard](/deployment/overview/) once the local flows work.
