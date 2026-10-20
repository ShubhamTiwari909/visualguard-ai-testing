---
title: "Dashboard, login and runner problems"
description: "Fix a dashboard that shows the wrong workspace, test runs that cannot reach or publish to it, Run test failures, runner status, login and database errors."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/test-executions.ts", "apps/platform/server/built-in-runner.ts", "apps/platform/server/test-runner.ts", "apps/platform/server/test-binding.ts", "apps/platform/server/config.ts", "apps/platform/server/auth.ts", "apps/platform/client/project-tests.tsx", "packages/visualguard/src/cli/commands/test.ts"]
sidebar: {"order": 4}
---

Use this page when the VisualGuard dashboard does not show what you expect, a test cannot publish to it, **Run test** fails, or sign-in and database settings go wrong. Each problem lists the likely cause, the exact fix and how to confirm it.

## Before you start

- Know which dashboard you are using: a local one started with `visualguard dashboard`, or a hosted one on Vercel or Cloud Run. See the [dashboard overview](/dashboard/overview/).
- Run commands from your app's root folder. A local SQLite dashboard stores its data relative to the folder you start it from.
- Keep the dashboard running in its own terminal. `visualguard test` never starts a dashboard for you.
- Examples use macOS/Linux shells; on Windows use WSL.

## The dashboard shows the wrong workspace or no runs

### Test runs work, but the dashboard shows another workspace

You ran `visualguard test "My Application"`, but `visualguard dashboard` shows different projects or no runs.

- **Likely cause:** the test and the dashboard read different settings, so they use different storage. Each process chooses its storage like this:

  | Command | Settings it reads |
  | --- | --- |
  | `test PROJECT` | Its own process settings plus the app's `.env` and `.env.local`. With no dashboard URL, it writes to the database those settings select, or to local SQLite storage. |
  | `test PROJECT --dashboard URL` | Publishes through that running dashboard, which chooses the database. The test needs no database URL. |
  | `dashboard --env-file .env.visualguard` | Loads that file, then starts. Settings already in the process win over the file. |
  | `dashboard` without `--env-file` | Uses process settings or defaults only. It does not read `.env.visualguard` or the app's `.env.local` by itself. |

- **Fix:** run one dashboard with an explicit settings file, and send tests to that exact server. Stop any older dashboard first.

  In terminal A, start the dashboard:

  ```bash
  npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
  ```

  In terminal B, run the test against it:

  ```bash
  npx --no-install visualguard test "My Application" \
    --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
  ```

- **Confirm:** terminal B prints `Dashboard project: My Application (...)` before capture and `Dashboard run: URL [STATUS]` at the end. The run appears in the dashboard.

### The project name is not found or is ambiguous

You see `More than one project has that name; use the project ID instead`, or the test cannot find the project.

- **Likely cause:** the name must match exactly one project in that dashboard. Names are case-sensitive and must be 1 to 120 characters.
- **Fix:** create the project with a stable ID, then use the ID for tests:

  ```bash
  npx --no-install visualguard dashboard project create my-app \
    --name "My Application" --server http://127.0.0.1:4400
  npx --no-install visualguard test my-app \
    --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
  ```

- **Confirm:** the test prints `Dashboard project: My Application (my-app)`.

### Recover a run that went to the wrong place

You do not need to capture again. The test output prints the saved run folder, by default `.visualguard/runs/RUN_ID`.

- **Fix:** after you create or select the right project, upload that folder:

  ```bash
  npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID \
    --project my-app --server http://127.0.0.1:4400
  ```

  Replace `RUN_ID` with the real folder name that contains `manifest.json`. Use `dashboard import` instead of `publish` to write straight into the local database without a server.
- **Confirm:** the run appears in the project's history.

:::note
Pointing a new dashboard at a new database does not move runs from an older SQLite workspace. In login mode, testing and publishing both need the project's upload token. The examples above assume local-owner mode.
:::

### History is empty after a restart

- **Likely cause:** the dashboard started from a different folder, or with a different `VISUALGUARD_PLATFORM_DATA_DIR`, `VISUALGUARD_SQLITE_FILE` or database URL. The default SQLite file lives in `.visualguard/platform` under the folder you start from.
- **Fix:** start from the same folder, or set an absolute `VISUALGUARD_PLATFORM_DATA_DIR`. Choosing a new database never migrates data.
- **Confirm:** the earlier runs are back after a restart.

