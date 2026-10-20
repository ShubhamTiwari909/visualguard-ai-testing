# Install VisualGuard in any project: visual tests and dashboard

For an explanation of all product capabilities before setup, read the [product feature guide](PRODUCT-FEATURES.md).

This is the complete user setup guide for the published npm package. You do not need to clone VisualGuard or build its source. For repository development and testing the latest merged features, use [local source setup](LOCAL-SETUP.md).

Every `npx --no-install visualguard` command below runs the npm package installed in **your application**, not this repository's source CLI. Work at that application's root. Keep its reference/candidate servers running, use a separate terminal for a dashboard, and run comparisons in another terminal. Choose one storage workflow; PostgreSQL and MongoDB are alternatives, not simultaneous requirements.

## Contents

- [1. Choose your setup](#1-choose-your-setup)
- [2. Run visual regression only in another project with npx](#2-run-visual-regression-only-in-another-project-with-npx)
  - [Initialize the project with npx](#initialize-the-project-with-npx)
  - [Understand the generated TypeScript config](#understand-the-generated-typescript-config)
  - [Optional JSON configuration](#optional-use-a-manually-maintained-json-config)
- [3. Run visual regression with AI in another project with npx](#3-run-visual-regression-with-ai-in-another-project-with-npx)
- [4. Use local reports and baselines](#4-use-local-reports-and-baselines)
- [5. Run npx visual regression with a local SQLite dashboard](#5-run-npx-visual-regression-with-a-local-sqlite-dashboard)
- [6. Run npx visual regression with PostgreSQL](#6-run-npx-visual-regression-with-postgresql)
- [7. Run npx visual regression with MongoDB](#7-run-npx-visual-regression-with-mongodb)
- [8. Enable login and connect other projects](#8-enable-login-and-connect-other-projects)
- [9. Deploy to Vercel or Google Cloud Run](#9-deploy-to-vercel-or-google-cloud-run)
- [10. Understand storage, backups and upgrades](#10-understand-storage-backups-and-upgrades)
- [11. Team reviews, approved baselines and GitHub checks](#11-team-reviews-approved-baselines-and-github-checks)
- [12. Troubleshooting and final checks](#12-troubleshooting-and-final-checks)
- [13. Command reference](#13-command-reference)

## 1. Choose your setup

| You want                                 | Database requirement                                           | Login / token                                      |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| Visual tests and HTML reports only       | None                                                           | None                                               |
| Local dashboard/history on your computer | SQLite created automatically; no database service              | None in default loopback local mode                |
| Local dashboard with PostgreSQL          | Dedicated PostgreSQL database                                  | Optional login; token needed when login is enabled |
| Local dashboard with MongoDB             | Dedicated MongoDB database; replica set for full team features | Same as PostgreSQL                                 |
| Shared dashboard on Vercel/Cloud Run     | External PostgreSQL or transaction-capable MongoDB             | Login and project upload tokens                    |

“Without database” applies literally to standalone visual tests. The dashboard's zero-setup option is an embedded SQLite file. You do not have to install PostgreSQL or MongoDB to use the product locally.

Use one hosted installation per customer organization/team. That instance can contain multiple projects/users with separate permissions; each person does not need their own server.

**Version boundary:** this source release is `visualguard@3.2.0`, which includes the Google onboarding, administration, approved baselines and visual-policy features in section 11. Registry metadata checked on 19 October 2026 reported `3.2.0`. Check `npm view visualguard version` before installing a specific release; source changes merged after publication require a later package release. See the [3.2.0 upgrade notes](../packages/visualguard/CHANGELOG.md#upgrade-from-310) before updating an existing hosted installation. Keep client/server releases compatible and pin the version in the lockfile.

## 2. Run visual regression only in another project with npx

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

### Initialize the project with npx

Start your application normally, for example with `npm run dev`. From that application's root, run the setup wizard:

```sh
npx --no-install visualguard init
```

This is the installed-package form of `npx visualguard init`. The wizard asks for:

1. Your production/reference URL and staging/candidate URL, such as `https://your-app.example.com` and `http://127.0.0.1:3000`.
2. Routes to test and viewport presets.
3. An AI provider; choose **None** for the first visual-only run.
4. Whether to add a GitHub Actions workflow; you can decline for local setup.

For setup without prompts, use real reachable application URLs:

```sh
npx --no-install visualguard init --yes \
  --production https://your-app.example.com \
  --staging http://127.0.0.1:3000 --ai none
```

Choose the wizard or the noninteractive command, not both. Noninteractive setup selects discovered routes and the desktop/mobile viewport presets; review the generated file before running tests. These URLs describe the application under test, not the dashboard. For a fully local comparison, use two application servers on different ports.

### Understand the generated TypeScript config

On a fresh project, `init` creates **`visualguard.config.ts`**. Keep that file for the commands in this guide; do not rename it to `.json`. VisualGuard loads the TypeScript config directly, including in JavaScript applications, without a separate TypeScript compilation step.

The wizard can also add a `visual` script to `package.json` if absent, update `.gitignore`, save a supplied Gemini key in `.env.local`, and create the GitHub workflow if selected. It does not create a database, dashboard server or dashboard project. Keep existing files when already configured; `--force` deliberately overwrites the discovered config.

A minimal config using the same format is:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://your-app.example.com",
    staging: "http://127.0.0.1:3000",
  },
  routes: ["/"],
  viewports: {
    desktop: { width: 1280, height: 800 },
  },
  ai: { provider: "none" },
});
```

The generated file can have additional discovered routes, viewports, comments and stabilization settings. Edit its existing values rather than replacing it blindly with this smaller example. `init --ai none` sets the provider during setup; later tests use `--provider gemini` or `--provider ollama` when enabling AI.

### Optional: use a manually maintained JSON config

JSON is supported when explicitly selected, but `init` generates TypeScript. If you deliberately prefer JSON, create `visualguard.config.json` instead of running the initializer, using the same config fields as plain JSON without the import/export or `defineConfig` wrapper. For example:

```json
{
  "baseURL": {
    "production": "https://your-app.example.com",
    "staging": "http://127.0.0.1:3000"
  },
  "routes": ["/"],
  "viewports": { "desktop": { "width": 1280, "height": 800 } },
  "ai": { "provider": "none" }
}
```

Run it with `npx --no-install visualguard test --config visualguard.config.json --no-ai`. Automatic discovery finds supported JavaScript/TypeScript filenames, not this JSON filename. The remaining examples use the generated `.ts` file; replace their `--config` path only if you chose JSON. Keep one intended config to avoid testing different settings accidentally.

### Compare and inspect

```sh
npx --no-install visualguard test --config visualguard.config.ts --no-ai
npx --no-install visualguard report --config visualguard.config.ts
```

Change a button's color or spacing in staging, rerun and inspect reference/candidate/diff views and findings. Reports are saved under `.visualguard/runs/RUN_ID/` by default. The report command serves the selected run locally until Ctrl+C.

A plain `test` without a project argument stays offline. No dashboard, database, upload token or AI key is required. A nonzero test exit may mean a detected regression rather than installation failure; read the saved report/status. Use `doctor --config visualguard.config.ts` to inspect configuration/reachability.

### Optional authentication for application pages

For logged-in application pages, use the existing capture authentication workflow, for example `npx --no-install visualguard auth staging --config visualguard.config.ts`, and the corresponding production setup. Add the saved state paths as an `environments` property inside your existing `defineConfig({ ... })` object so captures use them:

```ts
  environments: {
    production: { storageState: ".visualguard/auth/production.json" },
    staging: { storageState: ".visualguard/auth/staging.json" },
  },
```

This is a property fragment, not a second config file. Keep the existing URLs, routes and viewport settings. Application login cookies belong to the runner, not dashboard account login.

## 3. Run visual regression with AI in another project with npx

**Use this section when:** VisualGuard is installed in your application and you want AI-assisted visual analysis. Complete section 2 first. Keep the tested application environments running. The AI-enabled runner still works without a dashboard or database.

### Gemini

1. Create a Gemini API key using [Google's API-key instructions](https://ai.google.dev/gemini-api/docs/api-key).
2. Add the key to an ignored `.env.local` in the **application root**, or its CI secret manager:

```dotenv
GEMINI_API_KEY=YOUR_REAL_GEMINI_API_KEY
```

3. From that application root, run:

```sh
npx --no-install visualguard test --config visualguard.config.ts --provider gemini
npx --no-install visualguard report --config visualguard.config.ts
```

Do not append `--no-ai`. `--provider gemini` overrides the sample config's `ai.provider: none`; just removing `--no-ai` would not enable that config's AI. The test loads `.env`/`.env.local`, with existing process variables taking precedence. The key belongs to the visual-test runner, not the dashboard database or Google sign-in client.

Check the saved analysis/provider information in the report. Missing/invalid keys, quota, model access or network errors can cause deterministic fallback, so a completed report alone is not proof an AI request succeeded. By default, AI targets uncertain changes; use `ai.analyze: "all"` to explain deterministic regressions too. `ai.advisory: true` adds explanation without changing deterministic statuses. These are properties to merge into the existing `ai` configuration, not separate top-level settings.

To select an account-supported model explicitly, add `--model YOUR_MODEL_ID`. Configure token/call/time budgets for repeatable CI rather than assuming unlimited model access. AI does not authorize team approvals or bypass capture problems.

### Local Ollama

Install/start Ollama following its [official setup](https://docs.ollama.com/quickstart), then download a compatible vision model such as [Qwen2.5-VL](https://ollama.com/library/qwen2.5vl):

```sh
ollama pull qwen2.5vl
```

Leave its local service running; use `ollama serve` if the app has not already started it. From the application root:

```sh
export OLLAMA_HOST=http://127.0.0.1:11434
npx --no-install visualguard test --config visualguard.config.ts \
  --provider ollama --model qwen2.5vl
```

The downloaded local model requires sufficient machine resources but no Gemini API key. Requests use the selected Ollama host. Return to deterministic-only testing with `--no-ai`.

### Add AI to a dashboard-backed test

First complete one dashboard setup below and create its project. Then use the same application-root AI credentials/provider service:

```sh
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --provider gemini
```

This captures, analyzes and publishes in one run. Replace `storefront`/the server with your actual values. For Ollama, replace the provider with `--provider ollama --model qwen2.5vl`. Login-enabled local/hosted dashboards also need the project upload token from section 8. The same command applies to SQLite, PostgreSQL and MongoDB: database choice changes dashboard storage, not the AI integration.

## 4. Use local reports and baselines

### Saved local reference images

To compare one candidate application against stored screenshots, create a separate `visualguard.baseline.ts` configuration:

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

Create a reference only after checking that the current appearance is expected:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines --no-ai
```

After changing the application, compare without the update flag:

```sh
npx --no-install visualguard test --config visualguard.baseline.ts --no-ai
npx --no-install visualguard report --config visualguard.baseline.ts
```

Keep rendering settings consistent. Store local baselines according to your repository/artifact policy. Local baseline creation is different from the later shared **approved baseline registry** described in section 11. Do not update baselines automatically just to make CI pass.

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

## 5. Run npx visual regression with a local SQLite dashboard

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
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The explicit `--server` creates the project in the running dashboard's storage, even if it uses a custom data directory. If using port 4500, change both `--server` and `--dashboard` to that port. For later direct-storage imports, use the same selected `--data-dir`.

The project ID is stable. An exact unique display name also works, such as `test "Storefront Web"`. Repeated creation of an existing ID preserves its name/history rather than resetting it.

### Import an existing offline run

Replace `RUN_ID` with a real run directory containing `manifest.json`:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront --name "Storefront Web"
```

Refresh the dashboard. Import copies/indexes the evidence; deleting the original runner output later does not remove the imported database objects. An incomplete/error run remains visibly incomplete, rather than being turned into a pass by importing it.

## 6. Run npx visual regression with PostgreSQL

**Use this section when:** VisualGuard is installed in another application and you want its dashboard stored in PostgreSQL. Complete section 2 first; work from the application root throughout, with the application environments still running.

Use a dedicated database with a real application user. Stop any dashboard already on port 4400. Changing the database URL selects another workspace; it does not migrate SQLite/MongoDB history automatically. PostgreSQL and MongoDB below are alternative setup paths, not dependencies you must install together.

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
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
```

In the test terminal, run the full PostgreSQL-backed workflow:

```sh
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

Open the stored run and its screenshots, restart the dashboard with the same `.env.visualguard`, and confirm its history remains. For AI plus PostgreSQL, replace `--no-ai` with `--provider gemini` after section 3's key setup, or use its Ollama provider/model flags. This local-owner configuration needs no upload token; login mode does. The app role must be able to create/update `vg_*` tables/indexes; an existing restricted role may need schema grants from its database administrator. Do not copy a literal `USER` placeholder or rely on your laptop's username being a database role.

## 7. Run npx visual regression with MongoDB

**Use this section when:** VisualGuard is installed in your application and you want its dashboard stored in MongoDB. Complete section 2 first and work from your application's root. Use MongoDB Atlas for this setup; no Docker, local database installation or replica-set initialization is needed.

### Get your MongoDB URL

1. Open your MongoDB Atlas project and create or select a cluster.
2. Under **Database Access**, create a database user with read/write access to a dedicated database named `visualguard`. This is a database user, separate from your Atlas website login.
3. Under **Network Access**, add the current public IP of the computer running the dashboard. When hosting later, configure access for the dashboard host instead.
4. Select the cluster's **Connect → Drivers** option and copy its connection string.
5. Replace its username/password placeholders and include `/visualguard` before any `?` options. Keep any connection options provided by Atlas.

For example, this URL includes the required database name:

```text
mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority
```

A URL ending in `.mongodb.net/` or `.mongodb.net/?...` has no database name and fails with `MongoDB URL must include a database name`. URL-encode special characters in credentials, for example `@` as `%40`; do not encode the whole URI. VisualGuard initializes its collections, so you do not need to create them manually. See [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/) and [MongoDB connection-string rules](https://www.mongodb.com/docs/manual/reference/connection-string/).

### Save the connection settings

Create `.env.visualguard` in your application root:

```dotenv
VISUALGUARD_DATABASE_URL="mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
```

Replace the example with your actual Atlas URI. Add `.env.visualguard` to `.gitignore` and keep the credentials private. Keep VisualGuard's optional npm dependencies enabled so its MongoDB driver is installed. The application being tested needs no MongoDB code changes.

### Start the dashboard — terminal A

Stop any dashboard already listening on port 4400, then run:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

Open `http://127.0.0.1:4400` and leave the command running. Use `--env-file` explicitly; dashboard commands do not automatically load this file. Previously exported process settings win over file values, so remove a stale exported `VISUALGUARD_DATABASE_URL` if it points elsewhere. Local mode needs no dashboard password or upload token and must remain on loopback. For shared login, follow section 8.

### Create a project and run tests — terminal B

With the application environments from section 2 still running:

```sh
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The first command creates the dashboard project. The second binds this test execution to `storefront`, captures the comparison and uploads its evidence to the running dashboard. The runner needs the dashboard URL, not the MongoDB password. See the [command reference](#13-command-reference) for each argument.

### Confirm your data is saved

Open the run and its screenshots in the dashboard. In Atlas's collection browser or MongoDB Compass, inspect the `visualguard` database: VisualGuard uses collections such as `vg_projects`, `vg_runs`, `vg_state`, `vg_objects` and `vg_object_chunks`. Metadata and uploaded screenshot/DOM artifacts are stored there. Stop and restart the dashboard with the same environment file and confirm its history remains. Switching the database URL selects a different workspace; it does not migrate existing SQLite/PostgreSQL history.

For AI plus MongoDB, replace `--no-ai` with the configured `--provider gemini` or Ollama flags from section 3. No upload token is needed in local mode; login mode requires one.

### Already have MongoDB?

Use your existing replica-set or sharded deployment's URI with an explicit database name; keep its authentication, TLS and replica-set options. The rest of the workflow is identical. Atlas or another transaction-capable deployment supports the full team workflow.

A standalone local server can use a URI such as `mongodb://127.0.0.1:27017/visualguard` and explicit `VISUALGUARD_USER_ADMISSION=legacy`. It supports ordinary evidence/review/publishing, but invitations, Google account linking, managed lifecycle operations, baseline mutations and administrator recovery require transactions. Use Atlas for a new full-feature installation.

## 8. Enable login and connect other projects

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
npx --no-install visualguard test storefront --config visualguard.config.ts --no-ai
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

## 9. Deploy to Vercel or Google Cloud Run

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
- The published `3.2.0` scaffold omits `/policies`; this source includes the correction for the next release. Preserve routes for `/settings`, `/operations`, `/reviews`, `/baselines`, `/policies`, `/invite`, `/runs/:path*` and `/`. Updating the installed package does not update an existing deployment folder; regenerate into an empty directory and review the configuration, or add `{ "source": "/policies", "destination": "/index.html" }` if absent, then redeploy.
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

Open the canonical URL, sign in, create a project/token and configure your application as in section 8. Keep previews disabled or isolated with their own database/URL. To use a custom domain, add it in Vercel, follow its DNS instructions, then update the canonical URL and redeploy.

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

Open the assigned HTTPS URL and follow section 8. A custom production domain can use a supported ingress option such as an external Application Load Balancer/serverless NEG; update the canonical origin afterward. Google's direct domain mapping is currently documented as preview and not recommended for production. [Cloud Run domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

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

## 10. Understand storage, backups and upgrades

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

Create that ignored `.env.visualguard-sqlite` first with the three local-mode/empty URL settings from section 5, and add it to `.gitignore`. Restoration is append-only/deduplicating and can reject conflicting evidence; prefer a fresh destination rather than expecting overwrite semantics. Legacy file-backed workspaces may require their original `objects/` directory or a portable export collecting it.

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

- **MongoDB:** use the Atlas/deployment backup and restore procedure supported by your cluster. Confirm backup availability and retention for your chosen deployment. If your operator uses MongoDB Database Tools, follow the [MongoDB dump options](https://www.mongodb.com/docs/database-tools/mongodump/) for a consistent backup of the actual deployment; the connection-only setup in section 7 does not configure backups.

Restore into a **separate isolated database** and verify old screenshot bytes, accounts, permissions, reviews and current baselines. A restore also restores historical credential state, so revoke compromised sessions/tokens/invitations before reconnecting an incident recovery. Keep backups private and outside Git/CI artifacts.

### Updates

Pin the next supported package version in both runner and deployment. Rebuild/regenerate hosting assets as required, back up and validate against a restored test database before upgrading production. A previous hosting deployment does not roll back a migrated schema. Stop old writers and upgrade consistently for identity, administration and reference changes.

## 11. Team reviews, approved baselines and GitHub checks

The following describes the feature implementation included in the 3.2.0 release preparation. **Use published version 3.2.0 or newer once available**; installing 3.1.0 does not provide these later controls. For a current-source trial, the [source guide](LOCAL-SETUP.md) provides a complete local color-change/review/baseline/policy exercise.

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

Administrators use **Audit & recovery** for bounded, filtered history and sign-in readiness. Readiness is an inventory, not live-production certification. Host-side administrator recovery is source/operator tooling, not an installed npm recovery endpoint. The [source guide](LOCAL-SETUP.md#10-audit-recovery-and-backups) explains its proof/version/backup/password-file requirements. Never edit identity rows or overwrite password hashes to simulate recovery.

## 12. Troubleshooting and final checks

| Symptom                                                | What to check                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role "USER" does not exist`                           | Actual PostgreSQL URI/user and schema grants; replace all placeholders                                                                                                                      |
| Dashboard unexpectedly uses another app's DB           | Dedicated `VISUALGUARD_DATABASE_URL`, loaded file, and inherited `DATABASE_URL`/process settings                                                                                            |
| Empty history after a restart                          | Same calling directory/absolute data directory or database; selecting a new DB does not migrate data                                                                                        |
| `test "My Application"` ran but the dashboard is empty | Start the dashboard with its actual `--env-file`, then run `test PROJECT --dashboard http://127.0.0.1:4400`; see [missing project/run recovery](#project-or-run-missing-from-the-dashboard) |
| Project-bound test fails before capture                | Project already exists, unique name/ID, dashboard version and correct project token                                                                                                         |
| Upload fails after successful capture                  | Inspect retained local run and retry saved evidence; check token, canonical host, DB/network limits                                                                                         |
| Missing package/command/UI                             | Installed version supports it; rebuild source candidates explicitly instead of assuming npm tracks `main`                                                                                   |
| Google callback rejected                               | Exact origin/callback, configured test users/audience, complete OIDC settings and login mode                                                                                                |
| `MongoDB URL must include a database name`             | Include `/visualguard` before URI query options; do not end the URL at the cluster hostname                                                                                                 |
| MongoDB connection timeout/authentication failure      | Atlas IP access list, database-user credentials/permissions and URL-encoded password; restart after updating the loaded environment file                                                    |
| MongoDB transaction/admission error                    | Replica set primary/network access, correct URI and appropriate `invite`/limited `legacy` choice                                                                                            |
| Vercel page reload returns 404                         | Generated SPA rewrite for that supported page, without breaking API routing                                                                                                                 |
| Cloud Run starts then loses data                       | A real external DB is required; never rely on a container-local SQLite file                                                                                                                 |

Before sharing a hosted instance, verify health, login, role isolation, a small/large run, image retrieval after redeploy and an isolated native restore. Test signed webhooks/scheduled reconciliation if advertised. Keep unsupported preview hosts and databases separate.

The two final guides replace the earlier phase/setup walkthroughs. Examples, local links and configuration syntax are checked during documentation work; no live cloud/database deployment, application build, formatter, lint, type check or behavioral suite was run for this consolidation. The [historical release record](RELEASE-3.1.0-VALIDATION.md) describes its own tested release only.

## 13. Command reference

Run these commands from the application root after installing VisualGuard. `npx --no-install` uses that project's installed version. Examples assume `visualguard.config.ts` from section 2, a running dashboard at `http://127.0.0.1:4400`, and the local-owner mode from section 5 or 7. Replace the project ID, paths and URLs with your actual values.

### Run a visual test or open its report

```sh
npx --no-install visualguard test --config visualguard.config.ts --no-ai
npx --no-install visualguard report --config visualguard.config.ts
```

`test` compares the configured production/reference and staging/candidate pages and saves evidence locally. Without a project argument, it does not publish to the dashboard. `report` opens/serves the latest saved report for that configuration; add `--run RUN_ID` to select another saved run. Stop the report server with Ctrl+C.

For AI, configure a provider as in section 3, then replace `--no-ai` with `--provider gemini`, or `--provider ollama --model qwen2.5vl`. The runner loads its `.env`/`.env.local`; the dashboard's MongoDB environment file does not configure AI.

### Start a dashboard

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

`dashboard` starts the server and serves its UI until Ctrl+C. Its loaded database URL selects SQLite, PostgreSQL or MongoDB storage. Open the printed URL in your browser. Start the server before commands that connect through `--server` or `--dashboard`.

### Create a dashboard project

```sh
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
```

`dashboard project create` creates a project in the running dashboard. `storefront` is the project ID used by tests; `Storefront Web` is its display name. Repeating creation for an existing ID preserves that project's name and history. This command does not start a dashboard or capture screenshots. Login-enabled servers require current administrator authority; see section 8.

### Bind a test execution to a dashboard project

```sh
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 \
  --config visualguard.config.ts --no-ai \
  --run-name "Homepage color change"
```

`test storefront` selects the project, resolves it before capture, runs the comparison and publishes the saved evidence. An exact unique display name also works: `test "Storefront Web"`. Use the same project argument for future executions. There is no separate persistent `bind` command. Omitting the project returns to offline tests; `--dashboard` alone requires a project argument.

Use the explicit dashboard URL for the workflows in this guide. Without a dashboard URL or `VISUALGUARD_DASHBOARD_URL`, `test PROJECT` uses storage configured in the runner process, which might be a different local SQLite workspace. The HTTP workflow keeps database credentials on the dashboard server.

To save the server setting for subsequent test commands, add this to the runner's ignored `.env.local`:

```dotenv
VISUALGUARD_DASHBOARD_URL=http://127.0.0.1:4400
```

Then `npx --no-install visualguard test storefront --config visualguard.config.ts --no-ai` uses that server. Local-owner mode needs no upload token. Login mode requires `VISUALGUARD_UPLOAD_TOKEN` for this project in the runner's private environment, even for localhost. An upload token publishes to an existing permitted project; it does not create projects. See section 8 for token setup.

### Project or run missing from the dashboard

If `npx visualguard test "My Application"` runs but `npx visualguard dashboard` shows another workspace, first check which storage each process selected:

| Process                                 | Settings it reads                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test PROJECT`                          | Runner process settings and `.env`/`.env.local`; with no dashboard URL, it writes to the runner's configured database or local SQLite storage |
| `test PROJECT --dashboard URL`          | Publishes through that running dashboard, which selects the database; the runner needs no database URL                                        |
| `dashboard --env-file .env.visualguard` | Explicitly loads that file, then starts the dashboard; existing process settings take precedence                                              |
| `dashboard` without `--env-file`        | Uses process settings or defaults; it does not automatically read `.env.visualguard` or the runner's `.env.local`                             |

Relative local SQLite storage also depends on the calling directory. Use the same application root and a single running dashboard for this workflow. To select the MongoDB workspace from section 7, stop the old dashboard and run in terminal A:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

In terminal B, run against that exact server:

```sh
npx --no-install visualguard test "My Application" \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The display name must already identify exactly one project in that dashboard. If it does not exist there yet, create it first with a valid ID, then use that ID for tests:

```sh
npx --no-install visualguard dashboard project create my-app \
  --name "My Application" --server http://127.0.0.1:4400
npx --no-install visualguard test my-app \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

To recover the previous execution without recapturing, find its saved run directory in the earlier test output (by default `.visualguard/runs/RUN_ID`) and upload it after creating/selecting the project:

```sh
npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID \
  --project my-app --server http://127.0.0.1:4400
```

Replace `RUN_ID` with the actual saved directory containing `manifest.json`. Pointing a new dashboard at MongoDB does not migrate runs from an earlier SQLite workspace. Login mode requires this project's upload token for both testing and publishing; these examples assume local-owner mode.

### Import or publish an already saved run

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront
```

`dashboard import` reads a local run directory and writes directly to the storage selected by the environment file. No running dashboard is required for the import itself. Use the same file/database as your dashboard and replace `RUN_ID` with a real saved run containing `manifest.json`.

```sh
npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID \
  --project storefront --server http://127.0.0.1:4400
```

`dashboard publish` uploads saved evidence through the running server. It does not rerun browser capture. Use this to retry an upload while retaining the original run. Login mode needs a token; supply it through the process environment or `dashboard --env-file .env.visualguard-upload publish ...` with a private token file, as shown in section 8. This subcommand does not automatically load `.env.local`.

### Generate hosting files

```sh
npx --no-install visualguard dashboard init --target vercel --out deploy/visualguard-vercel
npx --no-install visualguard dashboard init --target cloud-run --out deploy/visualguard-cloud-run
```

Choose the command for your host. `dashboard init` generates a deployment project in a new/empty directory; it does not create a cloud resource, deploy the app or start a server. Follow section 9 to install/deploy that output and configure its environment. This is different from `dashboard project create`, which creates a project inside the dashboard.

### Common options

| Option or argument                             | Meaning                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--config FILE`                                | Comparison configuration: tested application URLs, routes and viewports                                                |
| `test PROJECT`                                 | Dashboard project ID or exact unique display name for this execution                                                   |
| `test --dashboard URL`                         | Dashboard receiving the run; this is not an application-under-test URL                                                 |
| `dashboard ... --server URL`                   | Running dashboard used by project creation, publishing, baseline or policy commands that support this option           |
| `dashboard --env-file FILE`                    | Load dashboard settings explicitly; put it before the subcommand                                                       |
| `dashboard --port NUMBER` / `--host ADDRESS`   | Dashboard listener; use loopback for local-owner mode                                                                  |
| `dashboard --data-dir DIRECTORY`               | Local storage directory; does not replace an external database URL                                                     |
| `--no-ai` / `--provider NAME`                  | Disable AI or select a configured AI provider for a test                                                               |
| `test --run-name NAME`                         | Human-readable dashboard run label; requires a project                                                                 |
| `test --branch NAME --commit SHA --pr NUMBER`  | Attach real source revision/PR metadata to a dashboard run                                                             |
| `test --fail-on regression` / `review` / `any` | Choose which result levels make the command exit nonzero; regressions/errors can indicate a correctly detected failure |
| `test --only GLOB` / `--viewport NAME`         | Limit captured routes or viewports; policy coverage can still require a complete run                                   |
| `--help`                                       | Display options supported by the installed command                                                                     |

### Other commands

Use `npx --no-install visualguard` before each command below. These are alternatives for specific tasks, not a sequence to execute together. The generated `visualguard.config.ts` is discovered automatically from the application root. The explicit `--config visualguard.config.ts` in these examples makes the selected file clear; keep explicit paths for a custom filename or JSON.

| Command                                                                               | Use and prerequisites                                                                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `https://example.com` or `https://production.example.com https://staging.example.com` | Run URL mode for a quick single-site scan or a two-site comparison                                                                     |
| `init`                                                                                | Run the setup wizard and generate `visualguard.config.ts`; see [npx initialization](#initialize-the-project-with-npx)                  |
| `init --yes --production URL --staging URL --ai none`                                 | Generate the TypeScript config without prompts; review discovered routes and default desktop/mobile viewports                          |
| `doctor --config visualguard.config.ts`                                               | Diagnose comparison configuration and application reachability                                                                         |
| `test --config visualguard.config.ts --list`                                          | List planned URL pairs without capturing screenshots                                                                                   |
| `auth staging --config visualguard.config.ts`                                         | Save application-under-test login state; configure the resulting storage-state path for captures                                       |
| `analyze`                                                                             | Re-analyze saved evidence with configured analysis settings                                                                            |
| `accept`                                                                              | Record an intentional local visual change; distinct from a dashboard review decision                                                   |
| `fix`                                                                                 | Propose/apply/verify an AI repair with the configured source/verification setup                                                        |
| `watch` / `monitor`                                                                   | Repeat tests on edits or over time using their respective configuration                                                                |
| `merge`                                                                               | Combine compatible run shards and validate coverage                                                                                    |
| `comment`                                                                             | Publish/update a PR summary when explicitly configured and authorized                                                                  |
| `dashboard export FILE` / `dashboard restore FILE`                                    | Export/restore portable evidence using the selected storage; these exclude account/security state and are not full operational backups |
| `dashboard baseline pull SET --project storefront --out NEW_DIRECTORY --server URL`   | Download an existing approved baseline set; requires project access and a configured reference destination                             |
| `dashboard policy assess --project storefront --revision SHA --server URL`            | Assess an exact revision against the project's configured visual policy                                                                |
| `dashboard policy reconcile --project storefront --all --server URL`                  | Refresh tracked PR assessments/GitHub delivery; requires configured policy integration and project authorization                       |
| `dashboard assets --out public`                                                       | Copy packaged dashboard assets; generated hosting builds use this                                                                      |
| `--version`                                                                           | Print the installed CLI version                                                                                                        |

Check the exact required arguments before using an advanced command:

```sh
npx --no-install visualguard --help
npx --no-install visualguard test --help
npx --no-install visualguard dashboard --help
npx --no-install visualguard dashboard project create --help
npx --no-install visualguard dashboard baseline pull --help
```
