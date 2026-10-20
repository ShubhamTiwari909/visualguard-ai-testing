---
title: "Dashboard, login and runner problems"
description: "Find the correct workspace, fix connection settings and understand stale or failed worker execution."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 4}
---

If `npx --no-install visualguard test "My Application"` runs but `npx --no-install visualguard dashboard` shows another workspace, first check which storage each process selected:

| Process                                 | Settings it reads                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test PROJECT`                          | Runner process settings and `.env`/`.env.local`; with no dashboard URL, it writes to the runner's configured database or local SQLite storage |
| `test PROJECT --dashboard URL`          | Publishes through that running dashboard, which selects the database; the runner needs no database URL                                        |
| `dashboard --env-file .env.visualguard` | Explicitly loads that file, then starts the dashboard; existing process settings take precedence                                              |
| `dashboard` without `--env-file`        | Uses process settings or defaults; it does not automatically read `.env.visualguard` or the runner's `.env.local`                             |

Relative local SQLite storage also depends on the calling directory. Use the same application root and a single running dashboard for this workflow. To select the MongoDB workspace from [the related setup guide](/deployment/mongodb/), stop the old dashboard and run in terminal A:

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

## Other common symptoms

| Symptom                                                | What to check                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `role "USER" does not exist`                           | Actual PostgreSQL URI/user and schema grants; replace all placeholders                                                                                                                           |
| Dashboard unexpectedly uses another app's DB           | Dedicated `VISUALGUARD_DATABASE_URL`, loaded file, and inherited `DATABASE_URL`/process settings                                                                                                 |
| Empty history after a restart                          | Same calling directory/absolute data directory or database; selecting a new DB does not migrate data                                                                                             |
| `Cannot bind dashboard project: fetch failed`          | Keep the dashboard server running in another terminal; check `/api/health` and the printed host/port from the test terminal; see [AI with dashboard startup](/dashboard/local/) |
| `test "My Application"` ran but the dashboard is empty | Start the dashboard with its actual `--env-file`, then run `test PROJECT --dashboard http://127.0.0.1:4400`; see [missing project/run recovery](/troubleshooting/dashboard/)      |
| Project-bound test fails before capture                | Project already exists, unique name/ID, dashboard version and correct project token                                                                                                              |
| Upload fails after successful capture                  | Inspect retained local run and retry saved evidence; check token, canonical host, DB/network limits                                                                                              |
| Missing package/command/UI                             | Installed version supports it; rebuild source candidates explicitly instead of assuming npm tracks `main`                                                                                        |
| Google callback rejected                               | Exact origin/callback, configured test users/audience, complete OIDC settings and login mode                                                                                                     |
| `MongoDB URL must include a database name`             | Include `/visualguard` before URI query options; do not end the URL at the cluster hostname                                                                                                      |
| MongoDB connection timeout/authentication failure      | Atlas IP access list, database-user credentials/permissions and URL-encoded password; restart after updating the loaded environment file                                                         |
| MongoDB transaction/admission error                    | Replica set primary/network access, correct URI and appropriate `invite`/limited `legacy` choice                                                                                                 |
| Vercel page reload returns 404                         | Generated SPA rewrite for that supported page, without breaking API routing                                                                                                                      |
| Cloud Run starts then loses data                       | A real external DB is required; never rely on a container-local SQLite file                                                                                                                      |

Before sharing a hosted instance, verify health, login, role isolation, a small/large run, image retrieval after redeploy and an isolated native restore. Test signed webhooks/scheduled reconciliation if advertised. Keep unsupported preview hosts and databases separate.

The two final guides replace the earlier phase/setup walkthroughs. Examples, local links and configuration syntax are checked during documentation work; no live cloud/database deployment, application build, formatter, lint, type check or behavioral suite was run for this consolidation. The [historical release record](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/docs/RELEASE-3.1.0-VALIDATION.md) describes its own tested release only.

| Symptom | Diagnostic → fix → verification |
| --- | --- |
| UI uses SQLite but expected PostgreSQL | Inspect environment-loading and inherited `DATABASE_URL` without printing secrets. Start with the actual file/URI and confirm the intended project/history. |
| Login loops / wrong callback | Compare exact canonical origin, hostname, HTTPS and `/api/auth/callback`. Fix deployment values/Google registration, restart and verify account identity. |
| Bootstrap password edit has no effect | Administrator already persisted. Use authorized account controls or documented host recovery; verify revoked sessions/audit. |
| Upload credential cannot claim work | Upload tokens and runner credentials have different scopes. Create the project runner credential, keep the worker open and verify connected state. Not needed when the dashboard runs tests itself. |
| Run test fails with `Chromium is not installed on the dashboard host` | Run `npx playwright install chromium` on the dashboard host (the Cloud Run image includes it), or connect a private runner. |
| Run test is refused: `Connect a runner` | The host disables built-in capture (Vercel, or `VISUALGUARD_BUILT_IN_RUNNER=off`). Connect a private runner or enable it on a host that can keep a browser running. |
| Runner looks connected after exit | UI uses a recent-heartbeat indicator. Wait for its documented expiry, inspect the process/lease and request status. |
| Capture finished but no passing check | Lifecycle completion is not a verdict. Open View result; inspect findings, exact revision and current policy. |
| Progress stops during upload | Comparison counts do not measure upload/finalization. Inspect worker/network logs and saved evidence; do not invent an ETA or silently recapture. |
| Policy stays pending/blocked | Check actual PR head, baseline version, coverage, age and review decision. Fix the missing/stale evidence and reconcile. |

[Follow the runner lifecycle](/dashboard/private-runners/) and [account setup](/dashboard/login/) before deleting/recreating projects or databases.