### The dashboard uses another app's database, or SQLite instead of PostgreSQL

- **Likely cause:** the dashboard read a generic `DATABASE_URL` from the environment, or did not load the file you expected. `VISUALGUARD_DATABASE_URL` wins over `DATABASE_URL`. An explicitly empty `VISUALGUARD_DATABASE_URL` selects SQLite.
- **Fix:** set `VISUALGUARD_DATABASE_URL` to a dedicated database, unset stale exported values, and restart with the right `--env-file`. Do not print secrets while you check.
- **Confirm:** the dashboard shows the projects and history you expect.

## Tests cannot reach or publish to the dashboard

### `Cannot bind dashboard project: Cannot reach dashboard at URL`

The full message adds a reason in brackets, such as `(ECONNREFUSED)` or `(request timed out)`.

- **Likely cause:** the dashboard is not running, or it listens on another address or port. With Docker or WSL, the test terminal may not reach that address.
- **Fix:** keep the dashboard running in another terminal and copy the URL it prints into `--dashboard`. Check health from the test terminal:

  ```bash
  curl http://127.0.0.1:4400/api/health
  ```

- **Confirm:** the health check responds, and the test prints `Dashboard project: ...`.

### Other binding errors before capture

| Message | Fix |
| --- | --- |
| `Dashboard URL must be an HTTP(S) origin without a path or credentials` | Use only the origin, such as `https://dashboard.example.com`. |
| `Remote dashboards require HTTPS` | Use HTTPS for any host that is not `localhost`, `127.0.0.1` or `[::1]`. |
| `Set VISUALGUARD_UPLOAD_TOKEN to an upload token for this project` | Create an upload token for the project and set it on the test machine. |
| `...; set VISUALGUARD_UPLOAD_TOKEN to this project's active upload token` | The token is missing, revoked or belongs to another project. Create a new one. |
| `Dashboard project lookup returned an invalid response (...)` | Upgrade the dashboard so it matches the test machine's VisualGuard version. |

Binding errors stop the test before capture. A `400` or `409` answer exits with code `2`; other failures exit with code `3`.

### `Dashboard publishing failed: ...` after a successful capture

The message continues with `Saved evidence is kept at: PATH` and the exact retry command.

- **Likely cause:** the upload failed because of the token, the dashboard address, the network or a database limit.
- **Fix:** fix the cause, then publish the saved folder with the printed command. Keep the same project ID and labels. Do not recapture just to retry the upload.
- **Confirm:** the run appears in the dashboard. The test exited with code `3` when the visual result passed, so CI also shows the upload problem.

## Run test from the dashboard

**Run test** on a project page asks for a capture with the project's saved test configuration. Who captures depends on your release:

- **Published 3.2.3:** a connected [private runner](/dashboard/private-runners/) must do the capture.
- **Source checkout and the next release after 3.2.3:** if no private runner is connected, the dashboard can capture on its own server, using the signed-in user's login. This is called the built-in runner. A connected private runner always takes priority.

The status next to the button shows which applies: **Runner connected**, **Runs on this dashboard** or **Runner offline**.

### `Chromium is not installed on the dashboard host. Run npx playwright install chromium there, or connect a private runner.`

This applies to the built-in runner only (source and the next release after 3.2.3).

- **Likely cause:** the dashboard server has Playwright but no Chromium download.
- **Fix:** install Chromium on the machine that runs the dashboard, then restart it. Or connect a private runner instead.

  ```bash
  npx playwright install --with-deps chromium
  ```

  The Cloud Run image generated by `dashboard init --target cloud-run` installs Chromium already.
- **Confirm:** click **Run test** again. The progress moves past "Starting the browser…" to "Capturing screenshots…".

### `Connect a runner for this project before running a test`

- **Likely cause:** no private runner is connected and the built-in runner is not available. That happens when:
  - you use published 3.2.3, which has no built-in runner;
  - the dashboard runs on Vercel, where the built-in runner is off by default because serverless functions cannot keep a browser running;
  - `VISUALGUARD_BUILT_IN_RUNNER=off` (or `0`, `false`, `no`) is set.
