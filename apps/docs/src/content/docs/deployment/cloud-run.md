---
title: "Deploy the dashboard to Cloud Run"
description: "Generate a container project, deploy it to Google Cloud Run with an external database, set the public URL and verify it."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/scaffold.ts", "apps/platform/server/runtime.ts", "apps/platform/server/built-in-runner.ts", "apps/platform/server/auth.ts"]
sidebar: {"order": 5}
---

This tutorial deploys the VisualGuard dashboard to Google Cloud Run as one container. You will generate a deployment folder, write its settings, deploy from source, set the public URL and check that it works. Cloud Run keeps the container running, so with the right flags the dashboard can also run **Run test** itself.

## Before you start

- Run [a local dashboard](/dashboard/local/) once.
- Have a Google Cloud project with billing, and the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed.
- Have a PostgreSQL or MongoDB database that Cloud Run can reach. See [PostgreSQL](/deployment/postgresql/), [MongoDB](/deployment/mongodb/), or [Cloud SQL](/deployment/cloud-sql/) for Google's own PostgreSQL. SQLite does not work on Cloud Run.
- Run commands from your app's root folder. Examples use macOS/Linux shells; on Windows use WSL.

:::note
This path is reviewed against the source and Google's documentation. It has not been certified with a live Cloud Run deployment. Run the verification steps on an isolated service before production use.
:::

## 1. Generate the deployment folder

```bash
npx --no-install visualguard dashboard init --target cloud-run --out deploy/visualguard-cloud-run
cd deploy/visualguard-cloud-run
```

You should see the full path of the new folder. It must be empty or not exist yet. It contains:

| File | Purpose |
| --- | --- |
| `package.json` | Depends on `visualguard` and `playwright` when the scaffold includes host capture. |
| `Dockerfile` | Builds a Node 22 image, runs as the `node` user, listens on port 8080 and starts `visualguard dashboard` in login mode. A scaffold with host-capture support also installs Chromium; inspect the generated image before deployment. |
| `.dockerignore` | Keeps `node_modules`, `.git`, `.env*` and `.visualguard` out of the image. |
| `.env.example` | The variables you must set. Do not put real secrets here. |
| `.gitignore` | Keeps `node_modules/`, `.env*` and build output out of Git. |

## 2. Pin the package version

Inspect the generated dependency before installing. Resolve the current release and save its exact version in this deployment folder:

```bash
npm install --save-exact visualguard@latest
```

Run `npm ls visualguard --depth=0` and confirm `package.json` records the intended resolved release. Commit the folder with its `package-lock.json`. See [release availability](/releases/).

## 3. Prepare Google Cloud

Sign in, choose your project and region, and turn on the services that source deploys use:

```bash
gcloud auth login
export VG_PROJECT_ID="your-google-cloud-project"
export VG_REGION="us-central1"
gcloud config set project "$VG_PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

You should see `Operation ... finished successfully`. Ask your project administrator to grant the source-deploy and build permissions once; see [Cloud Run source deployment](https://docs.cloud.google.com/run/docs/deploying-source-code). Cloud Build builds the image from the `Dockerfile`, so you need no local Docker.

Make sure the database allows connections from Cloud Run with its required TLS settings. For Cloud SQL, follow [Cloud SQL](/deployment/cloud-sql/) after this page.

## 4. Write the service settings

Create `.env.cloud-run.yaml` in the deployment folder. Replace the values:

```yaml
VISUALGUARD_AUTH_MODE: "login"
VISUALGUARD_PUBLIC_URL: "https://setup.invalid"
VISUALGUARD_DATABASE_URL: "postgresql://REAL_USER:REAL_PASSWORD@REAL_HOST/REAL_DATABASE?sslmode=require"
VISUALGUARD_ADMIN_EMAIL: "owner@example.com"
VISUALGUARD_ADMIN_PASSWORD: "YOUR_UNIQUE_INITIAL_PASSWORD"
VISUALGUARD_USER_ADMISSION: "invite"
```

`https://setup.invalid` is a placeholder. You replace it in step 6, once Cloud Run assigns your URL. Use your provider's exact database URL and TLS options. The password must be 12 to 256 characters.

Protect the file and keep it out of the upload:

```bash
chmod 600 .env.cloud-run.yaml
cat > .gcloudignore <<'EOF'
.gcloudignore
.git
node_modules
.env
.env.*
.visualguard
EOF
```

Keep `package.json`, `package-lock.json` and `Dockerfile` in the folder; the build needs them.

## 5. Deploy

```bash
gcloud run deploy visualguard-dashboard \
  --source . --region "$VG_REGION" --env-vars-file .env.cloud-run.yaml \
  --port 8080 --max-instances 3 --no-allow-unauthenticated \
  --no-cpu-throttling --min-instances 1 --memory 2Gi
```

You should see `Service [visualguard-dashboard] revision [...] has been deployed`. The first build takes several minutes.

