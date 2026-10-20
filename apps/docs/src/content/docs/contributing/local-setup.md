---
title: "Run from source locally"
description: "Clone VisualGuard, build the source runtime and follow the full local fixture and dashboard walkthrough."
audience: "contributor"
docType: "tutorial"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/LOCAL-SETUP.md"]
sidebar: {"order": 1}
---

## Before you start

This is the source workflow. Use **Node 22.22+** when installing the complete workspace including the documentation; Node 24 is used for website verification. The engine itself declares 22.12+. Commands use pnpm 9 and a POSIX shell (WSL for these shell examples on Windows). All source commands below run at the repository root. The source application processes and capture CLI use separate terminals.

For an explanation of all product capabilities before setup, read the [product feature guide](/concepts/how-it-works/).

Use this guide to develop this repository or try the latest merged features on your own computer. To install the published package in another application, use the other final guide: [npm package setup](/start/install/).

Use terminal A for the demo application sites, terminal B for a dashboard, and terminal C for comparison commands. Skip terminal B when running visual regression alone. AI can be added to any comparison without changing the selected dashboard database.

The examples use a macOS/Linux POSIX shell. On Windows, use WSL for these shell/Docker examples. VisualGuard's ordinary CLI/dashboard also support Windows; host-side password-file recovery requires a POSIX host.

## Contents

