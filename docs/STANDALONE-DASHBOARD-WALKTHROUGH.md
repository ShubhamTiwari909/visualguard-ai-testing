# Standalone VisualGuard dashboard: local use, team setup, and hosting

**Prepared:** 15 October 2026.  
**Release scope:** F01 dashboard/history, F02 access, F06 remote publishing, database portability, installed-package commands, and deployment scaffolds.  
**Release status:** implementation and local release-candidate validation are complete. The npm release and live Cloud Run/Vercel deployments have not been performed. Formatting, lint, and type checks remain deferred until after F36 under the user's instruction.

## 1. Choose your setup

| Goal | What to use | Configuration |
| --- | --- | --- |
| Try the dashboard on your computer | Local SQLite workspace | None beyond a supported Node version |
| Open someone else's local evidence | Portable backup or SQLite file | One restore command or `--file` |
| Use an existing PostgreSQL database | PostgreSQL URL | `VISUALGUARD_DATABASE_URL` |
| Use an existing MongoDB database | MongoDB URL including database name | The same variable; backend detected automatically |
| Share with your organization | Cloud Run, Vercel, or another Node host | Database URL, public URL, admin email, admin password |
| Publish from another app or CI | Installed `visualguard` package | Dashboard URL, project ID, project upload token |

The dashboard and test execution are separate. Your application and Playwright browsers run on your machine or CI. The dashboard stores and displays saved evidence; hosting it does not require your application source, browser binaries, or an AI key.

A hosted URL is reachable from the internet, while project data requires login and permission. This release does not enable anonymous access to private screenshots.

## 2. Prerequisites and package availability

Use **Node.js 22.12 or newer**. Check the Node version in the project where you install/run the package, not only inside the VisualGuard repository:

```sh
node --version
```

For example, with nvm:

```sh
nvm install 22
nvm use 22
```

Keep the package's optional dependencies installed when using PostgreSQL, MongoDB, or OIDC. A normal npm installation includes them. `--omit=optional` excludes those drivers.

### Before the dashboard-enabled npm release is published

The repository contains a minor-release Changeset. It does not mean the dashboard is already available from `npm install visualguard` on the public registry.

From a development checkout, create a local package candidate:

```sh
pnpm install
pnpm --filter visualguard build:dashboard
pnpm --dir packages/visualguard pack --pack-destination ../../.visualguard/release
```

`build:dashboard` bundles JavaScript and both report/dashboard UI assets, and copies the dashboard declaration file. It does not run formatting, lint, or semantic type checks. Normal release builds remain responsible for the full declaration/validation pipeline. Keep this distinction when preparing a public release.

Install the resulting tarball in another project:

```sh
cd /path/to/another-project
npm install -D /absolute/path/to/visualguard-VERSION.tgz
npx visualguard dashboard
```

Replace `VERSION` with the actual package filename. The current checkout's package version is 2.0.0; the local tarball is a release candidate and does not overwrite an existing npm release.

### After the dashboard-enabled npm release is published

```sh
cd /path/to/another-project
npm install -D visualguard
npx visualguard dashboard
```

Pin the released version in your lockfile. No dashboard source files need to be copied from this repository. Production deployment projects install the package as a runtime dependency instead of a dev dependency.

## 3. Run locally with zero database setup

```sh
npx visualguard dashboard
```