| Flag | Why |
| --- | --- |
| `--source .` | Build the image from this folder with Cloud Build. |
| `--env-vars-file` | Load the settings from step 4. |
| `--port 8080` | The port the `Dockerfile` listens on. |
| `--max-instances 3` | A starting cap. Raise it after testing database connections (five per instance). |
| `--no-allow-unauthenticated` | Keep the service private until the URL is set. |
| `--no-cpu-throttling` | Keep CPU running after a response, so tests started from the UI can finish. |
| `--min-instances 1` | Keep one container alive, so a running capture is not shut down. |
| `--memory 2Gi` | Room for Chromium during captures. |

These are starting values, not measured capacity limits.

:::caution
Confirm that the generated Dockerfile installs Chromium and the project's status shows **Runs on this dashboard**. If the installed package or image does not support host capture, upgrade and regenerate the scaffold, or connect a [private runner](/dashboard/private-runners/). The three flags above keep background execution available.
:::

With a release that has the built-in runner, these flags let a signed-in user press **Run test** with no runner token. Without them, Cloud Run pauses the capture when the request returns, and it fails as a disconnected execution.

## 6. Set the public URL

Read the assigned URL and store it in the service:

```bash
export VG_DASHBOARD_URL="$(gcloud run services describe visualguard-dashboard \
  --region "$VG_REGION" --format='value(status.url)')"
echo "$VG_DASHBOARD_URL"

gcloud run services update visualguard-dashboard \
  --region "$VG_REGION" --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_DASHBOARD_URL}"
```

You should see a URL ending in `.run.app`. Also replace `https://setup.invalid` in `.env.cloud-run.yaml` with this URL. Otherwise the next deploy puts the placeholder back.

## 7. Allow browser access

```bash
gcloud run services add-iam-policy-binding visualguard-dashboard \
  --region "$VG_REGION" --member="allUsers" --role="roles/run.invoker"

curl --fail "$VG_DASHBOARD_URL/api/health"
```

The health check should print `{"status":"ok"}`.

Public invocation lets browsers and CI reach the dashboard's own sign-in and token checks. It does not make project data public. If your organization forbids public invocation, you need a separately designed authenticated entry point; the VisualGuard CLI does not fetch Google IAM tokens.

## 8. Move secrets to Secret Manager

An env-vars file sets plain service variables. For long-term use, store the database URL and admin password in Secret Manager, give the service's runtime identity access to just those secrets, and map pinned versions to the variable names:

```bash
gcloud run services update visualguard-dashboard --region "$VG_REGION" \
  --set-secrets VISUALGUARD_DATABASE_URL=visualguard-db-url:1,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1
```

Remove those two lines from `.env.cloud-run.yaml` first. One variable cannot be both a plain value and a secret. See [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

## 9. Sign in and connect your app

Open `$VG_DASHBOARD_URL`, sign in with the admin email and password, then follow [login mode](/dashboard/login/) to create a project and an upload token.

For a custom domain, use a supported option such as an external Application Load Balancer with a serverless network endpoint group, then update `VISUALGUARD_PUBLIC_URL`. Google currently documents direct domain mapping as a preview that is not recommended for production. See [Cloud Run custom domains](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

## Example: a dashboard that runs its own tests

A team using a dashboard with built-in capture deploys with the flags above and Cloud SQL. Reviewers open a project, press **Run test**, and watch progress live. The dashboard captures with its own Chromium using the reviewer's sign-in. For one app behind a VPN, they also connect a private runner, which takes priority for that project.

## Verify the deployment

1. `curl --fail "$VG_DASHBOARD_URL/api/health"` prints `{"status":"ok"}`.
2. You can sign in at the exact public URL.
3. Refresh `/reviews`, `/baselines`, `/policies` and `/settings` directly. Each loads the dashboard.
4. Publish a real run from CI. Open it and view its screenshots.
5. On a release with the built-in runner, press **Run test** and wait for a finished run.
6. Deploy a new revision. The run should still be there.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The container fails to start | Open the service's **Logs** tab in the Google Cloud console and read the first error. |
| "Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data" | Add the database URL to the service and redeploy. |
| `/api/health` returns `{"status":"unavailable"}` | The database is unreachable. Check its network rules and TLS options. |
| Sign-in fails after a new deploy | The YAML still had `https://setup.invalid`. Fix the file and update the service. |
| A variable is both a literal and a secret | Remove it from the env-vars file before using `--set-secrets`. |
| "Runner disconnected or timed out" | Redeploy with `--no-cpu-throttling --min-instances 1 --memory 2Gi`. If host capture is unavailable, start a private runner. |
| "Chromium is not installed on the dashboard host" | The folder was generated by an older release. Regenerate it with the current release, or connect a private runner. |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Connect Cloud SQL](/deployment/cloud-sql/): use Google's PostgreSQL over its private socket.
- [Set up backups](/deployment/storage-and-backups/): before you store real evidence.
- [Plan upgrades](/deployment/upgrades/): regenerate the folder and redeploy safely.
