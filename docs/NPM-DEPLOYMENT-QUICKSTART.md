# From an npm install to a hosted VisualGuard dashboard

For a user who already has VisualGuard in their application repository. Use your application locally, then choose **Vercel** or **Google Cloud Run** for its shared dashboard. You do not need to clone VisualGuard, build its source, make a tarball or publish a container yourself.

## 1. Check the installed package

From your existing application directory:

```sh
cd /path/to/your-app
node --version
npx --no-install visualguard --version
npx --no-install visualguard dashboard init --help
```

Use Node.js **22.12 or newer**. If VisualGuard is not installed yet:

```sh
npm install --save-dev --save-exact visualguard
```

If `dashboard init` is missing, update an older installation with the same install command. The examples below use the local installed package. The generated hosting folder pins that CLI's version and downloads it from npm during deployment; it does not include your application source or require `--package`.

As checked on 17 October 2026, npm's current version is `3.1.0`. Its source revision includes the commands used here, but newer source features such as Google account linking, invitations and approved baselines need a matching newer published release. Deploying an npm version does not automatically include unreleased repository changes.

## 2. Run a visual comparison locally

Install browser support if your application does not already have Playwright:

```sh
npm install --save-dev playwright
npx playwright install chromium
```

Start your application's development server using its normal command, for example `npm run dev`. In another terminal at the application root, create `visualguard.config.json`:

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

Replace the production URL and development port with your actual application URLs. These are the pages being compared, not the dashboard address. If you already have a VisualGuard config, keep it and use its path with `--config` instead of creating a second config.

Run:

```sh
npx --no-install visualguard test --config visualguard.config.json --no-ai
```

Open the report location printed by the command. A reported regression can give a nonzero exit code; that does not necessarily mean setup failed.

### Optional: view the run in a local dashboard

At the application root, start this in another terminal:

```sh
npx --no-install visualguard dashboard
```

Open `http://127.0.0.1:4400`. This local mode uses SQLite and needs no database service, login or upload token. For that behavior, use a terminal without exported dashboard/database settings; `DATABASE_URL` also selects an external database. Do not use a real application's database for the dashboard.

In your original terminal, replace `RUN_ID` with the run directory printed by the test:

```sh
npx --no-install visualguard dashboard import .visualguard/runs/RUN_ID \
  --project my-app --name "My App"
```

Refresh the dashboard. `.visualguard/runs/` is the default; use your configured output directory if different. Keep `.visualguard/` and private environment files ignored by Git.

## 3. Get the four cloud settings ready

Create a **dedicated managed PostgreSQL database**. For the shortest path on either host, use a managed provider's reachable PostgreSQL connection URI with its recommended TLS settings; Vercel can provision providers such as Neon through its [Marketplace](https://vercel.com/docs/marketplace-storage).

| Setting | What you enter |
| --- | --- |
| `VISUALGUARD_DATABASE_URL` | Provider-generated PostgreSQL URI; use a suitable pooled endpoint for serverless hosting |
| `VISUALGUARD_PUBLIC_URL` | Your dashboard's stable HTTPS origin |
| `VISUALGUARD_ADMIN_EMAIL` | Your administrator email |
| `VISUALGUARD_ADMIN_PASSWORD` | Unique initial password, 12–256 characters |

Set `VISUALGUARD_AUTH_MODE=login` as well. Copy a real URI; do not leave `USER`, `PASSWORD` or `HOST` placeholders. Keep database/admin credentials on the dashboard host, separate from your application's environment.

**Choose A or B below.** Both start from the application root and generate a separate deployment folder. The output folder must be new or empty.

## A. Deploy to Vercel

### A1. Generate the dashboard folder

```sh
npx --no-install visualguard dashboard init \
  --target vercel --out deploy/visualguard-vercel
cd deploy/visualguard-vercel
npm install
```

This folder is the dashboard deployment project. Your application stays in its existing hosting project.

