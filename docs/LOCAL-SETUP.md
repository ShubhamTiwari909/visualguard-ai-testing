# Run VisualGuard from source locally

For an explanation of all product capabilities before setup, read the [product feature guide](PRODUCT-FEATURES.md).

Use this guide to develop this repository or try the latest merged features on your own computer. To install the published package in another application, use the other final guide: [npm package setup](NPM-PACKAGE-SETUP.md).

The examples use a macOS/Linux POSIX shell. On Windows, use WSL for these shell/Docker examples. VisualGuard's ordinary CLI/dashboard also support Windows; host-side password-file recovery requires a POSIX host.

## Contents

- [Install the repository](#1-install-the-repository)
- [Start the production and staging demo](#2-start-the-production-and-staging-demo)
- [Run visual regression without a dashboard or database](#3-run-visual-regression-without-a-dashboard-or-database)
- [Run the local dashboard with SQLite](#4-run-the-local-dashboard-with-sqlite)
- [Choose PostgreSQL or MongoDB](#5-choose-postgresql-or-mongodb)
- [Test password login, Google and multiple users](#6-test-password-login-google-and-multiple-users)
- [Review changes, baselines and visual policies](#7-review-changes-baselines-and-visual-policies)
- [Audit, recovery and backups](#8-audit-recovery-and-backups)
- [Run a built dashboard or package candidate](#9-run-a-built-dashboard-or-package-candidate)
- [Troubleshooting and checks](#10-troubleshooting-and-checks)

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

## 4. Run the local dashboard with SQLite

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

## 5. Choose PostgreSQL or MongoDB

Use one backend at a time. Stop the dashboard before changing its database settings; switching a URL selects another workspace and does not migrate existing data.

The [npm guide's database section](NPM-PACKAGE-SETUP.md#5-use-postgresql-or-mongodb) provides complete local Docker setup for PostgreSQL and a transaction-capable MongoDB replica set. Those databases work with the source dashboard too. After starting the desired database, use a **new terminal B**, still at the repository root:

```sh
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/platform-dev"
export VISUALGUARD_AUTH_MODE=local
export VISUALGUARD_PUBLIC_URL="" DATABASE_URL=""
# Choose exactly one actual connection URL:
export VISUALGUARD_DATABASE_URL='postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard'
# Or, after starting the documented replica set:
# export VISUALGUARD_DATABASE_URL='mongodb://127.0.0.1:27018/visualguard?replicaSet=visualguard_local&directConnection=true'
pnpm platform:dev
```

For CLI imports/project creation/baseline pulls, set the same database URL in terminal C. For HTTP publishing, use `--dashboard` and the running server instead. The connection scheme selects the adapter automatically; `DATABASE_URL` is a fallback, so avoid accidentally inheriting another application's database.

PostgreSQL initializes its `vg_*` tables/indexes. MongoDB initializes collections/indexes. Use a dedicated database and a role with schema permissions. Invite mode, Google linking, baseline mutations and recovery require SQLite, PostgreSQL or transaction-capable MongoDB. A standalone MongoDB instance is a compatibility option with `VISUALGUARD_USER_ADMISSION=legacy`, not the full team-feature configuration.

## 6. Test password login, Google and multiple users

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

## 7. Review changes, baselines and visual policies

For the shortest local trial, return to the local-owner workspace from section 4; retain the same workspace/database in each terminal. These features also work with properly authorized users in the login trial.

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

`--enforce` exits unsuccessfully unless satisfied. Operational errors always fail. For GitHub setup, exact PR-head capture and scheduled reconciliation, see the [final package guide](NPM-PACKAGE-SETUP.md#9-team-reviews-approved-baselines-and-github-checks). Named journeys remain deferred.

### Names and deletion

Maintainers can edit display names/run names and the project's public ID; old IDs remain aliases. `--run-name` labels new project-bound captures. Deletion requires explicit confirmation and permission, preserves evidence shared/referenced elsewhere, and does not erase original runner output or backups. Deleted project IDs remain reserved; create a new ID rather than trying to reuse one.

## 8. Audit, recovery and backups

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

## 9. Run a built dashboard or package candidate

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

Install that actual `.tgz` path in a separate consumer project. This is an explicit way to test newer source before npm publication; the ordinary [npm guide](NPM-PACKAGE-SETUP.md) needs no tarball or source checkout. The public release pipeline remains responsible for full declarations, release validation and a distinct published version.

## 10. Troubleshooting and checks

| Symptom | Check |
| --- | --- |
| Browser executable missing | Install Chromium in the workspace package; on Linux include required browser system dependencies |
| Wrong/empty dashboard history | Same absolute data directory/database in every terminal; `.visualguard/` paths otherwise depend on the calling directory |
| `role "USER" does not exist` | Replace placeholder credentials with the actual PostgreSQL username/password and ensure that role owns/can initialize the dedicated schema |
| Google controls missing | Use login mode and a complete OIDC configuration, load it in the actual server terminal, then restart |
| Google `redirect_uri_mismatch` | Match scheme, hostname, port and `/api/auth/callback` exactly; keep `localhost` and `127.0.0.1` consistent |
| Token rejected | Correct project token, current owner access and correct canonical server; login-mode loopback needs a token too |
| MongoDB invite startup fails | Use a replica set/sharded deployment with transactions, or deliberately select limited `legacy` compatibility mode |
| Development deep link returns 404 | Navigate from the dashboard sidebar; for complete direct-route behavior, build the source UI and use `platform:start` |
| UI/CLI feature missing | Correct checkout and a rebuilt package/UI; old `dist`/npm assets do not update themselves |
| Baseline/policy blocked | Read the exact evidence, revision, coverage, rendering, freshness and approval reasons rather than relabeling old evidence |

For implementation changes, use the focused test/build that exercises the change. The current repository instruction defers formatter/lint/type commands unless the user explicitly changes it; this guide does not claim those checks passed. No application build, behavior suite or live provider test was run while consolidating this documentation; examples were checked statically.

Planning, architecture and historical validation documents remain reference material. These two setup guides replace the older phase-by-phase walkthroughs.