- **Fix:** start a private runner for the project, or turn the built-in runner on with `VISUALGUARD_BUILT_IN_RUNNER=on`, but only on a host that can keep a browser running after a request returns.

  ```bash
  VISUALGUARD_RUNNER_TOKEN=... npx --no-install visualguard dashboard runner \
    --project my-app --server https://YOUR_DASHBOARD_HOST
  ```

- **Confirm:** the status changes to **Runner connected** or **Runs on this dashboard**, and **Run test** starts.

### `The dashboard is running another test; try again shortly`

This applies to the built-in runner only.

- **Likely cause:** the dashboard already runs as many tests as `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` allows across all projects. The default is `1`.
- **Fix:** wait for the other test to finish, then click **Run test** again. To allow more tests at once, raise `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` on a host with enough memory and CPU, or connect a private runner for busy projects.
- **Confirm:** the new request starts without the message.

### `Runner disconnected or timed out. Start the runner and request a new test.`

- **Likely cause:** nobody finished the test in time. A queued request fails after 5 minutes if no runner picks it up. A running test fails when its runner stops sending updates for 60 seconds, for example because the runner process exited, lost network, or the dashboard host restarted or paused during a built-in capture.
- **Fix:** start (or restart) the runner and click **Run test** again. On Cloud Run with the built-in runner, deploy with CPU always allocated (`--no-cpu-throttling`), at least one instance and 2 GiB of memory, because capture continues after the request returns.
- **Confirm:** the progress reaches "Test finished" and **View result** opens the run.

### Other Run test messages

| Message | Likely cause and fix |
| --- | --- |
| `Save or refresh this project's configuration before running` | The configuration changed since the page loaded. Save it, or reload the page. |
| `This project already has an active test` | Wait for the current test to finish. |
| `Another test was requested; refresh the project` | Someone else started a test at the same time. Reload the page. |
| `Capture or upload failed on the dashboard host. Check the dashboard server logs.` | The built-in capture failed for another reason, such as an unreachable URL. Read the server logs. |
| `Capture or upload failed. Check runner output; any captured evidence remains on the runner.` | The private runner failed. Read its terminal output. Its saved run folder can be published later. |

### Runner start-up errors

| Message | Fix |
| --- | --- |
| `Set VISUALGUARD_RUNNER_TOKEN to this project's runner credential` | Create a runner credential for the project and set it before `runner`. An upload token does not work here. |
| `Use an HTTPS dashboard origin, or HTTP on loopback` | Use HTTPS for remote dashboards. |
| `Use the project's ID` | Pass the project ID, not its display name, to `--project`. |
| `Polling must be 1000–30000 milliseconds` | Fix `--poll`. |
| `An active runner credential for this project is required` | The credential is revoked, expired or for another project. Create a new one. |

### The runner still looks connected after it exits

- **Likely cause:** the status uses the latest heartbeat. A runner counts as connected for 30 seconds after its last contact.
- **Fix:** wait 30 seconds and reload. Check that the runner process really stopped.
- **Confirm:** the status shows **Runner offline** (or **Runs on this dashboard** when the built-in runner is on).

### The test finished, but there is no passing check

- **Likely cause:** "Test finished" only means capture and upload are done. It is not a visual verdict.
- **Fix:** click **View result** and read the job statuses, the exact revision and the project's current policy.
- **Confirm:** the result page shows the statuses you expect. See [execution progress](/dashboard/execution-progress/).

### A visual policy stays pending or blocked

- **Likely cause:** the evidence does not match what the policy needs. Common gaps: the run is for another commit than the pull request head, the approved baseline version changed, screenshot coverage is missing, the evidence is too old, or a review decision is still open.
- **Fix:** capture the real current head, complete the missing review or coverage, then reconcile:

  ```bash
  npx --no-install visualguard dashboard policy reconcile --project my-app --pr 42 \
    --server https://YOUR_DASHBOARD_HOST
  ```

- **Confirm:** `dashboard policy assess --project my-app --revision SHA` reports the policy as satisfied. See [visual policies](/dashboard/visual-policies/).

### Progress stops during upload

