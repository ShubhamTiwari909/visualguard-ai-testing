---
title: "Use MongoDB"
description: "Set up a persistent MongoDB dashboard and verify project evidence after restart."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

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

## Verify the setup

Create a project/run, stop and restart with the same actual connection settings, and confirm history persists. Verify the selected database, not just that the server answers health requests.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/deployment/storage-and-backups/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
