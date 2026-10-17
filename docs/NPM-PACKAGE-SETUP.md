# Install VisualGuard in any project: visual tests and dashboard

For an explanation of all product capabilities before setup, read the [product feature guide](PRODUCT-FEATURES.md).

This is the complete user setup guide for the published npm package. You do not need to clone VisualGuard or build its source. For repository development and testing the latest merged features, use [local source setup](LOCAL-SETUP.md).

## Contents

- [Choose your setup](#1-choose-your-setup)
- [Install and run the first visual test](#2-install-and-run-the-first-visual-test)
- [Use local reports and baselines](#3-use-local-reports-and-baselines)
- [Run a dashboard without a database service](#4-run-a-dashboard-without-a-database-service)
- [Use PostgreSQL or MongoDB](#5-use-postgresql-or-mongodb)
- [Enable login and connect other projects](#6-enable-login-and-connect-other-projects)
- [Deploy to Vercel or Google Cloud Run](#7-deploy-to-vercel-or-google-cloud-run)
- [Understand storage, backups and upgrades](#8-understand-storage-backups-and-upgrades)
- [Team reviews, approved baselines and GitHub checks](#9-team-reviews-approved-baselines-and-github-checks)
- [Troubleshooting and final checks](#10-troubleshooting-and-final-checks)

## 1. Choose your setup

| You want | Database requirement | Login / token |
| --- | --- | --- |
| Visual tests and HTML reports only | None | None |
| Local dashboard/history on your computer | SQLite created automatically; no database service | None in default loopback local mode |
| Local dashboard with PostgreSQL | Dedicated PostgreSQL database | Optional login; token needed when login is enabled |
| Local dashboard with MongoDB | Dedicated MongoDB database; replica set for full team features | Same as PostgreSQL |
| Shared dashboard on Vercel/Cloud Run | External PostgreSQL or transaction-capable MongoDB | Login and project upload tokens |

“Without database” applies literally to standalone visual tests. The dashboard's zero-setup option is an embedded SQLite file. You do not have to install PostgreSQL or MongoDB to use the product locally.

Use one hosted installation per customer organization/team. That instance can contain multiple projects/users with separate permissions; each person does not need their own server.

**Version boundary:** npm metadata checked on 17 October 2026 reported `visualguard@3.1.0`, from source revision `b8f2cb04`. It supports the core test/dashboard/project/publish/scaffold commands below. Later merged Google onboarding, administration, approved baselines and visual-policy features need a newer release containing them; section 9 is explicitly for such a release. Installing the current npm version does not install unreleased `main` changes. Keep client/server releases compatible and pin the version in the lockfile.

## 2. Install and run the first visual test

### Prerequisites

Use Node.js **22.12+** and a working application with two reachable environments: production/reference and staging/candidate. The runner can test React, Next.js, Vue, static sites or any other browser-accessible application; it does not need to run on the same host as that application.

From your application directory:

```sh
cd /path/to/your-app
npm install --save-dev --save-exact visualguard
npm install --save-dev playwright
npx playwright install chromium
npx --no-install visualguard --version
```

If already installed, check the version and continue. Keep existing Playwright setup if it already satisfies the package's peer requirement. On Linux/CI, install Playwright's required system dependencies too. Keep VisualGuard's optional dependencies enabled: PostgreSQL, MongoDB and OIDC drivers are packaged that way, so do not use `--omit=optional` for a dashboard installation.

Add these entries to `.gitignore` if absent:

```gitignore
.visualguard/
.env.local
.env.visualguard
.env.dashboard-admin
```

### Configure the comparison

Start your app normally, for example with `npm run dev`. Create `visualguard.config.json` in the application root:

```json
{
  "baseURL": {
    "production": "https://your-app.example.com",
    "staging": "http://127.0.0.1:3000"
  },
  "routes": ["/"],
  "viewports": {
    "desktop": { "width": 1280, "height": 800 }
  },
  "ai": { "provider": "none" }
}
```

Replace both URLs/port and routes with real reachable pages. These are application-under-test URLs, not a dashboard URL. For a completely local comparison, run your production/reference build and candidate build on two different ports and use those origins.

If you already have a VisualGuard config, keep it. Alternatively `npx --no-install visualguard init` writes a TypeScript config interactively; do not create competing configs unintentionally. JSON examples in this guide use an explicit `--config` because automatic discovery targets the supported JavaScript/TypeScript config filenames.

### Compare and inspect

```sh
npx --no-install visualguard test --config visualguard.config.json --no-ai
npx --no-install visualguard report --config visualguard.config.json
```

Change a button's color or spacing in staging, rerun and inspect reference/candidate/diff views and findings. Reports are saved under `.visualguard/runs/RUN_ID/` by default. The report command serves the selected run locally until Ctrl+C.

A plain `test` without a project argument stays offline. No dashboard, database, upload token or AI key is required. A nonzero test exit may mean a detected regression rather than installation failure; read the saved report/status. Use `doctor --config visualguard.config.json` to inspect configuration/reachability.

### Optional authentication and AI

For logged-in application pages, use the existing capture authentication workflow, for example `npx --no-install visualguard auth staging --config visualguard.config.json`, and the corresponding production setup. Add the saved state paths to the comparison configuration so captures use them:

```json
{
  "environments": {
    "production": { "storageState": ".visualguard/auth/production.json" },
    "staging": { "storageState": ".visualguard/auth/staging.json" }
  }
}
```

This is a fragment to merge into the existing configuration after saving each session. Application login cookies belong to the runner, not dashboard account login.

AI is optional. To use Gemini, configure the supported provider in `ai`, place `GEMINI_API_KEY` in a private runner environment, and omit `--no-ai`. Ollama is another supported route. Keep the initial setup on provider `none`; AI neither grants visual approval nor overrides a missing capture.

## 3. Use local reports and baselines

### Saved local reference images

To compare one candidate application against stored screenshots, create `visualguard.baseline.json`:

```json
{
  "mode": "baseline",
  "baseURL": { "staging": "http://127.0.0.1:3000" },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "baseline": { "dir": "visualguard/baselines", "missing": "error" },
  "ai": { "provider": "none" }
}
```

Create a reference only after checking that the current appearance is expected:

```sh
npx --no-install visualguard test --config visualguard.baseline.json --update-baselines --no-ai
```

After changing the application, compare without the update flag:

```sh
npx --no-install visualguard test --config visualguard.baseline.json --no-ai
npx --no-install visualguard report --config visualguard.baseline.json
```

Keep rendering settings consistent. Store local baselines according to your repository/artifact policy. Local baseline creation is different from the later shared **approved baseline registry** described in section 9. Do not update baselines automatically just to make CI pass.

### Existing Playwright tests

VisualGuard can inspect an interactive state reached by an existing test:

```ts
import { test } from "visualguard/playwright";

test("checkout summary", async ({ page, visualguard }) => {
  await page.goto("/checkout");
  await visualguard.check(page, { name: "checkout-summary" });
});
```

Use the project's normal Playwright configuration and VisualGuard reference configuration. For interactions that change the expected reference state, supply the corresponding fixture/reference setup rather than comparing unrelated application states. Full capture/configuration/API options remain in the [package reference](../packages/visualguard/README.md).

## 4. Run a dashboard without a database service

### Select local SQLite explicitly

At the application root, create an ignored `.env.visualguard`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=
```

Run these in a fresh terminal without exported dashboard settings. Explicit process values take precedence over environment files. The dedicated empty database setting selects SQLite instead of an unrelated application's `DATABASE_URL`.

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard
```

Open `http://127.0.0.1:4400`. Default local mode trusts this computer's workspace owner and accepts no public listener. It needs no email, password or upload token. The default data file is `.visualguard/platform/metadata.sqlite` under the calling project.

To use another directory/port, put options before a subcommand:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  --data-dir /absolute/path/to/dashboard-data --port 4500
```

Keep the server running. A dashboard-only host needs no Playwright browser, React development project, source checkout or AI key.

### Create a project and capture into it

In another terminal at the application root:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  project create storefront --name "Storefront Web"
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.json --no-ai
```

With default directories, project creation uses the same SQLite file as the dashboard. If you selected another directory, use that same `--data-dir` for direct storage commands or create the project in the dashboard UI. If using port 4500, change the `--dashboard` URL accordingly.

The project ID is stable. An exact unique display name also works, such as `test "Storefront Web"`. Repeated creation of an existing ID preserves its name/history rather than resetting it.

### Import an existing offline run

Replace `RUN_ID` with a real run directory containing `manifest.json`:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront --name "Storefront Web"
```

Refresh the dashboard. Import copies/indexes the evidence; deleting the original runner output later does not remove the imported database objects. An incomplete/error run remains visibly incomplete, rather than being turned into a pass by importing it.

## 5. Use PostgreSQL or MongoDB

You can use an existing database or the local Docker recipes below. Use a dedicated database with a real application user. **Changing the URL does not migrate SQLite/history automatically.** Stop the dashboard, change `.env.visualguard`, and restart against the chosen workspace.

### PostgreSQL

If you already have PostgreSQL, copy its real URI and required TLS settings. Otherwise, with Docker installed, create a disposable local development instance:

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

Wait until it reports accepting connections. These credentials are only for the loopback development example; use distinct strong credentials and supported network/TLS controls in a shared deployment. The named volume retains data when the container is stopped/restarted.

Update `.env.visualguard`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard
```

Start the dashboard and create its first project in a second terminal:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard
```

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  project create storefront --name "Storefront Web"
```

Run the project-bound HTTP test from section 4. Restart the dashboard and confirm its history remains. The app role must be able to create/update `vg_*` tables/indexes; an existing restricted role may need schema grants from its database administrator. Do not copy a literal `USER` placeholder or rely on your laptop's username being a database role.

### MongoDB with transactions

For full team features, use MongoDB Atlas or another replica set/sharded deployment supporting transactions. Include the actual database name in the URI. A local one-member replica set can be used for development:

```sh
docker run --detach --name visualguard-mongo-local \
  --publish 127.0.0.1:27018:27018 \
  --volume visualguard_mongo_local:/data/db \
  mongo:7 --replSet visualguard_local --port 27018 --bind_ip_all

docker exec visualguard-mongo-local mongosh --port 27018 --quiet \
  --eval 'db.runCommand({ping: 1})'
```

Wait for the ping to succeed. Initialize **once** for a new volume:

```sh
docker exec visualguard-mongo-local mongosh --port 27018 --quiet \
  --eval 'rs.initiate({_id: "visualguard_local", members: [{_id: 0, host: "127.0.0.1:27018"}]})'

docker exec visualguard-mongo-local mongosh --port 27018 --quiet \
  --eval 'db.hello().isWritablePrimary'
```

Wait/repeat the last check until `true`. Reuse the initialized named volume on restarts instead of initializing it again. This unauthenticated, loopback-published database is a local development fixture, not a production database recipe. [MongoDB development replica sets](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set-for-testing/).

Update `.env.visualguard`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=mongodb://127.0.0.1:27018/visualguard?replicaSet=visualguard_local&directConnection=true
```

Start/create/test exactly as for PostgreSQL. The same VisualGuard CLI and dashboard UI work with either backend. For Atlas, use its supplied `mongodb+srv://.../visualguard` URI, real database-user credentials and network access configuration; do not use this local `directConnection` recipe there.

### Standalone MongoDB compatibility

A standalone MongoDB server can retain ordinary evidence/review/publishing and compatible sign-in workflows. On a release with the newer admission controls, choose `VISUALGUARD_USER_ADMISSION=legacy` explicitly. Invitations, Google account linking, managed lifecycle operations, baseline mutations and administrator recovery require transactional storage; do not present standalone MongoDB as supporting that full feature set. Prefer the replica-set recipe above for a new team installation.

### Stop/start local database fixtures

Use `docker stop visualguard-postgres-local` / `docker start visualguard-postgres-local`, or the corresponding MongoDB container name. These commands retain named volumes. Do not delete a volume or production database to resolve a connection error. If a container name/port is already occupied, use the existing intended instance or choose different names/ports and update its URI.

## 6. Enable login and connect other projects

### Turn a local dashboard into a login trial

Stop the dashboard and edit its ignored `.env.visualguard`. Keep your chosen database URI, or an explicit empty value for local SQLite, and add:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='YOUR_UNIQUE_12_TO_256_CHARACTER_PASSWORD'
```

On a release containing admission controls, set `VISUALGUARD_USER_ADMISSION=invite` for a fresh team installation on SQLite/PostgreSQL/transactional MongoDB. Older `3.1.0` does not gain invitation behavior by setting this variable. Use a fresh separate data directory/database for an isolated trial rather than repurposing live data casually.

Restart with `dashboard --env-file .env.visualguard`, open the exact configured origin and sign in. Bootstrap creates the initial admin once; later environment changes do not overwrite an existing password. Profile/account pages expose the signed-in identity on releases containing those controls.

### Publish to a login-enabled dashboard

1. In **People & integrations**, create/select the cloud/login workspace's project and create a named project upload token. Store it when shown; it is not the admin password.
2. In the application being tested, add to its ignored `.env.local` (or CI secrets):

```dotenv
VISUALGUARD_DASHBOARD_URL=https://YOUR_DASHBOARD_HOST
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

For the login-enabled loopback trial, use `http://127.0.0.1:4400` instead. Remote hosts require HTTPS.

3. Run from that application's root:

```sh
npx --no-install visualguard test storefront --config visualguard.config.json --no-ai
```

The command loads `.env`/`.env.local`; existing process values win. HTTP publishing requires a project token even when the dashboard is on localhost if it runs in login mode. The runner needs neither the database URI nor dashboard admin credentials. Browsers stay on the developer's computer/CI, with network access to both tested applications and the dashboard.

A token cannot create projects, browse general history or grant access. To create a project remotely, use the dashboard UI or `dashboard project create` with a password administrator's current credentials in an ignored operator environment file. Set `VISUALGUARD_DASHBOARD_URL`, admin email and current admin password, then run:

```sh
npx --no-install visualguard dashboard --env-file .env.dashboard-admin \
  project create storefront --name "Storefront Web"
```

This performs authorized administrator login; an OIDC-only administrator can use the browser instead. Keep these credentials separate from CI upload secrets.

### Publish a saved run or retry an interrupted upload

Create an ignored `.env.visualguard-upload` containing just the real `VISUALGUARD_UPLOAD_TOKEN` and add that file to `.gitignore`. Replace the run path/project/server:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-upload \
  publish .visualguard/runs/RUN_ID \
  --project storefront --server https://YOUR_DASHBOARD_HOST
```

Explicit `--env-file` is useful here: do not assume every dashboard subcommand reads application `.env.local` automatically. The same immutable evidence can resume an upload for up to 24 hours; changed bytes/metadata cannot overwrite existing evidence under a reused identity. Transfers use 1 MiB chunks, checksums and bounded retries. A failed publication keeps the local run for inspection/retry. Current upload limits are 4096 referenced artifacts, 32 MiB per artifact, a 16 MiB raw manifest and 512 MiB of referenced bytes; MongoDB additionally bounds the complete metadata envelope to 12 MiB. Split exceptionally large executions into appropriately scoped complete runs.

## 7. Deploy to Vercel or Google Cloud Run

Both hosts require an **external persistent database**; SQLite under their ephemeral filesystem is not supported. A managed PostgreSQL service is the simplest shared example here. A transaction-capable MongoDB URI can be used instead with provider-appropriate network access. Each new database starts as a separate empty workspace; deployment does not migrate your local history.

Use the four settings `VISUALGUARD_DATABASE_URL`, `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_ADMIN_EMAIL`, `VISUALGUARD_ADMIN_PASSWORD`, plus explicit `VISUALGUARD_AUTH_MODE=login`. Keep them server-side, never `NEXT_PUBLIC_`/`VITE_`. Use an exact canonical HTTPS origin without a path/query. A generated provider domain is sufficient initially; custom domains are optional.

### Vercel

From the application root:

```sh
npx --no-install visualguard dashboard init --target vercel --out deploy/visualguard-vercel
cd deploy/visualguard-vercel
npm install
npm install --global vercel
vercel login
vercel link
```

Create a **separate dashboard project**, not your application's existing Vercel project. The generated folder pins the installed CLI version from npm; no tarball/source checkout is needed. Use **Other** framework, Node **22.x**, build `npm run build`, output `public` and the generated API/static rewrites.

Check `vercel.json` before deployment:

- The `3.1.0` source's scaffold omits `/reviews`; add `{ "source": "/reviews", "destination": "/index.html" }` to `rewrites` if absent.
- Current merged feature source also needs a `/policies` rewrite in its generated output until the pending scaffold correction is released. For a release containing the relevant pages, preserve routes for `/settings`, `/operations`, `/reviews`, `/baselines`, `/policies`, `/invite`, `/runs/:path*` and `/`.
- Keep `/api/:path*` routed to the API function, not `index.html`. Invitation pages in newer releases also need the scaffold's no-referrer/no-store headers.

Create/connect a dedicated PostgreSQL resource through the [Vercel Marketplace](https://vercel.com/docs/marketplace-storage), or use your existing managed database. Set its actual URI as `VISUALGUARD_DATABASE_URL`; provider integration variable names can differ. Select nearby database/function regions and an appropriate pooled endpoint with provider-required TLS.

Enter each value privately at the CLI prompts, scoped to Production:

```sh
vercel env add VISUALGUARD_DATABASE_URL production
vercel env add VISUALGUARD_PUBLIC_URL production
vercel env add VISUALGUARD_ADMIN_EMAIL production
vercel env add VISUALGUARD_ADMIN_PASSWORD production
vercel env add VISUALGUARD_AUTH_MODE production
vercel --prod
```

Use the actual stable project origin, for example `https://my-app-visualguard.vercel.app`; enter `login` for auth mode. If the hostname is assigned only after deployment, update the public URL and redeploy before login. A local `.env` does not set production variables. [Vercel environments](https://vercel.com/docs/environment-variables), [deployment CLI](https://vercel.com/docs/cli/deploy).

Open the canonical URL, sign in, create a project/token and configure your application as in section 6. Keep previews disabled or isolated with their own database/URL. To use a custom domain, add it in Vercel, follow its DNS instructions, then update the canonical URL and redeploy.

Vercel documents a 4.5 MB function request/response limit. VisualGuard chunks uploads/downloads; test a real large screenshot, manifest and baseline pull with the exact release. Direct unchunked large-artifact requests can be rejected. Test database connection capacity during cold starts/concurrency too: current PostgreSQL pools allow up to five connections per runtime instance. [Vercel limits](https://vercel.com/docs/functions/limitations).

### Google Cloud Run with managed PostgreSQL or MongoDB

From the application root:

```sh
npx --no-install visualguard dashboard init --target cloud-run --out deploy/visualguard-cloud-run
cd deploy/visualguard-cloud-run
npm install
```

Use a Google Cloud project with billing and the Google Cloud CLI. Replace project/region:

```sh
gcloud auth login
export VG_PROJECT_ID="your-google-cloud-project"
export VG_REGION="us-central1"
gcloud config set project "$VG_PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

Configure the documented source deployer/build IAM prerequisites once with the project administrator. Cloud Build uses the generated Dockerfile; no local Docker, browser binaries or separately published image is required. The database must permit the service's connections with its prescribed TLS/network settings. [Cloud Run source deployment and IAM](https://docs.cloud.google.com/run/docs/deploying-source-code).

Create private `.env.cloud-run.yaml` in this generated folder, replacing the URI/credentials:

```yaml
VISUALGUARD_AUTH_MODE: "login"
VISUALGUARD_PUBLIC_URL: "https://setup.invalid"
VISUALGUARD_DATABASE_URL: "postgresql://REAL_USER:REAL_PASSWORD@REAL_HOST/REAL_DATABASE?sslmode=require"
VISUALGUARD_ADMIN_EMAIL: "owner@example.com"
VISUALGUARD_ADMIN_PASSWORD: "YOUR_UNIQUE_INITIAL_PASSWORD"
```

Use your provider's exact URI/TLS options instead of copying the illustrative URL. Set admission to `invite` as well when running a compatible new team release. The initial origin is temporary while obtaining the assigned service URL. Protect the file with `chmod 600 .env.cloud-run.yaml` and keep it ignored by Git. Add `.gcloudignore`:

```text
.gcloudignore
.git
node_modules
.env
.env.*
.visualguard
```

Keep `package.json`, its lockfile and `Dockerfile` in the build context. Deploy a **new private service**, then apply its real origin:

```sh
gcloud run deploy visualguard-dashboard \
  --source . --region "$VG_REGION" --env-vars-file .env.cloud-run.yaml \
  --port 8080 --max-instances 3 --no-allow-unauthenticated

export VG_DASHBOARD_URL="$(gcloud run services describe visualguard-dashboard \
  --region "$VG_REGION" --format='value(status.url)')"

gcloud run services update visualguard-dashboard \
  --region "$VG_REGION" --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_DASHBOARD_URL}"

gcloud run services add-iam-policy-binding visualguard-dashboard \
  --region "$VG_REGION" --member="allUsers" --role="roles/run.invoker"

curl --fail "$VG_DASHBOARD_URL/api/health"
```

Update the URL inside the private YAML file too, so the next deploy does not restore `setup.invalid`. These are starting deployment settings, not measured capacity guarantees. Public invocation permits access to the product's own login/token authentication; it does not make private project data public. An organization forbidding public invocation needs a separately designed authenticated ingress path; the current CLI does not obtain Google IAM invocation tokens automatically.

Environment files configure service variables, not Secret Manager references. For ongoing operations, put the DB/admin secrets in Secret Manager, grant the runtime identity access to just those secrets, and map pinned enabled versions to their environment names. [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

Open the assigned HTTPS URL and follow section 6. A custom production domain can use a supported ingress option such as an external Application Load Balancer/serverless NEG; update the canonical origin afterward. Google's direct domain mapping is currently documented as preview and not recommended for production. [Cloud Run domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

### Cloud Run with Cloud SQL specifically

Cloud SQL also works, but requires its connection path, not just a generic public URI:

1. Create a PostgreSQL instance in the same region, a dedicated `visualguard` database/user, and schema permissions. Enable backups/PITR/deletion protection as appropriate.
2. Create/select the Cloud Run runtime service account, grant `roles/cloudsql.client`, and attach the instance to the service using its `PROJECT:REGION:INSTANCE` connection name. Use the second-generation execution environment for the documented supported proxy/CA combinations.
3. For the public-IP built-in proxy/socket path, do not add `0.0.0.0/0` to database authorized networks. Private-IP-only SQL needs appropriate VPC egress/connector networking.
4. Store a PostgreSQL URL in Secret Manager with its URI-encoded socket host, for example:

```text
postgresql://visualguard:HEX_PASSWORD@localhost:5432/visualguard?host=%2Fcloudsql%2FPROJECT%3AREGION%3AINSTANCE
```

5. Grant that runtime identity secret access and deploy with the real service account, SQL attachment and secret versions. For example, adapt the earlier `gcloud run deploy` with `--service-account YOUR_RUNTIME_SA`, `--execution-environment gen2`, `--add-cloudsql-instances PROJECT:REGION:INSTANCE` and `--set-secrets VISUALGUARD_DATABASE_URL=visualguard-db-url:1,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1`. Remove those two values from an env-vars file when using the secret mapping; an environment variable cannot simultaneously be a literal and a secret reference.
6. Verify startup, `/api/health`, login, publishing and restoration against the actual Cloud SQL instance.

Follow [Google's Cloud SQL connection instructions](https://docs.cloud.google.com/sql/docs/postgres/connect-run) and [Secret Manager configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets) for the chosen network/IAM setup. The app uses the existing `pg` driver/socket support; it does not install a separate Cloud SQL connector automatically.

## 8. Understand storage, backups and upgrades

### Where are images saved?

- The execution machine retains run files under the configured output directory, normally `.visualguard/runs/`.
- A successful dashboard import/publish stores new screenshots and DOM evidence in the **selected dashboard database**.
- SQLite uses `metadata.sqlite`; PostgreSQL uses `vg_objects`/`vg_object_chunks`; MongoDB uses corresponding collections. Chunks are 1 MiB with base64-encoded data, indexed by content digest.
- Therefore Vercel + PostgreSQL stores images in that PostgreSQL service, and Cloud Run + Cloud SQL stores them in Cloud SQL. The compute host's local filesystem is not the persistent cloud image store.
- Vercel Blob, S3 and Google Cloud Storage are not required/configurable artifact backends today. Merely setting a bucket environment variable does not move images.

Accounts, sessions, run metadata, review state, baseline history and policies also persist in the database when supported by the installed release. Database cost/capacity must include evidence: base64 uses about four bytes per three original bytes before compression/index/backup overhead; deduplication can reduce additional writes for identical objects. There is no assumed automatic time-based history retention.

### Portable evidence backup

From a machine with access to the selected DB/data directory:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  export /absolute/path/team-evidence.vgbackup.gz
```

Use a new output filename. Portable export contains projects/run evidence/required artifact objects and excludes authentication state; it is not a full operational backup. Restore into a fresh local workspace with an environment file selecting SQLite:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite \
  --data-dir ./review-workspace restore /absolute/path/team-evidence.vgbackup.gz
npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite \
  --data-dir ./review-workspace
```

Create that ignored `.env.visualguard-sqlite` first with the three local-mode/empty URL settings from section 4, and add it to `.gitignore`. Restoration is append-only/deduplicating and can reject conflicting evidence; prefer a fresh destination rather than expecting overwrite semantics. Legacy file-backed workspaces may require their original `objects/` directory or a portable export collecting it.

### Native operational backups

For complete recovery, include the actual database, configuration/secrets and provider settings:

- **SQLite:** stop all writers and back up the configured data directory, the exact SQLite file and any legacy artifact directory. Include WAL state through a proper backup procedure; do not copy only a live main file blindly.
- **PostgreSQL:** use managed backups/PITR or `pg_dump`/`pg_restore` for your actual deployment, including all VisualGuard tables. For the local Docker example:

```sh
umask 077
docker exec visualguard-postgres-local pg_dump -U visualguard -d visualguard -Fc \
  > visualguard-native.dump
```

  [PostgreSQL native dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html).

- **MongoDB:** use the deployment's supported consistent snapshot/backup procedure. With the Database Tools installed, a logical replica-set backup can use `mongodump --uri='mongodb://127.0.0.1:27018/?replicaSet=visualguard_local&directConnection=true' --oplog --out /absolute/private/backup-directory`. This is a full replica-set dump, not a `--db`-filtered dump; restrict and handle its contents accordingly. [MongoDB dump options](https://www.mongodb.com/docs/database-tools/mongodump/).

Restore into a **separate isolated database** and verify old screenshot bytes, accounts, permissions, reviews and current baselines. A restore also restores historical credential state, so revoke compromised sessions/tokens/invitations before reconnecting an incident recovery. Keep backups private and outside Git/CI artifacts.

### Updates

Pin the next supported package version in both runner and deployment. Rebuild/regenerate hosting assets as required, back up and validate against a restored test database before upgrading production. A previous hosting deployment does not roll back a migrated schema. Stop old writers and upgrade consistently for identity, administration and reference changes.

## 9. Team reviews, approved baselines and GitHub checks

The following describes the merged feature implementation. **Use a published release that actually contains it**; `3.1.0` is not a claim that all these later controls are available. For a current-source trial, the [source guide](LOCAL-SETUP.md) provides a complete local color-change/review/baseline/policy exercise.

### Google, invitations, roles and profile

On a compatible release, set `VISUALGUARD_USER_ADMISSION=invite` and use SQLite/PostgreSQL/transactional MongoDB. Create a customer-owned Google OAuth web client and register exactly `PUBLIC_URL/api/auth/callback`; add issuer `https://accounts.google.com`, client ID and client secret under `VISUALGUARD_OIDC_ISSUER`, `VISUALGUARD_OIDC_CLIENT_ID`, `VISUALGUARD_OIDC_CLIENT_SECRET`. Use all three or leave them unset.

Sign in as the existing password administrator and explicitly link Google under **Your sign-in methods**. Matching email alone never merges identities. Configure Google's audience/test users, complete both-account proof and verify the same user/history after relogin. [Google OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect).

Use **Profile** to see your name/email/workspace role. In **People & integrations**, create members, assign project roles and create expiring invitation links. Share links privately; the dashboard sends no invitation emails. Recipients verify the matching identity and explicitly accept. Viewer reads, Reviewer discusses/decides, Maintainer manages project access/tokens/references/policies; Workspace Admin manages all accounts/projects. Administrator promotion is separate from member creation. Disable removes access while retaining attributable history; restore does not resurrect old sessions/tokens. Last-admin protection, current proof and record-version checks guard administrative changes.

Each installation is one workspace; this does not implement a vendor-wide multi-tenant super-admin console. Existing deployments migrating admission must back up and deploy a consistent explicit mode/version across writers.

### Reviews and names

Open a run's **Team review / Check reviews** to comment/reply, assign a reviewer/deadline and record **Approve visual change**, **Request changes** or **Withdraw decision**, with a reason. **Review inbox** filters assigned/overdue/decision state. Decisions refer to exact run/check evidence. Comments and local acceptance files do not provide shared approval.

Use `--run-name "Release smoke"` with project-bound tests. Maintainers can edit run/project names and public IDs; old project IDs remain aliases. Deletion is permission-checked and confirmed, protects referenced/shared evidence, and leaves original runner files/backups alone. Deleted project IDs stay reserved. No automatic retention scheduler is established by hosting the app.

### Approved baselines

1. Capture/publish complete evidence with its actual full source SHA and compatible rendering identities.
2. Review the exact checks. In **Approved baselines**, select the project/set `main`, candidate run, actual landed revision and promotion reason. Confirm the source change landed before promoting.
3. Pull the immutable approved version with the project's upload token in `.env.local`:

```sh
npx --no-install visualguard dashboard baseline pull main \
  --project storefront --version 1 --out .visualguard/approved-v1 \
  --server https://YOUR_DASHBOARD_HOST
```

4. Set the baseline config's `baseline.dir` to `.visualguard/approved-v1` and keep rendering settings consistent. A plain baseline test then works offline. Project-bound tests can publish the resulting comparison.

Promotion records the maintainer's landed-revision attestation, not automatic Git ancestry verification. Versions are immutable; restore creates another version. Tampering, incompatible rendering, stale references, incomplete coverage or missing exact approval block the relevant operation. `--update-baselines` cannot overwrite an approved snapshot. For Playwright fixture snapshots, use the downloaded parent directory; its fixture references are under `playwright/`.

### Visual policy and GitHub delivery

Start in **Informative** mode on **Visual regression policy**. Select target branch/environment, current baseline, freshness, required checks and visual approval requirements; save with a reason. Empty required IDs inherit the baseline coverage. Assess a fresh exact-revision comparison. Missing/partial evidence, stale baseline, capture failures, wrong revisions and withdrawn/rejected approval cannot be bypassed by comments. Temporary exact-check/exact-revision approval exceptions require a reason/expiry and do not waive structural/capture errors.

Optional server-side GitHub settings:

```dotenv
VISUALGUARD_GITHUB_TOKEN=SUPPORTED_CHECKS_WRITE_AND_PULL_REQUESTS_READ_CREDENTIAL
VISUALGUARD_GITHUB_REPOSITORIES=storefront=customer-org/customer-repo
VISUALGUARD_GITHUB_WEBHOOK_SECRET=UNIQUE_RANDOM_SECRET
```

Repository mappings use immutable internal project IDs. Configure `/api/github/webhook`, JSON content, the matching secret and Pull requests events. The host must preserve raw signed request bytes; an already parsed object is rejected. Validate this on Vercel/Cloud Run; use scheduled reconciliation when raw-body forwarding is unavailable. Supported Check Runs credentials differ from a normal GitHub CLI OAuth login; token refresh/expiry handling remains the deployment's responsibility. [GitHub Check Runs authentication](https://docs.github.com/en/rest/checks/runs#create-a-check-run).

Trusted CI must capture the actual PR **head SHA**, not the temporary merge SHA. Publish with that SHA, real PR number and environment, using the existing project-bound test flags or saved-run publishing. Do not expose server/admin credentials to the runner.

```sh
npx --no-install visualguard dashboard policy assess \
  --project storefront --revision CAPTURED_FULL_SHA --server https://YOUR_DASHBOARD_HOST
npx --no-install visualguard dashboard policy reconcile \
  --project storefront --pr 123 --server https://YOUR_DASHBOARD_HOST
```

Configure a trusted scheduler to run `policy reconcile --project storefront --all --server ...` at least every five minutes and after review/policy/baseline/access changes. Supply the project's upload token to these CLI commands through private environment/CI secrets. Hosting does not configure a scheduler; Cloud Scheduler/Vercel Cron needs an appropriate handler/job rather than an arbitrary CLI name.

Checks are point-in-time observations; GitHub may retain an old conclusion during an outage. Test failure/retry/expiry monitoring before making a check required. Informative uses neutral conclusions; Required distinguishes satisfied/blocked/pending. This feature does not change branch protection or merge PRs. Named journeys remain deferred.

### Audit and recovery

Administrators use **Audit & recovery** for bounded, filtered history and sign-in readiness. Readiness is an inventory, not live-production certification. Host-side administrator recovery is source/operator tooling, not an installed npm recovery endpoint. The [source guide](LOCAL-SETUP.md#8-audit-recovery-and-backups) explains its proof/version/backup/password-file requirements. Never edit identity rows or overwrite password hashes to simulate recovery.

## 10. Troubleshooting and final checks

| Symptom | What to check |
| --- | --- |
| `role "USER" does not exist` | Actual PostgreSQL URI/user and schema grants; replace all placeholders |
| Dashboard unexpectedly uses another app's DB | Dedicated `VISUALGUARD_DATABASE_URL`, loaded file, and inherited `DATABASE_URL`/process settings |
| Empty history after a restart | Same calling directory/absolute data directory or database; selecting a new DB does not migrate data |
| Project-bound test fails before capture | Project already exists, unique name/ID, dashboard version and correct project token |
| Upload fails after successful capture | Inspect retained local run and retry saved evidence; check token, canonical host, DB/network limits |
| Missing package/command/UI | Installed version supports it; rebuild source candidates explicitly instead of assuming npm tracks `main` |
| Google callback rejected | Exact origin/callback, configured test users/audience, complete OIDC settings and login mode |
| MongoDB transaction/admission error | Replica set primary/network access, correct URI and appropriate `invite`/limited `legacy` choice |
| Vercel page reload returns 404 | Generated SPA rewrite for that supported page, without breaking API routing |
| Cloud Run starts then loses data | A real external DB is required; never rely on a container-local SQLite file |

Before sharing a hosted instance, verify health, login, role isolation, a small/large run, image retrieval after redeploy and an isolated native restore. Test signed webhooks/scheduled reconciliation if advertised. Keep unsupported preview hosts and databases separate.

The two final guides replace the earlier phase/setup walkthroughs. Examples, local links and configuration syntax are checked during documentation work; no live cloud/database deployment, application build, formatter, lint, type check or behavioral suite was run for this consolidation. The [historical release record](RELEASE-3.1.0-VALIDATION.md) describes its own tested release only.
