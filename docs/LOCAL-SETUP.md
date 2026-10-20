# Run VisualGuard from source

This guide takes you from a fresh checkout of this repository to every part of VisualGuard: comparing two demo sites, AI, the dashboard, databases, login, reviews, baselines and backups. Each section stands on its own, so you can stop after any of them.

Want to use VisualGuard in your own app instead? See the [npm package guide](NPM-PACKAGE-SETUP.md). For what the product can do, see the [product feature guide](PRODUCT-FEATURES.md). For every option of every command, see the [command reference](COMMAND-REFERENCE.md).

The commands use a macOS/Linux shell (on Windows, use WSL). Run them from the repository root unless a step says otherwise. This guide uses up to three terminals: **A** for the demo sites, **B** for the dashboard, **C** for commands.

## Contents

1. [What you need](#1-what-you-need)
2. [Install and build](#2-install-and-build)
3. [Try the demo without a dashboard](#3-try-the-demo-without-a-dashboard)
4. [Add AI (Gemini or Ollama)](#4-add-ai-gemini-or-ollama)
5. [Run the local dashboard (SQLite)](#5-run-the-local-dashboard-sqlite)
6. [Run a test from the dashboard](#6-run-a-test-from-the-dashboard)
7. [Use PostgreSQL](#7-use-postgresql)
8. [Use MongoDB](#8-use-mongodb)
9. [Login, Google sign-in and users](#9-login-google-sign-in-and-users)
10. [Reviews, approved baselines and visual policies](#10-reviews-approved-baselines-and-visual-policies)
11. [Audit, recovery and backups](#11-audit-recovery-and-backups)
12. [Run a built dashboard or package candidate](#12-run-a-built-dashboard-or-package-candidate)
13. [Try the Next.js example](#13-try-the-nextjs-example)
14. [Develop and test this repository](#14-develop-and-test-this-repository)
15. [Troubleshooting](#15-troubleshooting)
16. [Command cheat sheet](#16-command-cheat-sheet)

## 1. What you need

- Git
- Node.js 22.12 or newer
- pnpm 9 (`corepack enable` installs it)
- Chromium for Playwright (installed in step 2)
- Optional: Docker (for the PostgreSQL or MongoDB examples), a Gemini API key or Ollama (for AI), a Google Cloud project (for Google sign-in)

## 2. Install and build

Clone the repository and go into it.

```bash
git clone https://github.com/ShubhamTiwari909/visualguard-ai-testing.git visualguard && cd visualguard
```

Install pnpm and the dependencies.

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
```

Install the browser VisualGuard uses to take screenshots. On Linux, add `--with-deps` after `install`.

```bash
pnpm --filter visualguard exec playwright install chromium
```

Build the CLI, the report and the dashboard files.

```bash
pnpm --filter visualguard build:dashboard
```

You should see the build finish without errors. The CLI is now `packages/visualguard/dist/cli.js` (check it with `node packages/visualguard/dist/cli.js --version`). Rebuild after you pull new code or change `packages/visualguard`.

## 3. Try the demo without a dashboard

The repository includes two small demo sites, "production" and "staging". The staging button has a different color. This section needs no dashboard, database, token or AI key.

In **terminal A**, start the sites and leave them running.

```bash
node scripts/serve-fixtures.mjs
```

You should see two lines with `http://127.0.0.1:4100` (production) and `http://127.0.0.1:4101` (staging). Open `http://127.0.0.1:4100/color-change` and the same path on port 4101 to see the difference.

In **terminal C**, create a config file for the demo.

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

Check that the config is valid and both sites answer.

```bash
node packages/visualguard/dist/cli.js doctor --config output/local-demo.json
```

You should see passing checks for Playwright, the config and both URLs.

See which URL pairs would be compared, without taking screenshots.

```bash
node packages/visualguard/dist/cli.js test --config output/local-demo.json --list
```

Run the comparison.

```bash
node packages/visualguard/dist/cli.js test --config output/local-demo.json --no-ai
```

Open the report. It runs a local server; press Ctrl+C when you are done.

```bash
node packages/visualguard/dist/cli.js report --config output/local-demo.json
```

You should see the reference, candidate and diff images for the color change, usually with a **Review** status.

To try other pages, add more routes: `/identical`, `/hidden`, `/alignment`, `/dynamic-change` and more (see `fixtures/site/production`). Use `report --run RUN_ID` to open an older run, or `report --no-open` to skip opening a browser.

### Exit codes

A non-zero exit code means VisualGuard found something, not that the install failed.

| Code | Meaning |
| --- | --- |
| `0` | The result meets your failure policy. |
| `1` | A regression or error was found, or the result is incomplete. |
| `2` | The config or the command is wrong. |
| `3` | The environment is not ready (browser, URL or AI provider). |

`--fail-on regression` (default) fails on regressions and errors. `--fail-on review` also fails on **Review** statuses. Read the [exit codes page](../apps/docs/src/content/docs/reference/exit-codes.md) for details.

## 4. Add AI (Gemini or Ollama)

AI explains the differences. Without it, VisualGuard still compares images. If an AI call fails, VisualGuard falls back to the normal comparison.

### Gemini

Get a key from [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key). Put it in a file named `.env.local` in the repository root (it is git-ignored).

```dotenv
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Run the comparison with Gemini. `--provider` overrides the demo config's `"provider": "none"`.

```bash
node packages/visualguard/dist/cli.js test --config output/local-demo.json --provider gemini
```

You should see AI explanations next to the findings in the report.

### Ollama (local, no key)

Install [Ollama](https://docs.ollama.com/quickstart), then pull a vision model.

```bash
ollama pull qwen2.5vl
```

Run the comparison with it. Ollama listens on `http://127.0.0.1:11434` by default; set `OLLAMA_HOST` if yours is elsewhere.

```bash
node packages/visualguard/dist/cli.js test --config output/local-demo.json --provider ollama --model qwen2.5vl
```

### Analyze an existing run, or turn AI off

Add AI to a run you already captured, without taking screenshots again.

```bash
node packages/visualguard/dist/cli.js analyze --config output/local-demo.json --provider gemini
```

Add `--no-ai` to any `test` command to turn AI off. Add `--run RUN_ID` to `analyze` to pick an older run, and `--no-cache` to ignore cached answers. More options are in the [Gemini guide](../apps/docs/src/content/docs/guides/ai-gemini.md) and the [Ollama guide](../apps/docs/src/content/docs/guides/ai-ollama.md).

### AI together with a dashboard

AI runs on the machine that takes the screenshots, so the dashboard database does not matter. After you finish step 5, publish a Gemini run like this.

```bash
node packages/visualguard/dist/cli.js test storefront --dashboard http://127.0.0.1:4400 --config output/local-demo.json --provider gemini
```

Use the project ID you created. A dashboard in login mode also needs the project's upload token (step 9). AI never approves a change; people do that in the dashboard.

## 5. Run the local dashboard (SQLite)

The dashboard stores runs, lets a team review them, and can run tests from the browser. Locally it uses SQLite, so you install no database. Keep the demo sites from step 3 running.

### Start it

In **terminal B**, start the development dashboard. The empty values make sure a database URL left in your shell is ignored.

```bash
VISUALGUARD_DATABASE_URL= DATABASE_URL= VISUALGUARD_AUTH_MODE=local pnpm platform:dev
```

Open `http://127.0.0.1:4400`. You should see the dashboard with no projects. Local mode needs no login or token and accepts connections only from your computer.

`pnpm platform:dev` does not read `.env` files, so export any settings in that terminal.

**Or use the packaged command**, the same dashboard the npm package ships. It reads an env file you name:

```bash
cat > .env.visualguard-local <<'ENV'
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=
ENV
```

Start it (instead of `pnpm platform:dev`, not as well).

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-local --host 127.0.0.1 --port 4400
```

Options go before any subcommand. Use `--data-dir DIRECTORY` for another data folder and `--port` for another port. Check it is healthy:

```bash
curl --fail --show-error http://127.0.0.1:4400/api/health
```

You should see `{"status":"ok"}`.

### Create a project and publish a run

In terminal C, create a project.

```bash
node packages/visualguard/dist/cli.js dashboard project create storefront --name "Storefront demo" --server http://127.0.0.1:4400
```

Run the demo and publish the result to the project.

```bash
node packages/visualguard/dist/cli.js test storefront --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

Refresh the dashboard. You should see the run under **storefront**. `test PROJECT` ties one run to a project. Without `--dashboard`, it can write to the runner's own database instead. Add `--branch`, `--commit`, `--pr`, `--environment`, `--deployment` and `--run-name` to label the run.

### Publish or import a run you already have

Replace `RUN_DIRECTORY` with a run folder that contains `manifest.json` (the `test` output prints it).

`publish` uploads through the running dashboard and can retry a saved run without capturing again.

```bash
node packages/visualguard/dist/cli.js dashboard publish RUN_DIRECTORY --project storefront --server http://127.0.0.1:4400
```

`import` writes straight into the local database, using the same settings as the dashboard.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-local import RUN_DIRECTORY --project storefront
```

Repeating identical evidence is skipped, so it is safe to retry.

### What is saved

Everything the dashboard knows lives in `.visualguard/platform/metadata.sqlite`: screenshots, accounts, runs, reviews, baselines and policies. The original files stay in `.visualguard/local-demo-runs/`. Stop the dashboard with Ctrl+C and start it again with the same settings: the history is still there. A different data folder or database is a different, empty workspace.

## 6. Run a test from the dashboard

The dashboard can capture a test itself. The server uses its own Chromium and only checks that you are signed in. In local mode you already are. There is no runner token and no extra process.

1. Open the **storefront** project and choose **Configure tests**.
2. Set **Production / reference URL** to `http://127.0.0.1:4100` and **Staging / candidate URL** to `http://127.0.0.1:4101`.
3. Put `/color-change` under **Routes**, choose AI **None**, and choose **Save test configuration**.
4. Choose **Run test**. The project shows the stage and how many route and viewport comparisons are done.
5. Choose **View result** when it finishes.

You should see a new run in the project's history. A finished test can still contain regressions, so open the result and read it.

Each project keeps its own saved configuration. The URLs must be reachable from the dashboard computer. A saved profile does not change your `--config` files.

### Settings for the built-in runner

It is on by default, except on Vercel. Set these in the dashboard's environment (before starting it).

| Setting | Meaning |
| --- | --- |
| `VISUALGUARD_BUILT_IN_RUNNER=off` | Turn it off, so only private runners can run tests. |
| `VISUALGUARD_BUILT_IN_RUNNER=on` | Turn it on for a host that is not detected as long-running. |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY=2` | How many tests can run at once across projects (default 1). |

If Chromium is missing, the test fails with a message to install it (step 2).

### Optional: a private runner

Use a private runner only when the dashboard cannot reach your app URLs (for example a staging site behind a VPN) or cannot run a browser (Vercel and other serverless hosts). A connected private runner is preferred over the built-in one. In the project, open **Connect a runner for this project** and choose **Create 30-day runner credential**. Save it in an ignored env file.

```bash
cat > .env.visualguard-runner <<'ENV'
VISUALGUARD_RUNNER_TOKEN=YOUR_PROJECT_RUNNER_CREDENTIAL
ENV
```

Start the runner and leave it running.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-runner runner --project storefront --server http://127.0.0.1:4400
```

When the project shows **Runner connected**, choose **Run test**. Options: `--once` (poll once, then exit), `--poll MILLISECONDS` (1000 to 30000) and `--work-dir DIRECTORY`. Read [private runners](../apps/docs/src/content/docs/dashboard/private-runners.md) for limits and credential handling.

## 7. Use PostgreSQL

Use this to store the dashboard in PostgreSQL instead of SQLite. Stop any dashboard on port 4400 first. A new database URL is a new, empty workspace.

If you already have PostgreSQL, create a dedicated database and role, and skip to the env file. Otherwise, start one with Docker.

```bash
docker run --detach --name visualguard-postgres-local \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=visualguard \
  --env POSTGRES_PASSWORD=visualguard_local_only \
  --env POSTGRES_DB=visualguard \
  --volume visualguard_pg_local:/var/lib/postgresql/data \
  postgres:17
```

```bash
docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard
```

You should see `accepting connections`. These credentials are for local use only.

Save the settings in an env file.

```bash
cat > .env.visualguard-postgres <<'ENV'
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard
ENV
```

In terminal B, start the dashboard.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-postgres --host 127.0.0.1 --port 4400
```

You should see the dashboard at `http://127.0.0.1:4400`. VisualGuard creates its own `vg_*` tables, so the database role must be allowed to create them. For hot reload, load the file in the shell first (`set -a; . ./.env.visualguard-postgres; set +a`) and run `pnpm platform:dev`.

In terminal C, create a project and run a test. Only the dashboard needs the database password.

```bash
node packages/visualguard/dist/cli.js dashboard project create source-postgres --name "Source PostgreSQL demo" --server http://127.0.0.1:4400
```

```bash
node packages/visualguard/dist/cli.js test source-postgres --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

Open the run, restart the dashboard with the same file, and confirm the run is still there. You can also run it from the dashboard (step 6). Use `--provider gemini` instead of `--no-ai` for AI.

## 8. Use MongoDB

Use this to store the dashboard in MongoDB. Stop any dashboard on port 4400 first. You need a deployment that supports transactions (Atlas or a replica set) for the full team workflow.

### Option 1: MongoDB Atlas

1. Create or choose an Atlas cluster.
2. Under **Database Access**, create a database user with read/write access to a database named `visualguard`. This is separate from your Atlas website login.
3. Under **Network Access**, add the public IP of the computer running the dashboard.
4. Choose **Connect**, then **Drivers**, and copy the connection string.
5. Replace the user and password, and put `/visualguard` before the `?`.

The URL must include the database name:

```text
mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority
```

A URL that ends at `.mongodb.net/` fails with `MongoDB URL must include a database name`. Encode special characters in the user and password (`@` becomes `%40`), but not the whole URL.

### Option 2: a local replica set with Docker

Start MongoDB as a one-node replica set, then initialise it.

```bash
docker run --detach --name visualguard-mongo-local --publish 127.0.0.1:27017:27017 --volume visualguard_mongo_local:/data/db mongo:7 --replSet rs0 --bind_ip_all
```

```bash
docker exec visualguard-mongo-local mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Your URL is `mongodb://127.0.0.1:27017/visualguard?replicaSet=rs0`. A plain standalone server (no replica set) works for evidence and publishing only if you also set `VISUALGUARD_USER_ADMISSION=legacy`. It cannot do invitations, account linking, baseline changes or administrator recovery.

### Save the settings and start

Create the env file with your real URL.

```bash
cat > .env.visualguard-mongodb <<'ENV'
VISUALGUARD_DATABASE_URL="PASTE_YOUR_MONGODB_URL_HERE"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
ENV
```

In terminal B, start the dashboard with it.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-mongodb --host 127.0.0.1 --port 4400
```

You should see the dashboard at `http://127.0.0.1:4400`. Values already exported in your shell win over the file, so remove a stale `VISUALGUARD_DATABASE_URL` first. For hot reload, use `set -a; . ./.env.visualguard-mongodb; set +a; pnpm platform:dev`.

In terminal C, create a project and run a test.

```bash
node packages/visualguard/dist/cli.js dashboard project create source-mongodb --name "Source MongoDB demo" --server http://127.0.0.1:4400
```

```bash
node packages/visualguard/dist/cli.js test source-mongodb --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

Open the run, restart the dashboard with the same file and confirm the history remains. In Atlas or Compass, look in the `visualguard` database for `vg_projects`, `vg_runs`, `vg_state`, `vg_objects` and `vg_object_chunks`. Running a test from the dashboard (step 6) works the same way.

## 9. Login, Google sign-in and users

Local mode has no login. Use login mode to test passwords, Google and multiple users. This runs in a fresh workspace so it is not mixed with your local-owner data. For all details see [login](../apps/docs/src/content/docs/dashboard/login.md), [Google sign-in](../apps/docs/src/content/docs/dashboard/google-sign-in.md) and [people and permissions](../apps/docs/src/content/docs/dashboard/people-and-permissions.md).

### Password administrator

Stop the dashboard. Create an env file with real private values (a password of 12 to 256 characters). To use PostgreSQL or MongoDB, put its URL in `VISUALGUARD_DATABASE_URL` instead of leaving it empty.

```bash
cat > .env.visualguard-login <<'ENV'
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_USER_ADMISSION=invite
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_DATABASE_URL=
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='REPLACE_WITH_A_UNIQUE_PASSWORD'
ENV
```

Start the dashboard with a fresh data folder.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-login --data-dir "$PWD/.visualguard/team-demo" --host 127.0.0.1 --port 4400
```

Open exactly `http://127.0.0.1:4400` and sign in. You should see the dashboard as the administrator. The administrator is created once: changing the password in the file later does not change the saved account.

In the dashboard, create the project `storefront` under **People & integrations**, then create a project upload token and save it. In login mode, publishing needs this token, even on localhost.

```bash
export VISUALGUARD_UPLOAD_TOKEN='YOUR_PROJECT_UPLOAD_TOKEN'
```

```bash
node packages/visualguard/dist/cli.js test storefront --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

A token can publish only to its own project. It cannot create projects or manage users. **Run test** in the dashboard (step 6) needs only a signed-in maintainer or administrator, not a token.

### Google sign-in and account linking

1. In Google Cloud, set up the Google Auth Platform and create a **Web application** OAuth client. If the audience is "testing", add the Google accounts that will sign in.
2. Register the redirect URI `http://127.0.0.1:4400/api/auth/callback` exactly.
3. Add all three values to `.env.visualguard-login`, then restart the dashboard.

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET='YOUR_GOOGLE_CLIENT_SECRET'
```

4. Sign in with the password administrator. In **Your sign-in methods**, choose **Link Google account**, prove who you are, and finish Google's page. The account ID and history stay the same. Email text alone never merges accounts.
5. Sign out and choose **Sign in with Google**. You should land on the same account.

Keep a tested password administrator as a way back in. Linking signs out other sessions. All three OIDC values are needed together, and local mode ignores them.

### Users, roles and invitations

In **People & integrations**:

- Create password member accounts and give them project access.
- For Google, create an invitation for an email, project, role and expiry. Copy the link and send it privately (the dashboard sends no email). Open it in a separate browser profile and accept it. Opening the link alone grants nothing.
- Roles: Viewer reads evidence. Reviewer also records visual decisions. Maintainer also manages project access, tokens, baselines and policies. Workspace administrators manage the whole installation.
- Administrators can search users, change roles, disable or restore accounts, reset passwords and revoke sessions or upload tokens. The last active administrator is protected.

## 10. Reviews, approved baselines and visual policies

Use the local-owner dashboard from step 5 (or any signed-in user with the right role). You need a stored run in **storefront**.

### Review a change

1. Open a stored run and choose its color-change check in **Team review / Check reviews**.
2. Compare the screenshots. Add a comment, assign a reviewer and an optional deadline, and look at the **Review inbox**.
3. Choose **Approve visual change**, **Request changes** or **Withdraw decision**, and give a reason.

A decision covers that exact evidence only. A comment or an offline `accept` file is not a shared approval. See [reviews](../apps/docs/src/content/docs/dashboard/reviews.md).

### Approve a baseline and pull it

1. Make sure the run is complete and every check is approved.
2. Open **Approved baselines**, choose `storefront`, set `main`, and choose the reviewed run.
3. Enter the landed revision and a reason. For this local trial, use your checkout's revision. Create version 1.

Pull the approved version into a new folder.

```bash
node packages/visualguard/dist/cli.js dashboard baseline pull main --project storefront --version 1 --out .visualguard/approved-v1
```

Add `--server URL` (and the upload token) for a hosted or login dashboard. Create a config that compares staging against it.

```bash
cat > output/approved-demo.json <<'JSON'
{
  "mode": "baseline",
  "baseURL": { "staging": "http://127.0.0.1:4101" },
  "routes": ["/color-change"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" },
  "stabilize": { "freezeTime": "2026-01-01T00:00:00Z" },
  "baseline": { "dir": ".visualguard/approved-v1", "missing": "error" }
}
JSON
```

Compare and publish a new run.

```bash
node packages/visualguard/dist/cli.js test storefront --dashboard http://127.0.0.1:4400 --config output/approved-demo.json --branch main --commit "$(git rev-parse HEAD)" --no-ai
```

You should see a match, because staging is unchanged. Without the project name and `--dashboard`, the same config compares offline. Approved baselines cannot be overwritten, and `--update-baselines` will not touch them. More in [approved baselines](../apps/docs/src/content/docs/dashboard/approved-baselines.md).

### Local baselines without a dashboard

To keep your own reference images instead, use a config with `"mode": "baseline"` and its own `baseline.dir`, then run `test` with `--update-baselines` once and plain `test` afterwards. Read the [local baselines guide](../apps/docs/src/content/docs/guides/local-baselines.md) first. Do not point `--update-baselines` at a pulled approved baseline: that folder cannot be overwritten.

### Visual policies

1. Open **Visual regression policy** and choose `storefront`.
2. Start in **Informative** mode. Choose baseline `main`, target branch `main`, environment `staging`, an evidence lifetime and the approval rules. Leave the GitHub repository blank.
3. Save with a reason, choose a fresh comparison and choose **Assess current policy**. Unchanged evidence should be satisfied.

Assess from the command line.

```bash
node packages/visualguard/dist/cli.js dashboard policy assess --project storefront --revision "$(git rev-parse HEAD)"
```

Add `--server URL` for a hosted dashboard, `--run RUN_ID` for a specific run, and `--enforce` to fail unless the policy is satisfied. Errors always fail. To refresh GitHub checks for pull requests, use `dashboard policy reconcile --project storefront --pr NUMBER` or `--all` with `--server`. GitHub setup is in [GitHub checks](../apps/docs/src/content/docs/ci/github-checks.md) and [visual policies](../apps/docs/src/content/docs/dashboard/visual-policies.md).

Maintainers can rename projects and runs. Deleting needs confirmation and keeps evidence that other things still use. Deleted project IDs stay reserved.

## 11. Audit, recovery and backups

Administrators open **Audit & recovery** at `/operations` in the dashboard to see the audit history and a readiness summary.

### Back up and restore evidence

Export a portable copy of projects and runs. It does not include accounts or sign-in data.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-local export /absolute/path/team-evidence.vgbackup.gz
```

Restore it into a fresh workspace. It merges evidence and never overwrites existing evidence.

```bash
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-local --data-dir "$PWD/.visualguard/review-workspace" restore /absolute/path/team-evidence.vgbackup.gz
```

### Native backups

A portable export does not restore accounts or the whole installation. For that, use a native backup and test a restore into a separate, empty destination.

- SQLite: stop the dashboard, then back up the whole data folder.
- PostgreSQL: use `pg_dump` or your provider's backups. For the Docker example in step 7:

```bash
docker exec visualguard-postgres-local pg_dump -U visualguard -d visualguard -Fc > visualguard-native.dump
```

- MongoDB: use Atlas backups or MongoDB's `mongodump`.

See [storage and backups](../apps/docs/src/content/docs/deployment/storage-and-backups.md).

### Host-side inspection

These commands read the operational storage directly. Set the same database or data folder as the running dashboard first, then run them from the repository root.

| Command | What it shows |
| --- | --- |
| `pnpm platform:operations status` | Storage and readiness summary |
| `pnpm platform:operations admins` | Administrators (continue with `admins --after CURSOR` if a `nextCursor` is printed) |
| `pnpm platform:operations preview --user ACCOUNT_ID` | One account and its current version, without its password hash |

### Recover a password administrator

Use this only if you are locked out. Stop the dashboard, take a native backup and run `preview` for the account to get its `PREVIEW_VERSION`. On a Mac or Linux host, create a private file outside the repository (mode `600`) containing one new password of 12 to 256 characters. Then run:

```bash
pnpm platform:operations recover --user ACCOUNT_ID --version PREVIEW_VERSION --confirm ACCOUNT_ID --backup-confirmed --reason "Restore administrator access after an incident" --password-file /absolute/private/path/recovery-password
```

Restart, sign in, then delete the password file. Old sessions and upload tokens are revoked. Recovery cannot add a password to a Google-only account or create users. Read [operations and recovery](../apps/docs/src/content/docs/deployment/operations-and-recovery.md) before you use it for real.

## 12. Run a built dashboard or package candidate

### Built dashboard

`pnpm platform:dev` is for development. To serve the compiled dashboard, build it, then start it with its settings exported in that terminal. Direct links such as `/operations` only work here; in development, open pages from the sidebar.

```bash
pnpm platform:build
```

```bash
pnpm platform:start
```

### Hosting files

Copy the prebuilt dashboard files for static or serverless hosting.

```bash
node packages/visualguard/dist/cli.js dashboard assets --out output/dashboard-assets
```

Generate a starter project for Cloud Run (use `--target vercel` for Vercel). It writes files only; it does not deploy.

```bash
node packages/visualguard/dist/cli.js dashboard init --target cloud-run --out output/cloud-run-dashboard
```

Next steps: [Cloud Run](../apps/docs/src/content/docs/deployment/cloud-run.md) and [Vercel](../apps/docs/src/content/docs/deployment/vercel.md).

### Package candidate

To test your source as an npm package before publishing, pack it and install the `.tgz` in a separate test project.

```bash
mkdir -p output/package-candidate && pnpm --dir packages/visualguard pack --pack-destination "$PWD/output/package-candidate"
```

These repository checks do the same in a temporary folder:

| Command | What it checks |
| --- | --- |
| `pnpm test:pack` | The packed CLI installs and runs |
| `pnpm platform:test:package` | The packed dashboard installs and starts in a fresh project |
| `pnpm platform:test:runner` | A real dashboard-to-browser test against temporary local sites |

## 13. Try the Next.js example

The `examples/nextjs` app lets you watch VisualGuard find and fix real regressions. Do step 2 first. It uses ports 3100 and 3101, and each numbered command below runs in its own terminal inside `examples/nextjs`.

Start "production" (port 3101) from good code, and leave it running.

```bash
cd examples/nextjs && pnpm build && pnpm start
```

Add three regressions to the source, then start "staging" (port 3100) and leave it running.

```bash
cd examples/nextjs && pnpm seed && pnpm dev
```

In a third terminal, compare the two.

```bash
cd examples/nextjs && npx --no-install visualguard test
```

You should see the alignment, color and spacing changes. Open them with `npx --no-install visualguard report`. Then repair them. This puts back the classes production renders and checks each page again on port 3100.

```bash
npx --no-install visualguard fix --include-review
```

Look at the result with `git diff`. Run `pnpm unseed` to undo the seeded regressions and start over, and `npx --no-install visualguard watch` to re-test pages while you edit components. The Tailwind fixes need no AI. See the [example guide](../apps/docs/src/content/docs/guides/nextjs-example.md) and `examples/nextjs/README.md`.

## 14. Develop and test this repository

Run these from the repository root. [CONTRIBUTING.md](../CONTRIBUTING.md) has the full flow; the other background is in [architecture](../apps/docs/src/content/docs/contributing/architecture.md), [reading the code](READING-THE-CODE.md) and [testing](../apps/docs/src/content/docs/contributing/testing.md).

| Command | What it does |
| --- | --- |
| `pnpm --filter visualguard build:dashboard` | Rebuild the CLI, report and dashboard files |
| `pnpm test` | Run the package tests |
| `pnpm --filter visualguard exec vitest run test/reliability.test.ts` | Run one test file while you work |
| `pnpm platform:test` | Run the dashboard tests |
| `pnpm lint` | Check code style |
| `pnpm typecheck` | Check types in the package and the dashboard |
| `pnpm format:check` | Check formatting (`pnpm format` fixes it) |
| `pnpm test:pack` | Check the packed npm artifact |
| `pnpm eval` | Score the detector on the demo pages (builds first) |
| `pnpm docs:test` | Check the documentation website content |
| `pnpm changeset` | Describe a user-facing change |

For `pnpm eval`, add `-- --provider gemini` (needs `GEMINI_API_KEY`) or `-- --provider ollama --model qwen2.5vl` to try AI. See `evals/README.md`.

## 15. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Executable doesn't exist` or a missing browser | Run the Chromium install from step 2. On Linux, add `--with-deps`. |
| `Cannot find module` pointing at `packages/visualguard/dist` | Run `pnpm --filter visualguard build:dashboard` from the repository root. |
| A command or page is missing | You are on an old build. Pull, reinstall and rebuild (step 2). |
| Connection refused on port 4100 or 4101 | Start the demo sites with `node scripts/serve-fixtures.mjs` and keep that terminal open. |
| `Cannot bind dashboard project: fetch failed` | The dashboard is not running at that address. Start it, check `curl http://127.0.0.1:4400/api/health`, and use the same port in `--server` and `--dashboard`. |
| Dashboard shows no projects or runs | Use the same dashboard URL, database and data folder everywhere. Pass `--dashboard http://127.0.0.1:4400` to `test`. |
| Port 4400 is already in use | Stop the other dashboard, or use `--port` (packaged) or `VISUALGUARD_PLATFORM_PORT` (development), and use that port in every URL. |
| The dashboard uses the wrong database | Start it with `VISUALGUARD_DATABASE_URL= DATABASE_URL=` for SQLite, or pass the right `--env-file`. Exported shell values beat the file. |
| `MongoDB URL must include a database name` | Put `/visualguard` before the `?` in the URL. |
| MongoDB timeout or authentication failure | Check the Atlas IP access list, the database user and the URL-encoded password. |
| `role "USER" does not exist` (PostgreSQL) | Put the real user and password in `VISUALGUARD_DATABASE_URL`. |
| Token rejected | In login mode, use the project's own upload token, even on localhost. |
| Google `redirect_uri_mismatch` | Match scheme, host, port and `/api/auth/callback` exactly. Do not mix `localhost` and `127.0.0.1`. |
| **Run test** is disabled or fails to start | Save the project's test configuration first. Check Chromium is installed and both URLs open from the dashboard computer. |
| Test says the browser is unavailable | Install Chromium on the dashboard computer (step 2), or connect a private runner. |

For more, see [dashboard troubleshooting](../apps/docs/src/content/docs/troubleshooting/dashboard.md), [capture troubleshooting](../apps/docs/src/content/docs/troubleshooting/capture.md) and [installation troubleshooting](../apps/docs/src/content/docs/troubleshooting/installation.md).

## 16. Command cheat sheet

In the commands below, `vg` stands for `node packages/visualguard/dist/cli.js`. Every command also supports `--help`.

| Command | What it does |
| --- | --- |
| `node scripts/serve-fixtures.mjs` | Start the demo sites on ports 4100 and 4101 |
| `vg URL [URL2]` | Scan one site, or compare two URLs, with no config |
| `vg init` | Create `visualguard.config.ts` (add `--workflow` for a GitHub workflow) |
| `vg doctor --config FILE` | Check Playwright, the config, the URLs and AI |
| `vg test --config FILE` | Capture, compare and save a run |
| `vg test --config FILE --list` | Show the planned URL pairs without capturing |
| `vg test --config FILE --no-ai` | Compare without AI |
| `vg test --config FILE --provider gemini` | Compare with Gemini (`ollama` needs `--model`) |
| `vg test PROJECT --dashboard URL --config FILE` | Capture and publish to a dashboard project |
| `vg test --shard 1/4` then `vg merge PATHS...` | Split a run into parts and join the results |
| `vg report [--run ID]` | Open the HTML report (`--no-open`, `--no-serve`, `--port`) |
| `vg analyze [--run ID]` | Add AI to a saved run without capturing again |
| `vg accept [ROUTES...]` | Mark changes as intentional (`--all`, `--note`) |
| `vg fix [ROUTES...]` | Propose, apply and verify fixes (`--include-review`, `--auto`, `--pr`) |
| `vg watch [ROUTES...]` | Re-test changed routes while you edit |
| `vg monitor [URL]` | Compare a live site with its own earlier capture (`--reset`, `--workflow`) |
| `vg auth ENV` | Log in once in a browser and save the session |
| `vg comment` | Post the result on a GitHub pull request (`--dry-run`) |
| `vg dashboard --env-file FILE` | Start the dashboard (`--host`, `--port`, `--data-dir`, `--file`) |
| `vg dashboard project create ID --name NAME --server URL` | Create a dashboard project |
| `vg dashboard import RUN_DIR --project ID` | Save a run straight into the database |
| `vg dashboard publish RUN_DIR --project ID --server URL` | Upload a saved run to a running dashboard |
| `vg dashboard runner --project ID --server URL` | Connect a private runner (optional) |
| `vg dashboard baseline pull SET --project ID --out DIR` | Download an approved baseline |
| `vg dashboard policy assess --project ID` | Check a visual policy (`--enforce`) |
| `vg dashboard policy reconcile --project ID --pr N` | Refresh GitHub checks (`--all`) |
| `vg dashboard export FILE` | Save a portable evidence backup |
| `vg dashboard restore FILE` | Merge a portable backup into a workspace |
| `vg dashboard assets --out DIR` | Copy the prebuilt UI for static hosting |
| `vg dashboard init --target vercel\|cloud-run` | Generate a hosting project |
| `pnpm platform:dev` | Start the dashboard with hot reload |
| `pnpm platform:build` then `pnpm platform:start` | Build and serve the dashboard |
| `pnpm platform:operations status\|admins\|preview\|recover` | Inspect or recover the dashboard storage |
| `pnpm test`, `pnpm platform:test` | Run the package and dashboard tests |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check` | Check style, types and formatting |
| `pnpm test:pack`, `pnpm eval` | Check the packed package; score the detector |

For every flag and default, see the [command reference](COMMAND-REFERENCE.md).
