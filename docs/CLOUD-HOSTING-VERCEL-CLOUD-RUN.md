# VisualGuard cloud hosting: Vercel and Google Cloud Run

Prepared: 17 October 2026. Product source reviewed: `main` at `8cf7c86`.

Use one customer-owned installation per organization, with multiple users and projects inside it. This guide covers the two requested hosting options and explains exactly where uploaded images persist. It describes setup commands for the operator to run; no cloud deployment was performed while writing it.

## Contents

- [Choose a host](#1-choose-a-host)
- [Where images are saved](#2-where-images-are-saved)
- [Shared prerequisites and settings](#3-shared-prerequisites-and-settings)
- [Vercel setup](#4-deploy-on-vercel)
- [Google Cloud Run setup](#5-deploy-on-google-cloud-run)
- [First visual test](#6-create-a-project-and-publish-the-first-visual-test)
- [Optional integrations](#7-enable-integrations-after-the-first-successful-run)
- [Backups, upgrades and acceptance checks](#8-backups-upgrades-and-production-acceptance)
- [Minimal customer onboarding to ship](#9-minimal-customer-onboarding-to-ship)

## 1. Choose a host

| Choice | Suggested database | Why choose it | Main setup responsibility |
| --- | --- | --- | --- |
| Vercel | Managed PostgreSQL, for example Neon through the Vercel Marketplace | Familiar deployment flow for frontend teams; no container administration | Database integration, canonical URL, serverless limits and correct function routing |
| Google Cloud Run | Cloud SQL for PostgreSQL in the same region | Customer already uses Google Cloud or wants its runtime, database and secrets in one cloud project | Google Cloud billing, IAM, Cloud SQL connectivity and Secret Manager |

For the simplest customer-facing onboarding, I would lead with **Vercel plus managed PostgreSQL**, after validating the actual installation bundle on Vercel. Offer **Cloud Run plus Cloud SQL** as the Google Cloud route. Cloud Run gives the existing Node server a direct container deployment; Vercel needs its generated function/static-assets layout. Neither route requires the customer to host each user's account separately.

Vercel offers PostgreSQL integrations through its Marketplace; this does not mean the dashboard receives a database merely by deploying its code. Create/connect that resource explicitly. [Vercel Marketplace storage](https://vercel.com/docs/marketplace-storage).

**Release boundary:** the reviewed source has both deployment scaffold commands, but these instructions are not a live-production certification. Use a tested tarball containing the latest advertised features. npm `3.1.0` metadata inspected on this date points to an earlier commit than the reviewed F07 source. Do not assume `npx visualguard@latest` contains every current feature. See [release preparation](SELF-HOSTING-AND-MARKET-LAUNCH.md#4-publisher-preparation-make-the-installation-artifact).

## 2. Where images are saved

**Uploaded screenshots are currently saved inside the customer's configured database.** Hosting on Vercel or Cloud Run does not change that storage design.

| Deployment | Persistent screenshot location | Other persistent data |
| --- | --- | --- |
| Vercel + Neon/PostgreSQL | That customer's PostgreSQL database | Projects, runs, users, sessions, reviews, baselines, policies and audit state in the same database |
| Cloud Run + Cloud SQL | That customer's Cloud SQL PostgreSQL database | The same platform data |
| Either host + MongoDB | The configured MongoDB database | Metadata/state in its corresponding collections; invite mode requires transaction-capable MongoDB |
| Local dashboard without an external DB | Local `.visualguard/platform/metadata.sqlite` by default | Metadata and new artifacts in the SQLite database |

### How a screenshot reaches the cloud

1. Playwright runs on the developer's machine or the customer's CI runner and captures the application screenshots/DOM evidence.
2. The local run is written under the configured VisualGuard output directory, normally `.visualguard/runs/`.
3. A project-bound `visualguard test` or explicit `dashboard publish` uploads evidence over HTTPS with a project upload token.
4. The dashboard stores the bytes as database-backed artifact objects. PostgreSQL uses `vg_objects` for object metadata and `vg_object_chunks` for 1 MiB chunks encoded as base64 text. MongoDB uses collections with the same names.
5. Authorized dashboard users retrieve the evidence through the dashboard API. Identical object hashes reuse existing content within the installation.

Capturing a local run alone does not back it up to the cloud. A successful publish is needed. Local/CI copies remain governed by the runner's own cleanup and artifact-retention settings.

### What you do not need to configure today

- No Google Cloud Storage, S3 or Vercel Blob bucket is required for the current implementation.
- There is no implemented bucket-setting switch that moves new screenshots to those services.
- Do not store the production database or screenshot history under the serverless/container filesystem. The runtime requires an external database when `VERCEL` or `K_SERVICE` identifies these hosts.
- The dashboard does not install browsers or execute the customer's visual tests merely because it is hosted.

### Capacity, cost and backups

Image storage is billed as **database storage**, plus applicable database compute, backups and network traffic. The application host can also charge for requests/compute/transfer. Check the customer's actual provider plans before quoting a price.

Base64 text uses approximately four bytes for every three source bytes, before database compression, indexes, backup/WAL and other overhead. For example, 10 GB of unique image/DOM bytes would be about 13.3 GB of encoded text before those effects; this is arithmetic, not a measured database size. Repeated identical content can reduce additional storage through deduplication.

Set a history-retention policy with the customer and monitor actual database size. Use supported dashboard deletion flows; approved baselines/reference checks can protect evidence, and cleanup must not destroy referenced history. No automated retention schedule is introduced by this guide. Native database backups cover new image chunks and platform state together. An app redeploy is not an image backup.

If screenshot volume becomes large, object storage could become a separate product feature: private bucket support, reference integrity, authorization, migration, retention and restore would all need implementation. Adding `BUCKET_NAME` by itself would not change current storage.

**Source references:** [artifact storage](../apps/platform/server/artifacts.ts), [database schema](../apps/platform/server/database.ts), [MongoDB artifacts](../apps/platform/server/mongo.ts), [database selection](../apps/platform/server/config.ts), [host persistence guard](../apps/platform/server/runtime.ts).

## 3. Shared prerequisites and settings

The maintainer supplies a tested dashboard-enabled `visualguard-RELEASE.tgz`, its checksum, version and matching release notes. The operator needs Node.js 22.12+ locally to generate the deployment folder. Neither installation needs the VisualGuard development monorepo.

Start from a new directory. Replace the tarball path with the real release artifact:

```sh
mkdir visualguard-installer
cd visualguard-installer
npm init -y
npm install --ignore-scripts /absolute/path/visualguard-RELEASE.tgz
```

Keep optional package dependencies enabled: PostgreSQL/MongoDB/OIDC drivers are optional dependencies of the distributed package. Do not add `--omit=optional`.

The dashboard environment is:

| Variable | Value | Required |
| --- | --- | --- |
| `VISUALGUARD_AUTH_MODE` | `login` | Explicit hosted setting |
| `VISUALGUARD_USER_ADMISSION` | `invite` | Recommended admission setting |
| `VISUALGUARD_PUBLIC_URL` | Exact canonical HTTPS origin, without a path | Yes |
| `VISUALGUARD_DATABASE_URL` | Dedicated PostgreSQL URI, with provider-required connection/TLS settings | Yes |
| `VISUALGUARD_ADMIN_EMAIL` | Customer's first administrator email | Fresh installation |
| `VISUALGUARD_ADMIN_PASSWORD` | Unique private password, 12–256 characters | Fresh password admin |

Generate a password with `openssl rand -hex 24`, or a password manager. Store secrets in the host's private configuration, not Git, screenshots, browser-exposed variables or a Docker image. Do not prefix these values with `NEXT_PUBLIC_` or `VITE_`.

Database role note: use a real dedicated database username, not a literal `USER` placeholder or the operator's laptop username. The account must be allowed to initialize/update VisualGuard's `vg_*` tables and indexes in its database. URI-encode reserved characters in credentials, or use the provider-generated URI.

Initial admin creation runs once. Changing `VISUALGUARD_ADMIN_PASSWORD` later does not reset an existing account. Use the existing account/admin password workflows for changes.

## 4. Deploy on Vercel

### Step 1 — Generate the Vercel project

From the installer directory created above:

```sh
npx --no-install visualguard dashboard init \
  --target vercel \
  --out visualguard-vercel \
  --package /absolute/path/visualguard-RELEASE.tgz
cd visualguard-vercel
npm install --ignore-scripts
```

The generated folder includes `api/dashboard.mjs`, `vercel.json`, `package.json` and the bundled `visualguard.tgz`. The build copies the dashboard's prebuilt static assets into `public`; the Node function handles the API. Deploy this folder as an **Other** project, not as a Next.js application or the entire monorepo.

### Step 2 — Check the generated routes

The source revision reviewed here omits `/policies` from the generated Vercel rewrites. A correction exists on the separate rollout-validation branch, but is not in this reviewed `main`. Until the released generator includes it, add this object to `vercel.json`'s `rewrites` array:

```json
{ "source": "/policies", "destination": "/index.html" }
```

Keep the generated API rewrite and routes for `/runs/:path*`, `/settings`, `/operations`, `/reviews`, `/baselines`, `/invite` and `/`. Do not replace all requests with `index.html`, because API calls must reach the function. Check the released scaffold rather than assuming its contents match this document forever.

### Step 3 — Create the Vercel project and database

1. Put the generated deployment folder in a customer-owned deployment repository. Include its package/lockfile/tarball and scaffold files. Exclude `.env*` files containing real values and `.visualguard/`.
2. Import that repository into the customer's Vercel account. Select the directory containing the generated `package.json` as the root.
3. Use **Other** as the framework, Node.js **22.x**, build command `npm run build`, and output directory `public`. Keep the generated `vercel.json`.
4. Create/connect a dedicated PostgreSQL resource through the Vercel Marketplace, or use an existing managed PostgreSQL database. Select an appropriate database and function region close to each other.
5. Obtain its PostgreSQL connection URI, using the provider's pooled endpoint suitable for serverless workloads and its prescribed TLS settings. The dashboard uses the standard `pg` driver, not a provider-specific HTTP database SDK.
6. Put that URI into `VISUALGUARD_DATABASE_URL`. Provider integration variables may have different names: confirm the mapping explicitly. `DATABASE_URL` is supported as a fallback, but the dedicated variable avoids accidentally selecting an unrelated application's database.

Do not install schema-specific Prisma/Drizzle adapters for VisualGuard: it initializes its own schema through the database connection. [Marketplace database setup](https://vercel.com/docs/marketplace-storage).

### Step 4 — Add Production environment settings

Add all settings from section 3 in **Project Settings → Environment Variables**, scoped to **Production**. Use the stable project production hostname, for example:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_USER_ADMISSION=invite
VISUALGUARD_PUBLIC_URL=https://visualguard-customer.vercel.app
VISUALGUARD_DATABASE_URL=THE_PROVIDER_POSTGRESQL_URI
VISUALGUARD_ADMIN_EMAIL=owner@customer.com
VISUALGUARD_ADMIN_PASSWORD=THE_PRIVATE_INITIAL_PASSWORD
```

Confirm the actual hostname Vercel assigns; the example is not a reserved domain. If the hostname is only known after first deployment, update the canonical URL to the real project production origin and redeploy before testing login. Use the stable production alias rather than an individual deployment's changing URL.

Keep previews disabled or give them an isolated database and their own exact public URL. Never point arbitrary preview deployments at the production database or expect a production-only canonical origin to accept every preview host. Environment changes apply to new deployments. [Vercel environments](https://vercel.com/docs/deployments/environments).

### Step 5 — Deploy and check

Deploy the production branch in Vercel. Alternatively, from the generated project folder with Vercel CLI installed and authenticated:

```sh
vercel link
vercel --prod
curl --fail https://visualguard-customer.vercel.app/api/health
```

The health endpoint should return HTTP 200 and `{"status":"ok"}`. Check function logs if startup reports missing credentials, database permissions or connectivity failures. Health only checks access to platform state; also sign in and verify the feature pages/upload flow below. [Vercel deploy CLI](https://vercel.com/docs/cli/deploy).

### Step 6 — Add a custom domain, optionally

Add `visualguard.customer.com` under the project's Domains settings and create the requested DNS records. After HTTPS is active, change `VISUALGUARD_PUBLIC_URL` to `https://visualguard.customer.com` and redeploy. Use that hostname for login, CLI clients and integrations. Alternate Vercel aliases are not automatically accepted as dashboard API origins. [Vercel domain configuration](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

### Step 7 — Verify serverless behavior

Vercel documents a 4.5 MB function request/response payload limit. VisualGuard already uploads evidence in 1 MiB chunks and supports chunked dashboard/CLI artifact retrieval; a large screenshot is not sent as one giant upload request. The current API explicitly rejects direct unchunked artifact downloads larger than 3 MiB on Vercel and instructs clients to use chunks. Validate a real large screenshot and a large run, including the manifest and baseline pull, with the exact installed release. [Vercel function limits](https://vercel.com/docs/functions/limitations).

Also test a cold request after inactivity and database connection behavior during concurrent requests. The current PostgreSQL pool permits up to five connections per runtime instance; serverless scaling can create multiple pools. Select provider capacity/pooling accordingly. Do not interpret `maxDuration: 300` in the generated scaffold as proof that every operation finishes within provider limits.

GitHub webhooks require their original raw request bytes. Verify signed delivery on the actual Vercel deployment before enabling check integration; a host-parsed JSON body cannot be reconstructed as the original signed body. Do not describe the integration as production-validated from source tests alone.

Continue to section 6 for the first visual comparison.

## 5. Deploy on Google Cloud Run

This reference path uses **Cloud Run + Cloud SQL PostgreSQL + Secret Manager**, with the customer's own Google Cloud project. An externally hosted PostgreSQL service can also be used by providing its reachable TLS connection URI; in that case skip Cloud SQL-specific attachment/roles and configure the provider's networking instead.

### Step 1 — Prepare the Google Cloud project

Create/select a Google Cloud project, enable billing and install/authenticate the Google Cloud CLI, or use Cloud Shell. Set these non-secret values, replacing the placeholders:

```sh
gcloud auth login
export VG_PROJECT_ID="customer-gcp-project"
export VG_REGION="us-central1"
export VG_SERVICE="visualguard-dashboard"
export VG_SQL_INSTANCE="visualguard-postgres"
export VG_RUNTIME_SA="visualguard-runtime@${VG_PROJECT_ID}.iam.gserviceaccount.com"
gcloud config set project "$VG_PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com
```

Choose a region appropriate for the customer's data location and use it consistently. Source deployment needs deployment/build IAM permissions in addition to the runtime's database/secret permissions. Have the project administrator configure the documented deployer roles and the source build service account's `roles/run.builder` before deployment. That build identity is separate from `VG_RUNTIME_SA`. Do not solve a failed build by assigning Owner to the dashboard runtime account. [Source deployment prerequisites](https://docs.cloud.google.com/run/docs/deploying-source-code).

### Step 2 — Create Cloud SQL and the application database

In Cloud SQL:

1. Create a supported PostgreSQL instance named `visualguard-postgres` in the selected region. Choose capacity, availability and retention appropriate to the customer; database operation can incur charges even when Cloud Run has no active requests.
2. For this reference recipe, enable the instance's public IP connection path and use Cloud Run's built-in Cloud SQL attachment/Auth Proxy. Do not add `0.0.0.0/0` to authorized networks. An organization requiring private-IP-only SQL needs Direct VPC egress or a connector instead of assuming this recipe provides private networking.
3. Create a dedicated database user `visualguard` with a strong password. Using a generated hexadecimal password makes the example URI straightforward.
4. Create the database `visualguard`. Give the application user permission to initialize its schema. As a database administrator, connect to that database and grant:

```sql
GRANT CONNECT ON DATABASE visualguard TO visualguard;
GRANT USAGE, CREATE ON SCHEMA public TO visualguard;
```

5. Record the instance connection name, in the form `PROJECT_ID:REGION:INSTANCE_ID`.
6. Enable appropriate backups/PITR and deletion protection; verify those choices against the selected instance/plan.

Cloud Run's attached socket is available at `/cloudsql/INSTANCE_CONNECTION_NAME`; this recipe uses that socket, not a public database password connection directly to port 5432. [Cloud SQL connections from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run).

### Step 3 — Create a runtime identity and private secrets

Create the service account and grant its database connection role:

```sh
gcloud iam service-accounts create visualguard-runtime \
  --display-name="VisualGuard dashboard runtime"
gcloud projects add-iam-policy-binding "$VG_PROJECT_ID" \
  --member="serviceAccount:${VG_RUNTIME_SA}" \
  --role="roles/cloudsql.client"
```

In **Secret Manager**, create two secrets and their first enabled versions:

| Secret name | Secret value |
| --- | --- |
| `visualguard-db-url` | PostgreSQL URI shown below, with the real password and connection name |
| `visualguard-admin-password` | Separate strong initial dashboard password |

For the database URL, replace the placeholders:

```text
postgresql://visualguard:HEX_DATABASE_PASSWORD@localhost:5432/visualguard?host=%2Fcloudsql%2FPROJECT_ID%3AREGION%3AINSTANCE_ID
```

The query's `host` value is the URI-encoded socket directory `/cloudsql/PROJECT_ID:REGION:INSTANCE_ID`; it overrides the placeholder TCP host. Use the actual instance connection name. This uses the existing `pg` connection-string support for Unix sockets; VisualGuard does not add a new Cloud SQL connector library. This exact recipe still requires a live connection check. [node-postgres connections](https://node-postgres.com/features/connecting), [connection-string formats](https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/README.md).

Grant this service account access to those two secrets, individually:

```sh
gcloud secrets add-iam-policy-binding visualguard-db-url \
  --member="serviceAccount:${VG_RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding visualguard-admin-password \
  --member="serviceAccount:${VG_RUNTIME_SA}" \
  --role="roles/secretmanager.secretAccessor"
```

The deployment below pins secret version `1`; if these are existing secrets, select their correct enabled version instead. New secret versions require an intentional service update. [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

### Step 4 — Generate the deployment folder

From the shared installer directory in section 3:

```sh
npx --no-install visualguard dashboard init \
  --target cloud-run \
  --out visualguard-cloud-run \
  --package /absolute/path/visualguard-RELEASE.tgz
cd visualguard-cloud-run
npm install --ignore-scripts
```

Run subsequent deployment commands from this generated directory. Its Dockerfile installs the tested tarball, runs as a non-root user, listens on Cloud Run's `PORT`, and starts the dashboard on `0.0.0.0`. Browsers execute elsewhere. Source deployment uses the included Dockerfile to build the container; it does not require Docker on the operator's laptop. [Cloud Run source builds](https://docs.cloud.google.com/run/docs/deploying-source-code).

Create `.gcloudignore` in this directory to explicitly limit the uploaded build context:

```text
.gcloudignore
.git
.gitignore
node_modules
.env
.env.*
.visualguard
output
```

Keep `visualguard.tgz`, `Dockerfile` and `package.json` in the context. They are needed to build. Include the package lockfile when distributing the tested deployment bundle.

### Step 5 — Bootstrap a private Cloud Run service

The canonical `run.app` URL is easiest to obtain after creating the service. For a **new service**, deploy initially with private invocation and a temporary, deliberately unusable origin. Replace the email below. Keep the variables from step 1 in this terminal.

```sh
gcloud run deploy "$VG_SERVICE" \
  --source . \
  --project "$VG_PROJECT_ID" \
  --region "$VG_REGION" \
  --execution-environment gen2 \
  --service-account "$VG_RUNTIME_SA" \
  --add-cloudsql-instances "${VG_PROJECT_ID}:${VG_REGION}:${VG_SQL_INSTANCE}" \
  --set-env-vars "VISUALGUARD_AUTH_MODE=login,VISUALGUARD_USER_ADMISSION=invite,VISUALGUARD_PUBLIC_URL=https://setup.invalid,VISUALGUARD_ADMIN_EMAIL=owner@customer.com" \
  --set-secrets "VISUALGUARD_DATABASE_URL=visualguard-db-url:1,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1" \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances 3 \
  --no-allow-unauthenticated
```

The capacity values are starting settings to evaluate, not measured limits or sizing guarantees. Test them with representative runs. Even five database connections per instance must fit the database's overall connection budget; account for revisions, jobs and administrative tools.

This bootstrap service is intentionally not ready for browser login yet. If it fails startup, inspect Cloud Run logs for missing secrets, IAM, SQL attachment, role/schema permissions or socket/URL mistakes. Do not proceed just because a build succeeded.

### Step 6 — Set the real canonical URL and allow dashboard access

Obtain and apply the service URL:

```sh
export VG_PUBLIC_URL="$(gcloud run services describe "$VG_SERVICE" \
  --project "$VG_PROJECT_ID" \
  --region "$VG_REGION" \
  --format='value(status.url)')"

gcloud run services update "$VG_SERVICE" \
  --project "$VG_PROJECT_ID" \
  --region "$VG_REGION" \
  --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_PUBLIC_URL}"
```

After the new revision is ready, allow requests to reach the product's own login/token authentication:

```sh
gcloud run services add-iam-policy-binding "$VG_SERVICE" \
  --project "$VG_PROJECT_ID" \
  --region "$VG_REGION" \
  --member="allUsers" \
  --role="roles/run.invoker"

curl --fail "$VG_PUBLIC_URL/api/health"
```

Public invocation allows a browser/CI to reach the service; the dashboard still requires login/project credentials for private data. If the customer's organization policy forbids public invocation, this standard onboarding route needs a separate authenticated ingress/IAP design; the current CLI does not automatically obtain a Google IAM invocation token.

Open the exact `VG_PUBLIC_URL`, sign in and create a test project. Deploy a new revision and confirm the project/evidence remains: it lives in Cloud SQL, not the replaced container.

### Step 7 — Add a custom domain, optionally

The generated HTTPS `run.app` URL is enough for the first installation. For a production custom domain, use a production-supported ingress option, such as an external Application Load Balancer with a serverless NEG, following Google's guide. Google's direct Cloud Run domain-mapping feature is currently documented as preview and not recommended for production; do not make it the default production recipe. [Cloud Run domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

After DNS, certificate and forwarding are working, change `VISUALGUARD_PUBLIC_URL` to the custom HTTPS origin, deploy a new revision and retest login, upload and callbacks using that origin. Preserve the external Host header through any added proxy. Include load balancer costs in the customer's hosting estimate if using one.

## 6. Create a project and publish the first visual test

The workflow is the same for both hosts.

1. Sign in using the bootstrap admin. Open **People & integrations**, create/select project `storefront`, and create a project upload token.
2. Add colleagues with the existing invitation/account controls. The installation is shared by the organization; each person has their own identity/permissions. Invitations are copied/shared links; the dashboard does not currently send invitation emails.
3. In the customer's application repository, install the matching tested release and browser support:

```sh
npm install -D /absolute/path/visualguard-RELEASE.tgz playwright
npx playwright install chromium
```

4. Create `visualguard.config.json` with the customer's production/staging application URLs:

```json
{
  "baseURL": {
    "production": "https://www.customer.com",
    "staging": "https://staging.customer.com"
  },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" }
}
```

5. Put the following in an ignored `.env.local` in that application repository, or the CI secret manager. Use the chosen dashboard's canonical URL:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://YOUR_CANONICAL_DASHBOARD_HOST
VISUALGUARD_UPLOAD_TOKEN=THE_PROJECT_UPLOAD_TOKEN
```

6. Make a deliberate button-color change in staging and run:

```sh
npx visualguard test storefront --config visualguard.config.json --no-ai
```

The runner must reach both application environments and the dashboard. The test command loads `.env`/`.env.local`; existing process values take precedence. A detected regression may produce a nonzero test exit even when evidence was successfully saved. Inspect the reported result.

7. Open the published run, inspect the screenshots and review the change with another user. Restart/redeploy the dashboard and open the same run again to verify persistence.
8. When ready, follow the [approved baseline guide](APPROVED-BASELINES.md) to promote reviewed evidence and pin future comparisons to it.

## 7. Enable integrations after the first successful run

### Google sign-in

Create a customer-owned Google OAuth web client and register the exact callback:

```text
https://YOUR_CANONICAL_DASHBOARD_HOST/api/auth/callback
```

Add the following as server-side settings/secrets, then redeploy:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=THE_CUSTOMER_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET=THE_CUSTOMER_CLIENT_SECRET
```

Keep login/invite mode. Existing password users should explicitly link Google through their account flow; do not assume an email match merges identities. Keep a recovery admin and test a second invited account. See [Google setup](GOOGLE-SIGN-IN.md), [account linking](GOOGLE-ACCOUNT-LINKING.md) and [invitations](TEAM-INVITATIONS.md).

### GitHub checks and reconciliation

Follow the [visual policy guide](VISUAL-REGRESSION-POLICY.md) for server credentials, repository mapping, webhook secret and project policy. Start in Informative mode; test a signed PR webhook against the real host before making a check required.

Schedule the existing `dashboard policy reconcile` CLI with the installed release and a project upload token, through the customer's CI scheduler or a separately configured job. Merely hosting the dashboard does not schedule it. Vercel Cron or Cloud Scheduler cannot run an arbitrary CLI command just by naming it: an appropriate job/handler must be configured. No unattended background loop is established by this guide.

GitHub installation-token renewal remains an operator responsibility in the current integration. Customer-owned credentials, expiry handling and delivery failures need an explicit operating procedure. Enable AI only when the customer chooses its provider/data handling.

## 8. Backups, upgrades and production acceptance

### Back up and restore the database

- On Vercel's PostgreSQL provider, enable the chosen plan's supported backups/PITR and test restore into a separate database.
- On Cloud SQL, configure backups/PITR, retention, deletion protection and restore ownership in the customer's project. [Cloud SQL backup overview](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/backups).
- Preserve environment configuration and Secret Manager references separately. Database recovery does not recreate provider IAM, DNS or OAuth registrations.
- Restore to an isolated database/dashboard first; confirm an old run's screenshots, accounts, reviews and baseline selection. A native DB backup includes new image chunks; portable `.vgbackup.gz` evidence export intentionally omits authentication state and is not the whole installation backup.

Legacy file-backed F01 artifacts, if migrating an old installation, require the matching old objects directory or a portable export that gathers those referenced files. A new cloud installation should not depend on that directory.

### Validate before handing the installation to a customer

- `/api/health` returns 200, then a real login works.
- Direct navigation/refresh works for `/settings`, `/operations`, `/reviews`, `/baselines`, `/policies`, `/invite` and a saved run.
- Two users see only their authorized projects; disable/revoke behavior works.
- A complete small run and a large screenshot/manifest publish and open; baseline pull also succeeds.
- Runs and image bytes survive a cold start/redeploy and compare correctly after restore.
- Incorrect host/token requests are rejected without exposing private evidence.
- Signed webhooks and scheduled reconciliation work if those integrations are advertised.
- Backup/restore ownership, alerts, supported artifact version and upgrade procedure are recorded.

Before upgrading, back up, restore to a test environment, install the new pinned artifact, check schema compatibility and then promote. A provider's previous deployment image does not roll back a migrated database. Do not treat a button in the hosting dashboard as a complete database rollback procedure.

## 9. Minimal customer onboarding to ship

For the market introduction, provide two visible routes: **Deploy on Vercel** and **Deploy on Google Cloud Run**. Supply a tested deployment repository/bundle for each, pin the software version and attach these instructions. These buttons/templates still need implementation and clean-account validation; do not advertise a completed one-click setup yet.

Customers should initially supply only their hosting account, admin email/password and optional custom domain. The Vercel flow should guide database provisioning; Google Cloud setup should provision/attach Cloud SQL and secrets through a reviewed deployment template. Google login and GitHub checks come after the first shared visual comparison.

Keep **one installation per customer team**, customer-owned infrastructure/secrets and optional paid setup/support as the launch model. Use pilot installations to measure friction, real storage growth, restore/upgrade reliability and support time before broader marketing. The broader [launch plan](SELF-HOSTING-AND-MARKET-LAUNCH.md) contains positioning and service responsibilities.

## Validation scope

This is a documentation change checked against the listed source files and current official provider references. Local links, JSON examples and shell syntax were checked during authoring. The installed PostgreSQL connection-string parser also resolved the example URI to the expected Cloud SQL socket without making a database connection. No Vercel/Google Cloud resources, databases, domains, OAuth clients, webhooks or production secrets were created; no live cloud smoke/restore/load test was performed. Provider plan availability, limits and IAM defaults can change, so recheck the linked official pages during the release validation.
