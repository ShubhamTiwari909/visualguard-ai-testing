---
title: "Start a local dashboard"
description: "Start a SQLite dashboard on your computer, create a project, publish a run, run a test from the browser and confirm that history survives a restart."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "packages/visualguard/src/cli/commands/dashboard.ts",
    "apps/platform/server/runtime.ts",
    "apps/platform/server/config.ts",
  ]
sidebar: { "order": 3 }
---

This tutorial starts a dashboard on your own computer, stored in a local SQLite file. You will create a project, publish a test run into it, start a test from the browser and check that everything is still there after a restart. It needs no database server, no account and no token.

## Before you start

- Finish the [quickstart](/start/quickstart/). You need VisualGuard installed in your app, a working `visualguard.config.ts`, and both app versions (production and staging) running.
- Use Node.js 22.12 or newer. The dashboard refuses to start on older versions.
- Run every command from your app's root folder, where `visualguard.config.ts` lives.
- Keep two terminals open: **terminal A** for the dashboard server and **terminal B** for everything else.

Examples use macOS or Linux shells; on Windows use WSL. The `npx --no-install` prefix makes sure you run the VisualGuard version installed in your app, not a different download.

## 1. Create a local settings file

The dashboard reads settings from the environment. A small file keeps them explicit, so the dashboard does not pick up an unrelated `DATABASE_URL` from your app.

Create `.env.visualguard` in your app's root folder:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=
```

Add it to `.gitignore`:

```bash
echo ".env.visualguard" >> .gitignore
```

| Setting                             | What it does                                          |
| ----------------------------------- | ----------------------------------------------------- |
| `VISUALGUARD_AUTH_MODE=local`       | Trusts whoever uses this computer. No sign-in         |
| `VISUALGUARD_PUBLIC_URL=` (empty)   | Keeps the dashboard private to this computer          |
| `VISUALGUARD_DATABASE_URL=` (empty) | Selects SQLite, even if your app has a `DATABASE_URL` |

:::note
Values already exported in your shell win over values in the file. Use a fresh terminal without exported `VISUALGUARD_*` settings.
:::

## 2. Start the dashboard

In terminal A, start the server and leave it running:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

You should see:

```text
VisualGuard dashboard: http://127.0.0.1:4400
```

Open `http://127.0.0.1:4400` in your browser. You should see **Run history** with **Your evidence library starts here**, and **Local access** in the top bar.

The data lives in `.visualguard/platform/metadata.sqlite` under the folder you started from. To change the port or folder, put the options before any subcommand:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard \
  --data-dir /absolute/path/to/dashboard-data --port 4500
```

| Option                   | What it does                                                                   | Default                                       |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------- |
| `--port <number>`        | Port to listen on                                                              | `PORT`, or `4400`                             |
| `--host <host>`          | Address to listen on. Local mode only allows `127.0.0.1`, `localhost` or `::1` | `127.0.0.1`                                   |
| `--data-dir <directory>` | Folder for the SQLite file and stored screenshots                              | `.visualguard/platform` in the current folder |
| `--file <sqlite-file>`   | Open an existing SQLite file, such as a restored backup                        | Not set                                       |
| `--env-file <file>`      | Load settings from a file before starting                                      | Not set                                       |

If you use port 4500, use `http://127.0.0.1:4500` everywhere below.

## 3. Check that the dashboard answers

In terminal B, ask the dashboard for its health:

```bash
curl --fail --show-error http://127.0.0.1:4400/api/health
```

You should see `{"status":"ok"}`. If not, read the error in terminal A before going on.

## 4. Create a project

A project holds the history for one app. Its ID is permanent and used by the CLI. Its name is the label people see.

In terminal B:

```bash
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
```

You should see `Created: Storefront Web (storefront)`. Refresh the browser: **Storefront Web** appears under **PROJECTS** with 0 runs.

`--server` sends the request to the running dashboard, so the project lands in its storage even with a custom `--data-dir`. Running the command again prints `Already exists` and keeps the history.

You can also create it in the browser: choose **+ New project**, enter a **Project name** and a **Project ID**, then choose **Create project**.

## 5. Capture and publish a run

Now run a normal VisualGuard test and send the result to the dashboard. `--dashboard` only connects to the running dashboard. It does not start one.

In terminal B:

```bash
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

You should see a line starting with `Dashboard project: Storefront Web (storefront)`, the usual test output, then a `Dashboard run:` line with a link and the run status. Refresh the browser: the run appears in **Run history** under **Storefront Web**. Open it to see each check, then choose **Open comparison viewer ↗** for the full report.

The project argument also accepts an exact display name, such as `test "Storefront Web"`, when only one project has that name.

## 6. Import a run you already have (optional)

If you have an older run folder from an offline test, you can copy it into the dashboard. Replace `RUN_ID` with a real folder that contains `manifest.json`:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront --name "Storefront Web"
```

You should see `Imported: /runs/<id> [<status>]`. Refresh the browser to see it.

Import copies the evidence into the dashboard's storage. Deleting the original folder later does not remove the imported run. An incomplete run stays marked incomplete. Importing it does not turn it into a pass.

