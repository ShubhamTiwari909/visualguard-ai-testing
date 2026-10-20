---
title: "Deploy the dashboard to Cloud Run"
description: "Follow the complete deploy the dashboard to cloud run workflow with persistent storage, login and verification."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 5}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## Validation scope

These instructions are reviewed against the current scaffold/source and linked provider documentation. This documentation implementation did not deploy a live cloud service, configure real OAuth or restore a production database. Follow the verification checklist on your own isolated installation before production use. The documentation website itself is static; the dashboard hosting instructions below describe a separate application.

Both hosts require an **external persistent database**; SQLite under their ephemeral filesystem is not supported. A managed PostgreSQL service is the simplest shared example here. A transaction-capable MongoDB URI can be used instead with provider-appropriate network access. Each new database starts as a separate empty workspace; deployment does not migrate your local history.

Use the four settings `VISUALGUARD_DATABASE_URL`, `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_ADMIN_EMAIL`, `VISUALGUARD_ADMIN_PASSWORD`, plus explicit `VISUALGUARD_AUTH_MODE=login`. Keep them server-side, never `NEXT_PUBLIC_`/`VITE_`. Use an exact canonical HTTPS origin without a path/query. A generated provider domain is sufficient initially; custom domains are optional.



From the application root:

```sh
npx --no-install visualguard dashboard init --target cloud-run --out deploy/visualguard-cloud-run
cd deploy/visualguard-cloud-run
npm pkg set dependencies.visualguard=3.2.3
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
  --port 8080 --max-instances 3 --no-allow-unauthenticated \
  --no-cpu-throttling --min-instances 1 --memory 2Gi

export VG_DASHBOARD_URL="$(gcloud run services describe visualguard-dashboard \
  --region "$VG_REGION" --format='value(status.url)')"

gcloud run services update visualguard-dashboard \
  --region "$VG_REGION" --update-env-vars "VISUALGUARD_PUBLIC_URL=${VG_DASHBOARD_URL}"

gcloud run services add-iam-policy-binding visualguard-dashboard \
  --region "$VG_REGION" --member="allUsers" --role="roles/run.invoker"

curl --fail "$VG_DASHBOARD_URL/api/health"
```

`--no-cpu-throttling`, a minimum instance and 2 GiB of memory let the service run dashboard tests itself: the generated image includes Chromium, and **Run test** works with just a signed-in account. Without them a capture started from the UI is paused when the request returns and fails as a disconnected execution. Update the URL inside the private YAML file too, so the next deploy does not restore `setup.invalid`. These are starting deployment settings, not measured capacity guarantees. Public invocation permits access to the product's own login/token authentication; it does not make private project data public. An organization forbidding public invocation needs a separately designed authenticated ingress path; the current CLI does not obtain Google IAM invocation tokens automatically.

Environment files configure service variables, not Secret Manager references. For ongoing operations, put the DB/admin secrets in Secret Manager, grant the runtime identity access to just those secrets, and map pinned enabled versions to their environment names. [Cloud Run secret configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

Open the assigned HTTPS URL and follow [the related setup guide](/dashboard/login/). A custom production domain can use a supported ingress option such as an external Application Load Balancer/serverless NEG; update the canonical origin afterward. Google's direct domain mapping is currently documented as preview and not recommended for production. [Cloud Run domain options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

## Check the generated package pin

The 3.2.3 artifact currently embeds CLI version 3.2.2. Its scaffold may therefore pin 3.2.2. The `npm pkg set` step above corrects the generated dependency to the intended tested 3.2.3 release before installation. Inspect the generated `package.json` and commit its deployment lockfile. [Read the artifact caveat](/releases/).

## Verify before using this installation

Open `/api/health`, sign in at the exact canonical HTTPS origin, refresh `/reviews`, `/baselines`, `/policies` and `/settings`, then publish real screenshots from a separate runner. Inspect every artifact and pull an approved baseline. Check database persistence after a new compute instance starts. Do not use a successful static page response as proof the API, credentials or storage work.

## Troubleshooting and next steps

Check deployment logs, literal/secret environment conflicts, canonical URL, network/TLS access and generated rewrites. Updating npm does not rewrite an existing deployment folder. Keep preview databases separate. Configure [native backups](/deployment/storage-and-backups/) and rehearse [upgrades](/deployment/upgrades/) before production changes.