### A2. Check routes once

Open the generated `vercel.json`. If `/reviews` is missing from `rewrites`, add:

```json
{ "source": "/reviews", "destination": "/index.html" }
```

The `3.1.0` source's generated scaffold omits this route although its dashboard supports it. Keep the existing `/api/:path*`, `/runs/:path*`, `/settings` and `/` rewrites. Newer releases may include more pages; the [detailed guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md#4-deploy-on-vercel) explains the `/policies` correction for newer feature builds.

### A3. Create/link a separate Vercel project

```sh
npm install --global vercel
vercel login
vercel link
```

Choose your account and **create a new project**, for example `my-app-visualguard`, rooted in this generated folder. Do not link it to the existing application project. In that project's settings use **Other** framework, Node **22.x**, build command `npm run build` and output directory `public`.

Add the five environment settings through Vercel's project settings, scoped to **Production**. You can also enter each value privately at the CLI prompt:

```sh
vercel env add VISUALGUARD_DATABASE_URL production
vercel env add VISUALGUARD_PUBLIC_URL production
vercel env add VISUALGUARD_ADMIN_EMAIL production
vercel env add VISUALGUARD_ADMIN_PASSWORD production
vercel env add VISUALGUARD_AUTH_MODE production
```

Use the actual stable project hostname for the public URL, for example `https://my-app-visualguard.vercel.app`, and enter `login` for auth mode. If the hostname is assigned only after deploying, correct that setting and redeploy before testing login. A local `.env` file does not automatically configure Production. [Vercel environment settings](https://vercel.com/docs/environment-variables).

### A4. Deploy and open

```sh
vercel --prod
```

Open the project's **stable production URL**, sign in and continue to section 4. Do not use a changing deployment/preview URL as your dashboard origin. Keep preview deployments isolated from production data. [Vercel deployment CLI](https://vercel.com/docs/cli/deploy).

## B. Deploy to Google Cloud Run

This short route uses the managed PostgreSQL URI from section 3. For **Cloud SQL specifically**, use the [Cloud SQL, socket and Secret Manager recipe](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md#5-deploy-on-google-cloud-run) instead; adding a database URI alone does not configure a Cloud SQL attachment/private network.

### B1. Generate the dashboard folder

From your application root:

```sh
npx --no-install visualguard dashboard init \
  --target cloud-run --out deploy/visualguard-cloud-run
cd deploy/visualguard-cloud-run
npm install
```

The generated Dockerfile is sufficient for a Cloud Run source deployment. You do not need Docker locally. Google builds this folder, not your application repository. [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code).

### B2. Select your Google Cloud project

Install/authenticate the Google Cloud CLI and use a project with billing enabled. Replace the project and region values:

```sh
gcloud auth login
export VG_PROJECT_ID="your-google-cloud-project"
export VG_REGION="us-central1"
gcloud config set project "$VG_PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

For a first deployment, the project administrator must configure the source deployment/build permissions described in the [official prerequisites](https://docs.cloud.google.com/run/docs/deploying-source-code#before_you_begin). Your selected PostgreSQL provider must permit connections from this service; retain the provider's TLS settings.

### B3. Create private deployment settings

In the generated folder, create `.env.cloud-run.yaml` and replace the credential placeholders:

```yaml
VISUALGUARD_AUTH_MODE: "login"
VISUALGUARD_PUBLIC_URL: "https://setup.invalid"
VISUALGUARD_DATABASE_URL: "postgresql://REAL_USER:REAL_PASSWORD@REAL_HOST/REAL_DATABASE?sslmode=require"
VISUALGUARD_ADMIN_EMAIL: "owner@example.com"
VISUALGUARD_ADMIN_PASSWORD: "YOUR_UNIQUE_INITIAL_PASSWORD"
```

Use the provider's exact URI/TLS options instead of copying this illustrative connection string. The temporary public URL is corrected in B5 after Cloud Run assigns its URL; login is intentionally unavailable until then.

```sh
chmod 600 .env.cloud-run.yaml
```

The generated `.gitignore`/`.dockerignore` exclude `.env.*`. Also create `.gcloudignore` with:

```text
.gcloudignore
.git
node_modules
.env
.env.*
.visualguard
```

This keeps credentials out of the uploaded build context. Keep the file private; `--env-vars-file` passes its values as service environment settings, not as Secret Manager references. The [longer guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md#5-deploy-on-google-cloud-run) shows Secret Manager setup for ongoing operations.

### B4. Deploy a new private service

```sh
gcloud run deploy visualguard-dashboard \
  --source . \
  --region "$VG_REGION" \
  --env-vars-file .env.cloud-run.yaml \
  --port 8080 \
  --max-instances 3 \
  --no-allow-unauthenticated
```

This builds and creates a **new** private service while you obtain its canonical URL. Resolve deployment errors before continuing; a successful image build alone is not a running dashboard.

### B5. Apply the assigned URL and allow access

```sh
export VG_DASHBOARD_URL="$(gcloud run services describe visualguard-dashboard \
  --region "$VG_REGION" --format='value(status.url)')"

gcloud run services update visualguard-dashboard \
  --region "$VG_REGION" \
  --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_DASHBOARD_URL}"

gcloud run services add-iam-policy-binding visualguard-dashboard \
  --region "$VG_REGION" --member="allUsers" --role="roles/run.invoker"

curl --fail "$VG_DASHBOARD_URL/api/health"
```

Update the public URL inside your private YAML file too, so the next deployment does not restore `setup.invalid`. Open the assigned HTTPS URL and sign in. Public Cloud Run invocation allows access to the product's login/API; it does not grant access to private project data. If organization policy disallows public invocation, use an administrator-designed ingress/authentication setup instead of this quick-start route.

## 4. Connect your application to the hosted dashboard

1. Sign in to the cloud dashboard. In **People & integrations**, create/select project `my-app` and create a project upload token. This cloud project is separate from your optional local project.
2. Return to your **application root**, not `deploy/visualguard-*`. Put these values in an ignored `.env.local`, or add them to that file if it already exists:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://YOUR_STABLE_DASHBOARD_HOST
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

3. With your application environments running, execute:

```sh
npx --no-install visualguard test my-app --config visualguard.config.json --no-ai
```

The project-bound test captures and publishes new evidence automatically. It reads `.env`/`.env.local`; existing process variables take precedence. Open the saved run in the hosted dashboard.

The upload token belongs to this cloud project; it is not your admin password. The application/CI needs only the dashboard URL and upload token, not the dashboard database URI or admin credentials.

## 5. Where the screenshots live

The local runner retains its configured `.visualguard/runs/` output. After successful publishing, the cloud copy is stored in **your PostgreSQL database**, alongside run/review/platform data. Vercel and Cloud Run's local filesystems are not its persistent image store. No Vercel Blob/S3/Google Cloud Storage bucket is required by the current implementation.

Your new cloud instance starts with an empty database; deploying does not migrate a local SQLite workspace automatically. Existing runs can be explicitly published using `dashboard publish`, as described in the [dashboard walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md#7-publish-from-another-application-or-ci).

Before relying on the installation, verify `/api/health`, a real login, an uploaded screenshot, and the same run after a redeploy. Enable database backups and test a restore. When adding a custom domain, update `VISUALGUARD_PUBLIC_URL`, redeploy, and update the application's dashboard URL. For provider limits, larger uploads, upgrades and optional integrations, see the [detailed cloud guide](CLOUD-HOSTING-VERCEL-CLOUD-RUN.md).

**Validation:** commands were checked against the source revision recorded in npm `3.1.0` metadata and the current implementation; examples and links are checked locally. No package source build, formatting, lint, type checking or live cloud deployment was run for this documentation change.