:::caution
`import` writes straight to the storage selected by `--env-file` and `--data-dir`. If the server uses a custom `--data-dir`, pass the same one to `import`.
:::

## 7. Run a test from the dashboard

You can also start a test from the browser. The dashboard keeps a saved test profile for each project.

:::note
If the project says **Runs on this dashboard**, the local dashboard can capture the test itself using your local access. If host capture is unavailable, upgrade or connect a [private runner](/dashboard/private-runners/) first.
:::

1. Choose **Storefront Web** in the sidebar. The **PROJECT** panel shows **Runs on this dashboard**.
2. Choose **Configure tests**. Enter the **Production / reference URL** and **Staging / candidate URL** your app uses, such as `http://127.0.0.1:3000` and `http://127.0.0.1:3001`. Keep **Routes** as `/` and **AI provider** as **None** for the first test.
3. Choose **Save test configuration**. The panel shows **Configuration v1**.
4. Choose **Run test**. The progress box moves through **Starting the browser…**, **Capturing screenshots…** and **Comparing and analyzing…**, with a count such as **1 of 1 comparisons completed (100%)**.
5. When it shows **Test finished**, choose **View result**.

You should see a new run named **Dashboard test · config v1** with environment `dashboard`. The dashboard captures with its own Chromium, so it needs Chromium installed (`npx playwright install chromium`). Full details: [Run tests from the dashboard](/dashboard/run-tests/).

## 8. Restart and check persistence

Stop the dashboard in terminal A with Ctrl+C. Start it again with the same command and the same `--data-dir`:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

Reload the browser. You should see **Storefront Web**, its runs and its saved test configuration, exactly as before.

A different data folder creates a separate, empty workspace. Deleting the folder deletes all local metadata and screenshots. Back it up first; see [Storage and backups](/deployment/storage-and-backups/).

## Add AI analysis (optional)

The same flow works with AI analysis. Keep your Gemini key in your app's ignored `.env.local`, as set up in [Use Gemini](/guides/ai-gemini/). The `test` command reads `.env` and `.env.local` itself.

In terminal B, after the health check passes:

```bash
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --provider gemini
```

This captures, analyzes and publishes in one run. For Ollama, start the Ollama service and use `--provider ollama --model qwen2.5vl` instead. See [Use Ollama](/guides/ai-ollama/).

For **Run test** with AI, the dashboard process needs the key, not terminal B. Put `GEMINI_API_KEY` in `.env.visualguard` and restart the dashboard.

## Use PostgreSQL or MongoDB instead

If you already set up [PostgreSQL](/deployment/postgresql/) or [MongoDB](/deployment/mongodb/), start terminal A with that `.env.visualguard` file instead of the SQLite one. Keep the health check, project creation and test pointed at the same dashboard URL. A new database does not copy runs from an earlier SQLite workspace.

For a dashboard that already runs elsewhere, use its real HTTPS address in `--server` and `--dashboard`. Do not start a second local workspace for the test. A login-mode dashboard also needs a project upload token; see [Publish and retry saved evidence](/dashboard/publishing/).

## Verify the setup

- `curl http://127.0.0.1:4400/api/health` returns `{"status":"ok"}`.
- **Storefront Web** appears under **PROJECTS** with at least one run.
- The run opens and **Open comparison viewer ↗** shows the report.
- After a restart with the same data folder, the project, runs and saved test configuration are still there.

## Troubleshooting

| Problem                                                                      | Fix                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The dashboard requires Node.js 22.12 or newer`                              | Switch your project to Node.js 22.12 or newer and start again                                                                                                                                        |
| `Cannot bind dashboard project: fetch failed`                                | The test could not reach the dashboard; no capture or AI work started. Check terminal A for errors, run the health check, and use the exact host and port the server printed in `--dashboard`        |
| `Configure a public URL and login before listening on an external interface` | Local mode only listens on `127.0.0.1`, `localhost` or `::1`. Remove `--host 0.0.0.0`, or [enable login](/dashboard/login/)                                                                          |
| Project or run is missing after the test                                     | The test and the dashboard used different storage. Use the same `--server` and `--dashboard` URL, and the same `--data-dir` for `import`. See [Projects, names and identities](/dashboard/projects/) |
| Works in one terminal, not in Docker or WSL                                  | `127.0.0.1` inside a container or WSL can be a different machine. Run both commands in the same environment                                                                                          |
| **Run test** is disabled and the panel says **Runner offline**               | Host capture is unsupported, disabled or unavailable. [Connect a private runner](/dashboard/private-runners/)                                                                                        |
| A dashboard test fails with a Chromium message                               | Run `npx playwright install chromium` on this computer, then choose **Run test** again                                                                                                               |

Do not remove `--dashboard` to hide a connection error. Without it, the test may write to a different local workspace. More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Tour of the dashboard](/dashboard/tour/): learn every screen you just saw.
- [Run tests from the dashboard](/dashboard/run-tests/): more on **Configure tests** and **Run test**.
- [Publish and retry saved evidence](/dashboard/publishing/): send runs from CI with an upload token.
- [Enable dashboard login](/dashboard/login/): turn this into a team workspace.
