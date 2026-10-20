---
title: "Publish and retry saved evidence"
description: "Connect CLI or CI captures to a project dashboard using scoped credentials and resumable uploads."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 4}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## Choose import or HTTP publication

Local import opens the selected dashboard storage on the same host. HTTP publication reaches an already running dashboard by URL. Keep the original run directory until the destination confirms complete evidence. Starting a test with `--dashboard` does not start the server.

## Create the publishing credential

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

## Retry or publish an existing run

Create an ignored `.env.visualguard-upload` containing just the real `VISUALGUARD_UPLOAD_TOKEN` and add that file to `.gitignore`. Replace the run path/project/server:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-upload \
  publish .visualguard/runs/RUN_ID \
  --project storefront --server https://YOUR_DASHBOARD_HOST
```

Explicit `--env-file` is useful here: do not assume every dashboard subcommand reads application `.env.local` automatically. The same immutable evidence can resume an upload for up to 24 hours; changed bytes/metadata cannot overwrite existing evidence under a reused identity. Transfers use 1 MiB chunks, checksums and bounded retries. A failed publication keeps the local run for inspection/retry. Current upload limits are 4096 referenced artifacts, 32 MiB per artifact, a 16 MiB raw manifest and 512 MiB of referenced bytes; MongoDB additionally bounds the complete metadata envelope to 12 MiB. Split exceptionally large executions into appropriately scoped complete runs.

## Import on the local dashboard host

Replace `RUN_ID` with a real run directory containing `manifest.json`:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront --name "Storefront Web"
```

Refresh the dashboard. Import copies/indexes the evidence; deleting the original runner output later does not remove the imported database objects. An incomplete/error run remains visibly incomplete, rather than being turned into a pass by importing it.

## Verify the setup

Confirm the project/run identity, actual commit and all expected artifacts in history. Retry a saved run without changing its bytes; do not recapture merely to hide an upload failure.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/private-runners/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