Open [the local dashboard](http://127.0.0.1:4400). Local mode binds to loopback and treats the person using this computer as the workspace owner. It does not require a password.

The default data location is your calling project's `.visualguard/platform/metadata.sqlite`. New metadata, screenshots, DOM JSON, and platform state are stored in that database. The directory is independent of the npm package installation; updating the package does not remove your workspace.

To choose a location or port:

```sh
npx visualguard dashboard --data-dir /absolute/path/to/dashboard-data --port 4500
```

The standalone CLI uses port 4400 by default, or `PORT`/`VISUALGUARD_PLATFORM_PORT` when configured. Stop it with Ctrl+C.

### Working from this repository

```sh
pnpm platform:dev
```

This runs the source app with UI development transforms. For a compiled UI:

```sh
pnpm platform:build
pnpm platform:start
```

The installed-package `npx visualguard dashboard` command uses prebuilt assets and needs neither Vite nor the repository.

## 4. Import a run and inspect it

Create a project in the dashboard or let the local importer create it:

```sh
npx visualguard dashboard import /absolute/path/to/.visualguard/runs/RUN_ID \
  --project storefront \
  --name Storefront \
  --environment staging \
  --branch feature/header \
  --pr 42
```

Point to the **run directory containing `manifest.json`**, not to the manifest file. Optional `--commit` and `--deployment` flags attach those labels; absent commit metadata falls back to the manifest's source revision.

Click Refresh, then open the run. Check the route/checkpoint, viewport, screenshots, DOM links, findings, provenance, and comparison viewer. Filter by project, status, environment, branch, revision, PR, deployment, or dates. Through-date filters include the entire selected UTC day.

Identical evidence and metadata are deduplicated. Reusing the same project/engine-run ID with different evidence or metadata fails instead of replacing history. Imported artifacts are independent of the original engine output directory.

For bulk import from the source repository:

```sh
pnpm platform:import --project storefront --runs-dir /absolute/path/to/.visualguard/runs
```

Additional labels on a bulk command apply to every run. Do not attach one PR/revision label to mixed historical runs unless that is intentional.

## 5. Select PostgreSQL or MongoDB

Use one variable. The URL scheme selects the backend.

### PostgreSQL

```sh
VISUALGUARD_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/visualguard' \
  npx visualguard dashboard
```

### MongoDB

```sh
VISUALGUARD_DATABASE_URL='mongodb://127.0.0.1:27017/visualguard' \
  npx visualguard dashboard
```

For a managed MongoDB service, use its supplied `mongodb+srv://.../visualguard` connection string. Include a database name. For PostgreSQL, use the provider's connection/TLS settings; a pooled connection URL is useful for serverless hosts. URL-encode reserved characters in credentials or copy the provider's generated URI.

`DATABASE_URL` is accepted as a compatibility fallback. Prefer the dedicated `VISUALGUARD_DATABASE_URL` so the dashboard cannot accidentally use an application's unrelated database setting. Use a dedicated dashboard database.

Metadata and artifacts use the same database. PostgreSQL initializes its `vg_*` tables/indexes. MongoDB initializes `vg_*` collections/indexes; standalone MongoDB is supported, without requiring replica-set transactions for publication. Browser processes remain outside the dashboard host.

### Store local settings in one file

Create an ignored `.env.visualguard`:

```dotenv
VISUALGUARD_DATABASE_URL=postgresql://USER:PASSWORD@HOST/visualguard
```

Then:

```sh
npx visualguard dashboard --env-file .env.visualguard
npx visualguard dashboard --env-file .env.visualguard import /absolute/run --project storefront
```

Environment files load only when explicitly requested; process environment values take precedence. Put parent dashboard options such as `--env-file`, `--data-dir`, and `--file` **before** a subcommand. Subcommand flags such as `--project` follow that subcommand.

## 6. Minimal team access setup

Hosted setup needs four values:

```dotenv
VISUALGUARD_DATABASE_URL=YOUR_POSTGRESQL_OR_MONGODB_URL
VISUALGUARD_PUBLIC_URL=https://your-dashboard.example.com
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD=YOUR_UNIQUE_PASSWORD_OF_AT_LEAST_12_CHARACTERS
```

The public URL must be the canonical HTTPS **origin**, without a path or query. It enables login mode automatically. The server rejects mismatched hosts/origins. Cloud Run/Vercel require external database storage; local mode is not allowed on a public listener.

Use host secret settings for credentials. The initial administrator is created once. Changing the bootstrap password variable later does not silently overwrite an existing password.

After signing in:

1. Create the desired projects.
2. Open **People & integrations**.
3. Create member accounts with unique initial passwords and share them privately. The dashboard does not send emails.
4. Assign each member to projects as Viewer, Reviewer, or Maintainer.
5. Members can change their password in the account settings. Company-login passwords remain managed by the identity provider.
6. Disable an account to revoke its active sessions and owner-bound upload access.

Workspace administrators manage all projects and accounts. Viewers see assigned projects only. Reviewers currently have read access; collaborative approval remains F03. Maintainers manage their project's membership/upload tokens. The settings page offers project controls only for projects the user can maintain.

Sessions last up to 12 hours, are persisted server-side, and use HttpOnly cookies. Hosted HTTPS cookies are Secure. Password changes invalidate previous sessions. Mutations require a session action token, and upload tokens cannot browse or administer the dashboard. Account and permission changes create audit events; administrators can inspect `GET /api/audit` from an authenticated session.

### Optional company login

Add these only when you want OIDC single sign-on:

```dotenv
VISUALGUARD_OIDC_ISSUER=https://YOUR_IDENTITY_PROVIDER_ISSUER
VISUALGUARD_OIDC_CLIENT_ID=YOUR_CLIENT_ID
VISUALGUARD_OIDC_CLIENT_SECRET=YOUR_CLIENT_SECRET
```

Register `https://your-dashboard.example.com/api/auth/callback` as the redirect URI. The client uses authorization-code flow with PKCE, state, nonce, and ID-token validation through `openid-client`.

The configured admin email grants initial OIDC admin access only when the provider marks that email as verified. Providers omitting that claim can use `VISUALGUARD_OIDC_ADMIN_SUBJECTS`, a comma-separated allowlist of exact subject IDs for the configured issuer. Other first-time SSO users receive no project access until assigned. A disabled account remains disabled after SSO login.

The generic adapter is implemented; your actual identity-provider app registration and end-to-end login need a deployment smoke check. Password-based team access was exercised locally.

## 7. Publish from another application or CI

In the dashboard, select the project under **People & integrations**, create an upload token, and store it as `VISUALGUARD_UPLOAD_TOKEN` in the application's CI secret store. Tokens are project-scoped, shown once, and expire in 1–90 days.

From the application project:

```sh
npx visualguard test --no-ai
```

Then publish the saved run even if the test reported a regression:

```sh
npx visualguard dashboard publish /absolute/path/to/.visualguard/runs/RUN_ID \
  --server https://your-dashboard.example.com \
  --project storefront \
  --environment staging \
  --branch feature/header \
  --pr 42
```

The command reads its token from the environment. Do not pass it as a command-line argument. The output includes the shared run URL. The receiving project must already exist; upload credentials cannot create projects.

Uploads use 1 MiB chunks, checksums, bounded retries, and persistent progress. Repeating the same command resumes the same credential-bound session for up to 24 hours. Changed screenshot bytes change upload identity even when the manifest paths stay the same. A run appears only after its required evidence validates; incomplete coverage stays visibly incomplete.

For a no-login local server, `--server http://127.0.0.1:4400` obtains a local action token automatically. A local server running in login mode still needs an upload token. Remote uploads require HTTPS.

### GitHub Actions example

Keep the application's existing VisualGuard configuration and test setup. Add publishing after its test step:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- name: Run visual tests
  run: npx visualguard test --no-ai
- name: Publish saved evidence
  if: always()
  env:
    VISUALGUARD_UPLOAD_TOKEN: ${{ secrets.VISUALGUARD_UPLOAD_TOKEN }}
    DASHBOARD_URL: https://your-dashboard.example.com
    DASHBOARD_PROJECT: storefront
  run: |
    node --input-type=module <<'JS'
    import { findRun } from 'visualguard';
    import { publishDashboardRun } from 'visualguard/dashboard';
    const { dir } = findRun('.visualguard');
    const result = await publishDashboardRun({
      server: process.env.DASHBOARD_URL,
      project: process.env.DASHBOARD_PROJECT,
      runDir: dir,
      token: process.env.VISUALGUARD_UPLOAD_TOKEN,
      metadata: {
        environment: 'staging',
        branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
        commit: process.env.GITHUB_SHA,
      },
    });
    console.log(result.url);
    JS
```

If no valid run was saved, publishing fails visibly instead of inventing success. Use the actual configured output directory when it differs from `.visualguard`. A published passing run is not a release approval or baseline promotion; those are later features.

## 8. Export evidence and open it locally

### Preferred: portable evidence backup

On a machine with access to the source dashboard database:

```sh
npx visualguard dashboard --env-file .env.visualguard export team-evidence.vgbackup.gz
```

This exports projects, original run evidence, stable platform IDs, digests, and required screenshot/DOM objects. It excludes users, passwords, sessions, memberships, and upload credentials. Screenshots/DOM themselves can still contain application information; share the evidence according to your team's policy.

On another computer, with database URL variables unset:

```sh
npx visualguard dashboard --data-dir ./review-workspace restore team-evidence.vgbackup.gz
npx visualguard dashboard --data-dir ./review-workspace
```

The second computer needs only Node and the installed package. It does not need the original application's source or database. A portable backup can move evidence between MongoDB, PostgreSQL, and SQLite.

Restore is an append-only merge: identical runs are reused, conflicts fail, original evidence is not overwritten, and preserved IDs keep links stable in a fresh destination. A failed/truncated backup produces a nonzero result. Earlier valid records may already have been imported before a later error, so use a fresh destination for recovery and rerun a complete verified backup. Existing conflicting destination IDs are not silently replaced.

Export chooses a new filename and refuses to overwrite an existing backup. Pause imports for a reproducible point-in-time portable export; it scans project history rather than holding a long database-wide snapshot transaction. Use database-native backup tools for transactional disaster-recovery snapshots of a busy service.

### Open a SQLite database file directly

```sh
npx visualguard dashboard --file /absolute/path/to/metadata.sqlite --port 4500
```

The file must exist and be a real VisualGuard SQLite database. Unset external database URL variables first. Work with a copy when inspecting someone else's backup. Stop the original server before copying a SQLite file so WAL contents are checkpointed, or use a proper SQLite backup operation.

New database-backed objects are inside the file. Older F01 workspaces may also need an adjacent `objects/` directory. `--file` checks that directory beside the database as its legacy fallback; `--data-dir` can override it. Exporting an old workspace into the portable format gathers the referenced legacy objects automatically.

## 9. Restore native database dumps locally

Native dumps contain storage-specific data and may include accounts/auth state. They are different from the evidence-only portable backup.

### PostgreSQL custom-format dump

```sh
createdb visualguard_local
pg_restore --dbname=postgresql://localhost/visualguard_local /path/to/dashboard.dump
VISUALGUARD_DATABASE_URL=postgresql://localhost/visualguard_local npx visualguard dashboard
```

For a plain SQL dump:

```sh
psql postgresql://localhost/visualguard_local < /path/to/dashboard.sql
```

Use an empty destination and appropriate local credentials. New database-backed artifacts restore with the tables. Old F01 dumps may still require the matching filesystem `objects/` directory or a portable export from the old deployment.

### MongoDB dump

Restore the `mongodump` output with the MongoDB database tools, using the correct source/destination namespaces. For example, if the dump is under `dump/visualguard/`:

```sh
mongorestore --uri='mongodb://127.0.0.1:27017' \
  --nsInclude='visualguard.*' \
  --nsFrom='visualguard.*' \
  --nsTo='visualguard_local.*' \
  /path/to/dump

VISUALGUARD_DATABASE_URL='mongodb://127.0.0.1:27017/visualguard_local' \
  npx visualguard dashboard
```

For an archive, use `mongorestore --archive=...` and `--gzip` if the archive was compressed, with the appropriate namespace mapping. Keep the database name in the connection string used by the dashboard.

When opening a restored dump locally without a public URL, loopback owner mode is the default. To test the restored login behavior instead, configure `VISUALGUARD_AUTH_MODE=login` and a loopback `VISUALGUARD_PUBLIC_URL` matching the chosen port.

## 10. Deploy on Vercel

Run this in a separate deployment project or another application checkout:

```sh
npx visualguard dashboard init --target vercel --out visualguard-dashboard
cd visualguard-dashboard
npm install
```

Before the npm release, supply the candidate explicitly:

```sh
npx visualguard dashboard init --target vercel \
  --out visualguard-dashboard \
  --package /absolute/path/to/visualguard-VERSION.tgz
```

The tarball is copied into the generated project and referenced through `file:./visualguard.tgz`, so the deployment does not accidentally install an older registry release.

The generator creates a small `package.json`, `.env.example`, `api/dashboard.mjs`, and `vercel.json`. It refuses to overwrite a nonempty directory. The Vercel build copies the package's prebuilt UI into `public/`; the Node function serves the API. Rewrites route browser pages to the UI and preserve nested API paths/queries for the shared handler.

In Vercel:

1. Create/import the generated directory as a project. Select **Other** framework and Node 22.x.
2. Keep the generated build command/output directory (`npm run build`, `public`).
3. Add the four hosted settings from section 6 to the project's production environment. Use a stable production/custom domain for the public URL.
4. Make the database reachable from the function region and use its approved TLS/network configuration.
5. Deploy, then check `/api/health`, sign in, create a project, and publish a run from another machine.

Preview deployments must use their own canonical URL and isolated database rather than sharing production bootstrap/session data accidentally. The simplest first rollout is one production deployment. Connection pools are reused within a warm function; each instance uses up to five database connections, so size database limits and host concurrency together.

The application does not persist files to Vercel's ephemeral filesystem. Manifests and large artifacts are transferred in small responses and reconstructed with checksum validation in the browser. Requests also use small chunks because Vercel documents a 4.5 MB function request/response payload limit. [Vercel function limits](https://vercel.com/docs/functions/limitations).

The generated adapter follows Vercel's Node function/project configuration model. It was installed/built locally and exercised through the shared handler; a live Vercel account deployment was not performed. [Node runtime](https://vercel.com/docs/functions/runtimes/node-js), [project configuration](https://vercel.com/docs/project-configuration/vercel-json).

## 11. Deploy on Cloud Run

Generate a dedicated project:

```sh
npx visualguard dashboard init --target cloud-run --out visualguard-dashboard
cd visualguard-dashboard
```

Use `--package /absolute/path/to/visualguard-VERSION.tgz` before the dashboard-enabled npm release, as with Vercel.

The generated Dockerfile installs the package, runs as the Node user, and starts `visualguard dashboard --host 0.0.0.0`. It needs no browser install or UI compilation. Cloud Run supplies `PORT`; durable state goes to the external database. The generated `.dockerignore` excludes environment files and local workspace data.

Using the Cloud Console or gcloud:

1. Choose the Google Cloud project and region, and enable the services required for Cloud Run/source builds.
2. Create a PostgreSQL or MongoDB database reachable from Cloud Run. For private databases, configure the appropriate VPC/connector routing. Follow the database provider's TLS and connection guidance.
3. Store the database URL and bootstrap admin password in Secret Manager. Grant the runtime service account access only to those required secrets.
4. Deploy this generated folder from source, or build/push its Dockerfile through your normal image pipeline.
5. Set the public URL and admin email as environment settings, and inject the database URL/password from secrets.
6. Allow requests to reach the service at the Cloud Run layer when relying on the dashboard's own login; its API still requires application authentication/project permissions.

Illustrative source-deploy command, after replacing project/region/secret names:

```sh
gcloud run deploy visualguard-dashboard \
  --source . \
  --region YOUR_REGION \
  --allow-unauthenticated \
  --set-env-vars VISUALGUARD_PUBLIC_URL=https://YOUR_DASHBOARD_HOST,VISUALGUARD_ADMIN_EMAIL=owner@example.com \
  --set-secrets VISUALGUARD_DATABASE_URL=visualguard-database-url:latest,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:latest
```

If you already know the custom domain, configure it as the public URL. If this is the first deployment and the generated `run.app` URL is not known yet, use a temporary valid origin such as `https://dashboard.invalid`. The health endpoint allows the service to start, but normal requests fail host validation until you replace that origin with the actual service URL printed by Cloud Run:

```sh
gcloud run services update visualguard-dashboard \
  --region YOUR_REGION \
  --update-env-vars VISUALGUARD_PUBLIC_URL=https://ACTUAL_SERVICE_URL
```

Do this before asking users to sign in or configuring OIDC callbacks. Set maximum instances/concurrency according to database connection capacity; local filesystem state must not be used for persistence.

Cloud Run requires listening on the supplied port/all interfaces and treats container-local storage as ephemeral. The runtime and generated container entry implement that contract. The Dockerfile/adapter were reviewed and the production Node entry was exercised locally; a container build or live Cloud Run deployment was not performed because no running Docker daemon/cloud project credentials were available. [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract).

## 12. Configuration reference

| Setting | Default / use |
| --- | --- |
| `VISUALGUARD_DATABASE_URL` | Preferred PostgreSQL/MongoDB URL; absent means local SQLite |
| `DATABASE_URL` | Compatibility fallback |
| `VISUALGUARD_PUBLIC_URL` | Canonical public origin; enables authenticated mode |
| `VISUALGUARD_ADMIN_EMAIL` | One-time administrator email/bootstrap OIDC match |
| `VISUALGUARD_ADMIN_PASSWORD` | One-time password-account bootstrap; 12–256 characters |
| `VISUALGUARD_AUTH_MODE` | `local` or `login`; normally inferred |
| `VISUALGUARD_PLATFORM_DATA_DIR` | Calling project's `.visualguard/platform`, or `--data-dir` |
| `VISUALGUARD_SQLITE_FILE` | Explicit SQLite database file, or `--file` |
| `VISUALGUARD_PLATFORM_PORT` / `PORT` | HTTP listener port; default 4400 |
| `VISUALGUARD_HOST` | Loopback locally; hosted entry listens on all interfaces |
| `VISUALGUARD_UPLOAD_TOKEN` | Publishing credential; never a browser login |
| `VISUALGUARD_OIDC_*` | Optional issuer/client credentials and admin subject allowlist |

No separate session-signing secret is required: sessions are opaque random tokens with hashed server-side records. Authentication, revocation, and upload progress are persisted in the selected database. The generated examples do not contain real credentials.

## 13. Manual acceptance checklist

| Check | Expected result |
| --- | --- |
| Start with no settings | Local dashboard and SQLite file work |
| Open a copied SQLite file / restore portable backup | Projects, runs, images, and stable IDs are available |
| Switch database URL between PostgreSQL and MongoDB | Both backends support the same workflow |
| Sign in as admin; create a member/project | Accounts/project persist after restart |
| Give member access to one project | Other project metadata, run details, and image bytes are denied |
| Change password or disable an account | Previous sessions lose access |
| Create a project upload token | Token appears once; expiry/revocation controls work |
| Publish a run from a separate app | Shared run URL appears with correct revision metadata |
| Interrupt/repeat publishing | Progress resumes; no partial run appears as passing |
| Publish changed bytes under an existing engine ID | Conflict; original evidence stays unchanged |
| Revoke token and retry | New upload/resume requests are rejected |
| Inspect large screenshots | Viewer works through chunked responses |
| Visit deployed `/api/health` and sign in | Ready service and correct canonical host |
| Restart/scale hosted instance | Database evidence remains; no filesystem dependency |

## 14. Operational limits and recovery

Current limits are 4096 referenced artifacts/run, 32 MiB per artifact, 16 MiB raw manifest, and 512 MiB total referenced artifact data. MongoDB additionally caps the stored run envelope at 12 MiB. Portable restore accepts up to 2 GiB compressed/4 GiB decompressed input. Use scoped complete runs for large suites.

New screenshots are stored in 1 MiB database chunks using base64 representation. Budget for database storage and backup growth; base64 adds overhead. The initial choice keeps setup to one database, rather than requiring a separate object-storage account.

Expired upload/session state is logically rejected immediately. SQL expired-state batches are pruned when new uploads start; MongoDB also has a TTL index. Completed file uploads remove temporary chunk state. Abandoned final objects and historical runs do not yet have automatic reference-aware retention/garbage collection. Monitor capacity and take regular backups; do not blindly delete object rows by age while runs still reference them.

Use native database backups for operational recovery, plus an evidence-only portable export when a team needs a local copy. Verify a restore before relying on a backup. For a hosted restore, configure access and project memberships deliberately; the portable format excludes them.

Troubleshooting:

| Symptom | Action |
| --- | --- |
| Unsupported Node / SQLite import failure | Switch the actual consuming project/runtime to Node 22.12+ |
| Unknown `dashboard` command | Install the dashboard-enabled release or local candidate tarball |
| Port already in use | Use the running dashboard or choose `--port` |
| Host/origin rejected | Match `VISUALGUARD_PUBLIC_URL` to the actual browser/deployment origin |
| Hosted app refuses SQLite | Set an external MongoDB/PostgreSQL URL |
| Login bootstrap fails | Set a valid email and unique 12+ character password, or an OIDC admin |
| Changed bootstrap password does not change login | Rotate the existing account password; bootstrap is create-once |
| New SSO member sees no projects | Administrator assigns project membership |
| Database connection timeout | Check host reachability, network allowlists, credentials, TLS, and connection limits |
| Missing driver after minimal npm install | Install the package's optional dependencies |
| Missing evidence from an old F01 dump | Restore its `objects/` directory or export portable evidence from the original workspace |
| Upload fails or is interrupted | Correct credentials/data, then repeat the same command within 24 hours |
| Backup restore reports conflict/truncation | Keep original destination evidence; retry a complete backup into a fresh workspace |

## 15. Validation record and release boundary

Recorded during this implementation:

- 54 focused tests passed, including live local PostgreSQL and MongoDB adapters, SQLite persistence, permissions, session/password/token revocation, racing writes, chunk integrity, resumable publication, backup/restore, and host scaffolds.
- JavaScript/UI distribution build passed without running declaration/type checking.
- A packed package installed into a fresh project, exposed the core API and dashboard API, served the UI, imported/published a run, exported/restored evidence, and generated both deployment projects.
- MongoDB evidence was exported, restored into PostgreSQL, re-exported, and restored into SQLite.
- Browser checks exercised shared password login, project/account creation, project membership assignment, viewer history/run access, and settings with no browser console errors, alongside the earlier F01 history/comparison/mobile checks.
- The generated Vercel project installed its package and copied its prebuilt UI locally.

Not performed: npm publication, live cloud account deployment, Docker image build, actual organization IdP login, full-workspace validation, formatting, lint, or type checking. These are not reported as passed. The final release/cloud rollout must use the target account's configuration and the user's agreed validation schedule.

This standalone release does not implement collaborative approval (F03), baseline promotion (F04), managed runners, or release gates. Those features remain separate commits and releases. The delivered boundary is a centrally accessible, authenticated evidence dashboard with portable storage and remote publishing.