- [1. Install the repository](#1-install-the-repository)
- [2. Start the production and staging demo](#2-start-the-production-and-staging-demo)
- [3. Run visual regression without a dashboard or database](#3-run-visual-regression-without-a-dashboard-or-database)
- [4. Run source visual regression with AI](#4-run-source-visual-regression-with-ai)
- [5. Run source visual regression with a local SQLite dashboard](#5-run-source-visual-regression-with-a-local-sqlite-dashboard)
- [6. Run source visual regression with PostgreSQL](#6-run-source-visual-regression-with-postgresql)
- [7. Run source visual regression with MongoDB](#7-run-source-visual-regression-with-mongodb)
- [8. Test password login, Google and multiple users](#8-test-password-login-google-and-multiple-users)
- [9. Review changes, baselines and visual policies](#9-review-changes-baselines-and-visual-policies)
- [10. Audit, recovery and backups](#10-audit-recovery-and-backups)
- [11. Run a built dashboard or package candidate](#11-run-a-built-dashboard-or-package-candidate)
- [12. Troubleshooting and checks](#12-troubleshooting-and-checks)
- [13. Command reference](#13-command-reference)

## 1. Install the repository

Prerequisites: Git, Node.js **22.12+**, pnpm **9**, and browser dependencies for Playwright. PostgreSQL/MongoDB and Google credentials are optional.

```sh
git clone https://github.com/ShubhamTiwari909/visualguard-ai-testing.git visualguard
cd visualguard
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
pnpm --filter visualguard exec playwright install chromium
pnpm --filter visualguard build:dashboard
```

If you already have the repository, start in its root. Use merged `main` for a stable starting point or the specific feature branch you are reviewing. The package/dashboard build above emits the CLI and prebuilt report/dashboard assets; it does not run formatting, lint or semantic type checks. Rebuild it after changing source used by `packages/visualguard/dist/cli.js`.

On Linux, Playwright may require system libraries; use its supported installation route, for example `pnpm --filter visualguard exec playwright install --with-deps chromium`.

## 2. Start the production and staging demo

In **terminal A**, from the repository root:

```sh
node scripts/serve-fixtures.mjs
```

Leave it running. Open:

- Production: `http://127.0.0.1:4100/color-change`
- Staging: `http://127.0.0.1:4101/color-change`

The button has a deliberate color difference. These are application pages under test; the dashboard will use port **4400**.

The source fixture walkthrough deliberately uses a manual JSON config at `output/local-demo.json` to keep it separate from repository configs. It does not come from `init`. For a normal application setup, `npx --no-install visualguard init` generates `visualguard.config.ts`; follow the [npm initialization walkthrough](/start/install/). The same config fields work in either format, but JSON needs an explicit `--config` path.

In **terminal C**, also at the repository root, create `output/local-demo.json`:

```sh
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

## 3. Run visual regression without a dashboard or database

In terminal C:

```sh
node packages/visualguard/dist/cli.js test \
  --config output/local-demo.json --no-ai
node packages/visualguard/dist/cli.js report --config output/local-demo.json
```

Inspect the reference/candidate/diff images and findings. The color-only example should show a visual change, commonly **Review**. A nonzero exit can indicate a regression or configured failure policy; read the report before diagnosing an installation failure. `report` starts its own local server; stop it with Ctrl+C when done.

This workflow needs **no dashboard, database, upload token, Google account or AI key**. It writes run evidence on the execution machine. To try other fixture cases, add `/identical`, `/hidden`, `/alignment` or `/dynamic-change` to `routes`.

## 4. Run source visual regression with AI

**Use this section when:** you want AI explanations/classification while running the repository locally. Complete sections 1–2; a dashboard/database is not required. AI runs on the capture machine, independently of where the dashboard stores results.

### Gemini

1. Create a Gemini API key through [Google AI Studio](https://ai.google.dev/gemini-api/docs/api-key).
2. Add the real key to an ignored `.env.local` in the **repository root**, not `apps/platform/.env.local`:

```dotenv
GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
```

3. Run from that root, omitting `--no-ai`:

```sh
node packages/visualguard/dist/cli.js test \
  --config output/local-demo.json --provider gemini
node packages/visualguard/dist/cli.js report --config output/local-demo.json
```

`--provider gemini` overrides the demo configuration's `provider: none`. Only removing `--no-ai` would leave that configuration's AI disabled. The CLI loads the runner's `.env`/`.env.local`; existing process settings take precedence. Google OAuth sign-in credentials are unrelated to this API key.

Inspect the report's findings/analysis. AI is used only where configured/eligible; provider/key/quota/model/network failures fall back to deterministic analysis. A saved report alone does not prove a model call succeeded. To explain deterministic regressions too, set `ai.analyze` to `all` in the demo configuration. To retain deterministic statuses while adding AI explanation, set `ai.advisory` to `true`.

### Local Ollama

Install/start Ollama using its [official instructions](https://docs.ollama.com/quickstart). Use a local vision-capable model, for example the [Qwen2.5-VL model](https://ollama.com/library/qwen2.5vl) supported by this integration:

```sh
ollama pull qwen2.5vl
```

Keep the Ollama service running (use `ollama serve` if it is not already started by the app). In the capture terminal:

```sh
export OLLAMA_HOST=http://127.0.0.1:11434
node packages/visualguard/dist/cli.js test \
  --config output/local-demo.json --provider ollama --model qwen2.5vl
```

A downloaded local model needs adequate resources but no Gemini API key. Requests go to the selected Ollama host. Use `--no-ai` to return to deterministic-only comparison.

### Combine AI with the dashboard

First start a dashboard and create a project using the SQLite, PostgreSQL or MongoDB section below. Then, with provider credentials/service configured in the **runner terminal**:

```sh
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --provider gemini
```

Use the project ID you actually created (`storefront`, `source-postgres` or `source-mongodb`). Login-enabled dashboards also require the project upload token. AI does not need database credentials and does not grant visual approval or bypass missing evidence.

## 5. Run source visual regression with a local SQLite dashboard

SQLite is an embedded database file, so “without a database setup” means **without installing a database service**. The dashboard always persists state somewhere.

### Start the source dashboard

In **terminal B**, from the repository root, select an isolated local workspace explicitly:

```sh
export VISUALGUARD_DATABASE_URL="" DATABASE_URL=""
export VISUALGUARD_DASHBOARD_URL="" VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-dev"
pnpm platform:dev
```

Open `http://127.0.0.1:4400`. Local mode trusts the local computer's workspace owner. It is restricted to loopback and does not require login or an upload token. Keep this terminal running.

The source development command starts the dashboard UI/API; it does not start the fixture websites or run browsers.

### Create a project and publish a new local comparison

In terminal C, use the **same absolute data directory**:

```sh
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

The project-bound test records a new run and publishes it to the running dashboard. Open that run and its comparison viewer.

To import the earlier offline run instead, replace `RUN_DIRECTORY` with the printed directory containing `manifest.json`:

```sh
node packages/visualguard/dist/cli.js dashboard import RUN_DIRECTORY \
  --project storefront --branch main --commit "$(git rev-parse HEAD)"
```

Only use a revision label that actually describes the captured evidence. Repeating identical evidence is deduplicated; changed evidence cannot overwrite an existing run's identity.

### Know what is persisted

This example's database is `.visualguard/platform-dev/metadata.sqlite`. New screenshots/DOM objects, accounts, runs, reviews, baselines, policies and platform state live in that database. The original runner output remains under `.visualguard/local-demo-runs/` independently. Restarting the dashboard with the same directory retains its history.

## 6. Run source visual regression with PostgreSQL

**Use this section when:** you run the VisualGuard repository locally and want the dashboard's runs, images and team state stored in PostgreSQL. Standalone visual regression still needs no database.

Complete sections 1–2 first and leave the fixture sites running in terminal A. Stop the dashboard in terminal B before choosing another backend. If PostgreSQL is already available, skip container creation and substitute its real dedicated database URI. Otherwise, with Docker installed:

```sh
docker run --detach --name visualguard-postgres-local \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=visualguard \
  --env POSTGRES_PASSWORD=visualguard_local_only \
  --env POSTGRES_DB=visualguard \
  --volume visualguard_pg_local:/var/lib/postgresql/data \
  postgres:17

docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard
```

Wait for accepting connections. Reuse this container if you created it from the npm guide; do not create a second container on the same port. The password and loopback binding are a local development example, not production credentials.

### Start the source dashboard with PostgreSQL — terminal B

From the repository root:

```sh
export VISUALGUARD_DATABASE_URL='postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard'
export DATABASE_URL="" VISUALGUARD_PUBLIC_URL=""
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-postgres-dev"
pnpm platform:dev
```

Open `http://127.0.0.1:4400`. The adapter creates its `vg_*` schema using the real database role. New screenshot/DOM objects and platform history are stored in PostgreSQL. The role needs schema initialization permissions.

### Create a project and run the test — terminal C

From the repository root, talk to the running server so this terminal does not need its database credentials:

```sh
node packages/visualguard/dist/cli.js dashboard project create source-postgres \
  --name "Source PostgreSQL demo" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test source-postgres \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

Open the run, inspect both images, restart the dashboard with the same URL and confirm the run remains. For AI, use `--provider gemini` instead of `--no-ai`, following section 4. No upload token is needed for this local-owner trial; login mode requires one.

## 7. Run source visual regression with MongoDB

**Use this section when:** you run the repository locally and want dashboard storage in MongoDB. Complete sections 1–2 first. Use MongoDB Atlas; no Docker or local replica-set setup is needed. If you already have a transaction-capable MongoDB deployment, use its existing URI.

### Get the connection URL

1. Create/select an Atlas cluster.
2. Create a database user with read/write access to a dedicated `visualguard` database.
3. Allow your dashboard computer's current public IP under **Network Access**.
4. Copy the URI from **Connect → Drivers**, replace its credentials and include `/visualguard` before the query string.

See the [Atlas connection instructions](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) or the [npm guide's detailed connection steps](/deployment/mongodb/#get-your-mongodb-url). The database user is separate from your Atlas website login. URL-encode special characters in credentials, such as `@` as `%40`.

### Save settings and start the dashboard — terminal B

Create an ignored `.env.visualguard` in the repository root:

```dotenv
VISUALGUARD_DATABASE_URL="mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
```

Replace the example URI with your real connection string. Keep the explicit database name: a URL ending at `.mongodb.net/` fails with `MongoDB URL must include a database name`. VisualGuard creates its collections automatically.

Stop any dashboard on port 4400. Using the built CLI from section 1, run from the repository root:

```sh
node packages/visualguard/dist/cli.js dashboard \
  --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

Open `http://127.0.0.1:4400` and leave the terminal running. This command loads the file explicitly. Existing exported process settings take precedence; remove stale database settings before starting. For development with UI hot reload, load the same file in the server terminal using `set -a; . ./.env.visualguard; set +a`, then run `pnpm platform:dev` instead. That development server does not load the file automatically.

### Create a project and run the test — terminal C

Keep [the related setup guide](/start/quickstart/)'s fixture websites running in terminal A:

```sh
node packages/visualguard/dist/cli.js dashboard project create source-mongodb \
  --name "Source MongoDB demo" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test source-mongodb \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

The project argument binds this test execution to that dashboard project and publishes the saved evidence. Only the dashboard needs MongoDB credentials. The [source command reference](#13-command-reference) explains the commands and their options.

Open the run and images, restart the dashboard with the same environment file and confirm its history remains. Metadata and uploaded screenshot/DOM artifacts persist in MongoDB. In Atlas or Compass, inspect `vg_projects`, `vg_runs`, `vg_state`, `vg_objects` and `vg_object_chunks` in the `visualguard` database. For AI, replace `--no-ai` with the provider flags from section 4.

A different database URL selects another workspace; it does not migrate existing history. Local-owner mode needs no upload token; login mode does. Atlas or another transaction-capable replica-set/sharded deployment is needed for the full team workflow. An existing standalone MongoDB server requires explicit `VISUALGUARD_USER_ADMISSION=legacy` and cannot support invitations, account linking, managed lifecycle operations, baseline mutations or administrator recovery.

## 8. Test password login, Google and multiple users

### Password login without Google

Stop terminal B. Create an ignored `apps/platform/.env.local` with real private values:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_USER_ADMISSION=invite
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='REPLACE_WITH_A_UNIQUE_12_TO_256_CHARACTER_PASSWORD'
```

Start with a **fresh separate workspace**, so this login trial is not confused with local-owner data:

```sh
set -a
. apps/platform/.env.local
set +a
export VISUALGUARD_DATABASE_URL="" DATABASE_URL=""
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/team-demo"
pnpm platform:dev
```

The source server **does not load environment files automatically**. Sourcing the file in another terminal does not configure this process. To use PostgreSQL/MongoDB, replace the empty database setting above with the real URL.

Open exactly the configured origin and sign in. The password administrator is created once; changing its bootstrap environment password later does not reset the saved account. Creating a new workspace selects new data; it is not a way to reset production accounts.

Create project `storefront` in **People & integrations** and create a project upload token. Because this local server now uses login mode, publishing needs that token too:

```sh
export VISUALGUARD_UPLOAD_TOKEN='YOUR_PROJECT_UPLOAD_TOKEN'
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai
```

Keep real secrets out of shared terminal transcripts. A token can publish only to its project; it cannot create projects or administer users.

### Google sign-in and account linking

1. In the customer's Google Cloud project, configure Google Auth Platform branding/audience and a **Web application** OAuth client. If using a testing audience, add the participating Google accounts.
2. Register the exact redirect URI `http://127.0.0.1:4400/api/auth/callback`. Hosted callbacks use the canonical HTTPS origin plus `/api/auth/callback`.
3. Add these values to the same private environment file, load it again and restart:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET='YOUR_GOOGLE_CLIENT_SECRET'
```

4. Sign in with the existing password admin. In **Your sign-in methods**, choose **Link Google account**, provide current-account proof, and complete Google authorization. This preserves the administrator's account ID/history. Email text alone never merges two accounts.
5. Sign out and choose **Sign in with Google**. Verify the same account and project access. Check the profile/account section for email and sign-in methods.
6. Keep a tested recovery password administrator. Linking revokes earlier sessions; sign in again if another browser session stops working.

All three OIDC values are required together. Blank/unset values disable company login; partially configured placeholders can prevent startup. Local-owner mode intentionally ignores OIDC. [Google's OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect).

### Users, roles and invitation links

In **People & integrations**:

- Create password member accounts when appropriate, then assign project access.
- For Google onboarding, create an invitation for an email, project, role and expiry. Copy/share the one-time link privately; the dashboard does not send invitation emails.
- Open the link in a separate browser profile, verify the invited account, inspect the grant, and explicitly accept. Opening a link alone grants nothing. Existing accounts can prove ownership and accept without changing their account ID.
- Confirm Viewer can read assigned evidence, Reviewer can discuss/decide visual changes, and Maintainer can manage project access/tokens/baselines/policies. Workspace administrators manage the installation.
- Test cancel/replace/expiry, an incorrect recipient and an unrelated project. New identities cannot bypass invite-only admission.
- Search/filter users and inspect details. Admin promotion/demotion is a separate deliberate action. Disable/restore, password reset and session/upload revocation require current administrator proof and fresh record versions; the last active administrator is protected.

Do not describe these current-source controls as part of an older published npm version. Existing deployments must back up and explicitly choose `invite` or `legacy` when migrating from an unrecorded admission policy, with all writers upgraded consistently.

## 9. Review changes, baselines and visual policies

For the shortest local trial, return to the local-owner workspace from [the related setup guide](/dashboard/local/); retain the same workspace/database in each terminal. These features also work with properly authorized users in the login trial.

### Review exact evidence

1. Open a stored run and select its color-change check in **Team review / Check reviews**.
2. Compare the screenshots and findings. Add a comment/reply, assign an active reviewer and optional deadline, then inspect the **Review inbox**.
3. Choose **Approve visual change**, **Request changes** or **Withdraw decision**, with a reason. Refresh after a stale-version conflict.

Decisions apply to exact evidence/check scope. A comment or offline `accept` file is not a shared visual approval. Another run needs its own review. Deadlines are entered in UTC and displayed using the browser's time zone.

### Promote and pull an approved baseline

1. Ensure the candidate run is complete and has its actual full source revision, reliable captures and current exact-evidence approvals for all checks.
2. Open **Approved baselines**, select `storefront` and set `main`, then open the set and choose the reviewed candidate.
3. Enter the actual landed revision and reason, and confirm the source change has landed. For the repository fixture trial, use the checked-out fixture revision; this is only a local demonstration. For real work, wait for the actual change to land.
4. Create version 1. Promotion records a maintainer's attestation; it does not independently prove Git ancestry or a GitHub merge.
5. Pull to a **new** directory:

```sh
node packages/visualguard/dist/cli.js dashboard baseline pull main \
  --project storefront --version 1 --out .visualguard/approved-v1
```

Use the same workspace/database settings. For a hosted/login dashboard, add `--server` and supply the project's upload token. Create `output/approved-demo.json`:

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

Compare and publish a fresh run:

```sh
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/approved-demo.json \
  --branch main --commit "$(git rev-parse HEAD)" --no-ai
```

Unchanged staging should match the approved snapshot. Once pulled, a plain `test --config output/approved-demo.json --no-ai` compares offline, without the dashboard/token/database. Keep the same browser, OS, viewport, locale/theme and stabilization settings. Tampered/incompatible approved evidence is rejected; `--update-baselines` cannot overwrite it.

Further promotions create immutable versions. Restoring an older version creates another version, not rewritten history. New candidates must be based on the current approved reference. Evidence referenced by baselines is protected from ordinary destructive cleanup.

### Assess a visual policy locally

1. Open **Visual regression policy** and select `storefront`.
2. Start in **Informative** mode; select baseline `main`, target branch `main`, environment `staging`, an evidence lifetime and visual approval requirements. Empty required IDs inherit the baseline's checks. Leave GitHub repository blank for this local trial.
3. Save with a reason, select the freshly captured baseline comparison and choose **Assess current policy**. Complete unchanged evidence against the current reference should be satisfied without another change approval.
4. Compare the old production design instead with `--staging http://127.0.0.1:4100`, then assess that new run. Changed screenshots need exact approval; capture errors, missing coverage, wrong revisions, stale baselines and expired evidence cannot be fixed by a comment.

CLI assessment against the same local database:

```sh
node packages/visualguard/dist/cli.js dashboard policy assess \
  --project storefront --revision "$(git rev-parse HEAD)"
```

`--enforce` exits unsuccessfully unless satisfied. Operational errors always fail. For GitHub setup, exact PR-head capture and scheduled reconciliation, see the [final package guide](/dashboard/overview/). Named journeys remain deferred.

### Names and deletion

Maintainers can edit display names/run names and the project's public ID; old IDs remain aliases. `--run-name` labels new project-bound captures. Deletion requires explicit confirmation and permission, preserves evidence shared/referenced elsewhere, and does not erase original runner output or backups. Deleted project IDs remain reserved; create a new ID rather than trying to reuse one.

## 10. Audit, recovery and backups

Administrators open **Audit & recovery** at `/operations`. Audit filters and Previous/Next pages keep history bounded. Readiness summarizes admission, transaction support and administrators; it is not production certification.

### Host-side inspection

These source-only commands connect directly to the configured operational storage. Set exactly the running dashboard's database/absolute data directory first:

```sh
pnpm platform:operations status
pnpm platform:operations admins
pnpm platform:operations preview --user ACCOUNT_ID
```

Follow `nextCursor` with `admins --after CURSOR` when present. Preview returns the existing account version, without a password hash. Recovery is not an npm command or an HTTP endpoint.

### Recover an existing password administrator

1. Stop all writers and take a native operational database backup. Confirm the intended existing password admin by ID, then preview its current version.
2. On a POSIX host, create a privately owned, non-symlink password file outside the repository with mode `600`, containing one new 12–256 character password. Use an editor rather than putting the password in shell arguments.
3. Run, substituting the exact preview values and file path:

```sh
pnpm platform:operations recover \
  --user ACCOUNT_ID --version PREVIEW_VERSION --confirm ACCOUNT_ID \
  --backup-confirmed --reason "Restore administrator access after an incident" \
  --password-file /absolute/private/path/recovery-password
```

4. Restart, sign in, confirm old sessions/upload credentials are revoked and inspect the recovery audit event. Remove the private password file after verifying access.

Recovery cannot create/promote users, merge identities or add a password to a Google-only account. It requires transactional storage and a fresh account version. If only Google admins exist, restore provider access or an appropriate native backup instead of editing identity rows.

### Backup types

- **Native database backup:** includes operational account/review/baseline/policy state and new image objects. For SQLite, stop all writers and back up the configured data directory, including any legacy objects and an explicitly separate SQLite file. Do not copy only a live main file while WAL writes continue. For PostgreSQL/MongoDB, use the provider/native consistent-backup procedure.
- **Portable evidence export:** projects/run evidence/artifact objects, excluding authentication state. It is useful for offline evidence sharing, not recovery of an administrator or the whole installation.

```sh
node packages/visualguard/dist/cli.js dashboard export /absolute/path/team-evidence.vgbackup.gz
```

Restore into a fresh isolated destination and verify accounts, permissions, old screenshots and baseline selection before trusting a native backup. Keep deployment secrets separately. A rollback of code does not roll back a migrated database.

## 11. Run a built dashboard or package candidate

For the source dashboard with compiled UI, keep its settings loaded and use:

```sh
pnpm platform:build
pnpm platform:start
```

For a candidate containing the current source features, rebuild and pack from the repository root:

```sh
pnpm --filter visualguard build:dashboard
mkdir -p output/package-candidate
pnpm --dir packages/visualguard pack --pack-destination "$PWD/output/package-candidate"
```

Install that actual `.tgz` path in a separate consumer project. This is an explicit way to test newer source before npm publication; the ordinary [npm guide](/start/install/) needs no tarball or source checkout. The public release pipeline remains responsible for full declarations, release validation and a distinct published version.

### Project configuration and UI-triggered tests from source

Select a dashboard project and use **Configure tests** to save its own reference/candidate URLs, routes and viewports. Other projects keep their own settings. Existing `output/local-demo.json` or `visualguard.config.ts` files continue to control ordinary CLI tests independently.

For dashboard-triggered tests from source, keep the fixture sites and dashboard running. The dashboard captures the test itself with the workspace Chromium and your local session, so no runner credential is needed. To exercise the private-runner path instead, create the project's credential in **Use a private runner instead**, save it in an ignored `.env.visualguard-runner`, and start the built CLI from the repository root (a connected runner takes priority):

```sh
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard-runner \
  runner --project storefront --server http://127.0.0.1:4400
```

Set the UI config to `http://127.0.0.1:4100` and `http://127.0.0.1:4101` with route `/color-change` for this guide's fixture. Choose **Run test** and open **View result**. For another app, save that project's own URLs. Read the [complete runner setup and operational limits](/dashboard/private-runners/).

For implementation validation after the JavaScript/assets build, `pnpm platform:test:runner` runs an isolated dashboard-to-CLI workflow with real Chromium capture and temporary local HTTP sites. It does not connect to a production dashboard or external database.

Dashboard-triggered runs show live stages and the number of completed route/viewport comparisons in the selected project section. The percentage measures completed comparisons, with separate indeterminate upload/finalization states; it is not a time estimate. Refreshing the page reloads stored progress. Use matching dashboard/runner builds for detailed counts; older workers keep the generic running indicator. Completion links to the result without changing its regression/review status.

## 12. Troubleshooting and checks

| Symptom                                           | Check                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Browser executable missing                        | Install Chromium in the workspace package; on Linux include required browser system dependencies                                                                                                                                                                                                 |
| Wrong/empty dashboard history                     | Same absolute data directory/database in every terminal; `.visualguard/` paths otherwise depend on the calling directory. Use `test PROJECT --dashboard URL` to select the running dashboard; see [missing project/run recovery](/troubleshooting/dashboard/) |
| `role "USER" does not exist`                      | Replace placeholder credentials with the actual PostgreSQL username/password and ensure that role owns/can initialize the dedicated schema                                                                                                                                                       |
| Google controls missing                           | Use login mode and a complete OIDC configuration, load it in the actual server terminal, then restart                                                                                                                                                                                            |
| Google `redirect_uri_mismatch`                    | Match scheme, hostname, port and `/api/auth/callback` exactly; keep `localhost` and `127.0.0.1` consistent                                                                                                                                                                                       |
| Token rejected                                    | Correct project token, current owner access and correct canonical server; login-mode loopback needs a token too                                                                                                                                                                                  |
| `MongoDB URL must include a database name`        | Include `/visualguard` before the URI query string; use the MongoDB section's environment file                                                                                                                                                                                                   |
| MongoDB connection timeout/authentication failure | Atlas IP access list, actual database user/permissions and URL-encoded credentials                                                                                                                                                                                                               |
| MongoDB invite startup fails                      | Use a replica set/sharded deployment with transactions, or deliberately select limited `legacy` compatibility mode                                                                                                                                                                               |
| Development deep link returns 404                 | Navigate from the dashboard sidebar; for complete direct-route behavior, build the source UI and use `platform:start`                                                                                                                                                                            |
| UI/CLI feature missing                            | Correct checkout and a rebuilt package/UI; old `dist`/npm assets do not update themselves                                                                                                                                                                                                        |
| Baseline/policy blocked                           | Read the exact evidence, revision, coverage, rendering, freshness and approval reasons rather than relabeling old evidence                                                                                                                                                                       |

For implementation changes, use the focused test/build that exercises the change. The current repository instruction defers formatter/lint/type commands unless the user explicitly changes it; this guide does not claim those checks passed. No application build, behavior suite or live provider test was run while consolidating this documentation; examples were checked statically.

Planning, architecture and historical validation documents remain reference material. These two setup guides replace the older phase-by-phase walkthroughs.

## 13. Command reference

Run source commands at the repository root after section 1's package/dashboard build. `node packages/visualguard/dist/cli.js` runs this checkout's built CLI. In another application's npm installation, use `npx --no-install visualguard` instead. The [full command explanations](/reference/cli/) apply to both entry points; use `output/local-demo.json` for this guide's fixture configuration.

### Common source commands

| Command                                                                              | What it does                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `node scripts/serve-fixtures.mjs`                                                    | Start the production/reference and staging/candidate demo sites on 4100/4101; keep running during captures |
| `pnpm platform:dev`                                                                  | Start the dashboard development UI/API; export its environment in that terminal first                      |
| `pnpm platform:start`                                                                | Serve the built dashboard; build assets first and configure its process environment                        |
| `node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard`        | Start the packaged dashboard using an explicit SQLite/PostgreSQL/MongoDB environment file                  |
| `node packages/visualguard/dist/cli.js test --config output/local-demo.json --no-ai` | Run an offline comparison and save evidence locally                                                        |
| `node packages/visualguard/dist/cli.js report --config output/local-demo.json`       | Serve/open the latest local report; add `--run RUN_ID` to select another                                   |
| `node packages/visualguard/dist/cli.js doctor --config output/local-demo.json`       | Diagnose config and application reachability                                                               |
| `node packages/visualguard/dist/cli.js test --config output/local-demo.json --list`  | Show planned URL pairs without capture                                                                     |
| `node packages/visualguard/dist/cli.js --help`                                       | List CLI commands; each command/subcommand also supports `--help`                                          |

The app fixture servers, dashboard and test runner are separate processes. Starting a dashboard does not start the application sites or capture screenshots. `dashboard init` generates hosting files; `dashboard project create` creates a project inside an existing dashboard.

### Create a project and bind a test execution

With the dashboard running at port 4400:

```sh
node packages/visualguard/dist/cli.js dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
node packages/visualguard/dist/cli.js test storefront \
  --dashboard http://127.0.0.1:4400 --config output/local-demo.json --no-ai \
  --run-name "Local color-change check"
```

The first command creates/reuses `storefront`; `--name` supplies its display label. The second selects that project for this execution, runs the comparison, and publishes its saved evidence. Repeat the project argument for future tests. An exact unique display name also works. There is no separate persistent `bind` command. Without a project, `test` remains offline.

Use `--dashboard` to target the running dashboard even when the runner has different database settings. Otherwise, `test PROJECT` can select the runner's local storage instead. `--server` is the corresponding server selector for project creation/publishing commands. Local-owner loopback mode needs no upload token; login mode requires the project's token, including on localhost. Keep database/admin credentials on the dashboard/operator side.

For AI, configure section 4's provider and replace `--no-ai` with `--provider gemini` or the Ollama flags. `--config` describes tested applications; `--dashboard` describes where to store the result.

### Save an existing run or generate deployment files

Choose the operation you need and replace `RUN_DIRECTORY` with a real directory containing `manifest.json`:

```sh
node packages/visualguard/dist/cli.js dashboard --env-file .env.visualguard \
  import RUN_DIRECTORY --project storefront
node packages/visualguard/dist/cli.js dashboard publish RUN_DIRECTORY \
  --project storefront --server http://127.0.0.1:4400
```

`import` writes directly to the configured database; `publish` uploads through the running server and can retry a saved run without recapturing it. For login-enabled publishing, supply the project's upload token explicitly through the environment or an ignored `--env-file` before `publish`; this subcommand does not automatically load `.env.local`.

```sh
node packages/visualguard/dist/cli.js dashboard init --target vercel --out output/vercel-dashboard
node packages/visualguard/dist/cli.js dashboard init --target cloud-run --out output/cloud-run-dashboard
```

Choose one host. `dashboard init` creates files in an empty output directory, not cloud resources or an automatically deployed dashboard. Follow the [hosting guide](/deployment/overview/). For authentication, repair, baselines, policies, backups and other commands, use the [command reference](/reference/cli/) and the installed command's help.
