---
title: "Start a local dashboard"
description: "Create a SQLite-backed dashboard, select a project and preserve comparison history."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 2}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

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

## Check persistence

Stop the server with Ctrl+C and restart with the same environment and data directory. Reopen the project and verify its run still exists. A new data directory creates another workspace; deleting the directory deletes local metadata and stored evidence. Back up first.

## Optional AI on the same dashboard

The dashboard is a separate server. **`test --dashboard URL` connects to an already running dashboard; it does not start one.** Keep your production/reference and staging/candidate applications running too. The dashboard URL is different from both application URLs in `visualguard.config.ts`.

Use this complete local SQLite sequence from your application's root. It requires no separate database service or upload token. Complete section 2's installation/configuration and the Gemini key setup above first.

1. Create an ignored **`.env.visualguard-local`** file (leave any existing PostgreSQL/MongoDB environment file unchanged):

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=
```

Run in a fresh terminal without stale exported dashboard settings; process values take precedence over this file. Add `.env.visualguard-local` to `.gitignore`.

2. **Terminal A — start the dashboard and leave it running:**

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-local \
  --host 127.0.0.1 --port 4400
```

Open `http://127.0.0.1:4400`. Wait for the startup URL. If startup fails, fix the error in terminal A before continuing; do not close that terminal or stop the server with Ctrl+C.

3. **Terminal B — verify the dashboard, create the project, then run Gemini:**

```sh
curl --fail --show-error http://127.0.0.1:4400/api/health
```

Continue only when this returns `{"status":"ok"}`. Then run:

```sh
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --provider gemini
```

This captures, analyzes and publishes in one run. Keep the Gemini key in terminal B's application-root `.env.local`. For Ollama, use its running service and replace the provider with `--provider ollama --model qwen2.5vl`.

**Already using PostgreSQL or MongoDB?** Start terminal A with your existing `.env.visualguard` from [PostgreSQL setup](#6-run-npx-visual-regression-with-postgresql) or [MongoDB setup](#7-run-npx-visual-regression-with-mongodb) instead of the SQLite file. Keep the health check, project creation and test pointed at that same dashboard URL. Login-enabled dashboards also require the project upload token from section 8. For an already hosted dashboard, use its actual HTTPS origin in `--server` and `--dashboard`; do not start a second local workspace just for this test.

**`Cannot bind dashboard project: fetch failed`?** The project lookup could not contact the dashboard; Gemini analysis has not started. Check terminal A for startup errors, verify `/api/health` from terminal B, and use the same host/port printed by the server. A custom port such as 4500 must appear in the health URL, `--server` and `--dashboard`. Inside Docker/WSL, `127.0.0.1` may refer to a different environment: run the two commands together in the same environment or use a correctly reachable, authenticated dashboard address. Do not remove `--dashboard` to hide a connection error; that can select a different workspace.

## Verify the setup

The expected project/run appears at the actual server URL and remains after restart. The local SQLite workflow needs no external database or token while using local-owner mode.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/publishing/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