- **Likely cause:** the comparison count does not measure upload time. Large runs or slow networks take longer at "Uploading test results…".
- **Fix:** check the runner or server logs and the saved run folder. Do not recapture just because the bar stopped moving.
- **Confirm:** the progress reaches "Saving the result link…" and then "Test finished".

## Sign-in and accounts

### Login loops or the Google callback is rejected

- **Likely cause:** the public address does not match exactly. `VISUALGUARD_PUBLIC_URL` must be the exact HTTPS origin, and Google must list `ORIGIN/api/auth/callback`. Missing test users or audience settings in Google also cause this.
- **Fix:** correct `VISUALGUARD_PUBLIC_URL` and the Google client settings, set all three of `VISUALGUARD_OIDC_ISSUER`, `VISUALGUARD_OIDC_CLIENT_ID` and `VISUALGUARD_OIDC_CLIENT_SECRET`, and restart.
- **Confirm:** you sign in and your profile shows the expected account. See [Google sign-in](/dashboard/google-sign-in/).

### Changing the bootstrap password has no effect

- **Likely cause:** `VISUALGUARD_ADMIN_PASSWORD` only creates the first administrator. Once that account exists, changing the variable does nothing.
- **Fix:** reset the password through account controls in the dashboard, or use the documented host recovery steps.
- **Confirm:** you can sign in with the new password, and old sessions are revoked. See [sign-in setup](/dashboard/login/).

### `Existing installation: set VISUALGUARD_USER_ADMISSION=invite or legacy explicitly before upgrading`

- **Fix:** choose `invite` (new users need an invitation) or `legacy` and set `VISUALGUARD_USER_ADMISSION` before you start the upgraded dashboard. See [migration notes](/releases/migration/).

### Upload token cannot claim tests

- **Likely cause:** upload tokens and runner credentials have different permissions. An upload token can only publish results.
- **Fix:** create a runner credential for the project and keep the runner open. You do not need one when the built-in runner runs the test.
- **Confirm:** the status shows **Runner connected**.

## Database and hosting

| What you see | Likely cause and fix |
| --- | --- |
| `role "USER" does not exist` | The PostgreSQL URL still has placeholders or the wrong user. Use the real user and grant it access to the schema. |
| `Database URL must use postgresql://, postgres://, mongodb:// or mongodb+srv://` | Fix the URL scheme. |
| `MongoDB URL must include a database name` | Add `/visualguard` before any `?` options. Do not end the URL at the cluster host. |
| MongoDB timeout or authentication failure | Check the Atlas IP access list, the database user and the URL-encoded password. Restart after you change the settings file. |
| `Invitation admission requires transactional storage...` | Use a MongoDB replica set, SQLite or PostgreSQL, or set `VISUALGUARD_USER_ADMISSION=legacy`. |
| MongoDB transaction errors | Check that the replica set primary is reachable and the URL is correct. Standalone MongoDB needs `legacy` admission. |
| `Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data` | Set an external PostgreSQL or MongoDB database. A file inside the container is lost on restart. |
| `Hosted login requires VISUALGUARD_PUBLIC_URL` | Set the exact public HTTPS origin. |
| A Vercel page reload returns 404 | The deployment folder lacks a rewrite for that page. Regenerate it with a current release, or add the missing rewrite. |
| Command, option or page is missing | The installed release may not have it. Compare with [release availability](/releases/). npm does not track the `main` branch. |

## Before you share a hosted dashboard

Check these on the real deployment: `/api/health`, sign-in, that each role only sees its projects, a small and a large run, images still loading after a redeploy, and a restore into a separate test environment. If you use GitHub checks, test signed webhooks and scheduled reconciliation too. Keep preview hosts and their databases separate from production.

:::note
The database and cloud steps in this section were checked against the source code. They were not validated on live cloud deployments for this documentation update. The [3.1.0 validation record](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/docs/RELEASE-3.1.0-VALIDATION.md) describes its own tested release only.
:::

## Next steps

- [Set up private runners](/dashboard/private-runners/) when the dashboard cannot reach your app.
- [Configure sign-in](/dashboard/login/) before you invite other people.
- [Back up the right storage](/deployment/storage-and-backups/) before you delete or recreate projects or databases.
