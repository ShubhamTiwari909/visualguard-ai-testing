---
title: "Connect a private runner"
description: "Run a dashboard test with just your sign-in, or connect a project-scoped private runner when the dashboard cannot reach your application."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/test-runner.ts"]
sidebar: {"order": 6}
---

## Before you start

This section applies to the private runner. Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

**Run test needs no token.** The dashboard server captures the test itself using Chromium on its host, authorized only by your signed-in account (maintainer or administrator). This is the default on a local dashboard (`visualguard dashboard`) and on Cloud Run (the generated image installs Chromium; deploy with `--no-cpu-throttling`, at least one instance and 2 GiB of memory, because capture continues after the request returns). The project shows **Runs on this dashboard** instead of a runner status.

Connect a **private runner** only when the dashboard host cannot reach your application URLs (for example a staging site behind a VPN) or when it cannot run a browser, as on Vercel and other serverless hosts. A connected private runner takes priority over the built-in capture. Set `VISUALGUARD_BUILT_IN_RUNNER=off` to force every test onto private runners, or `=on` to enable it on a host that is not detected as long-running. `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` (default 1) limits simultaneous built-in tests across projects; a request beyond it is refused until one finishes. If Chromium is missing on the host, the execution fails with a message telling you to run `npx playwright install chromium` there.

The rest of this guide covers the private runner.

1. Save the project's configuration as above. Choose AI **None** for the first test.
2. Expand **Connect a runner for this project** and choose **Create 30-day runner credential**. Save the credential when shown; it is different from an upload-only token. Existing upload-only tokens cannot claim tests.
3. In the application/runner directory, install the package version containing this feature and its browser prerequisites:

```sh
npm install --save-dev --save-exact visualguard
npm install --save-dev playwright
npx playwright install chromium
```

4. Create an ignored `.env.visualguard-runner` file on that computer, using the actual credential:

```dotenv
VISUALGUARD_RUNNER_TOKEN=YOUR_PROJECT_RUNNER_CREDENTIAL
```

Add `.env.visualguard-runner` to `.gitignore`. The runner needs network access to both application URLs and the dashboard. It needs no dashboard database URL or administrator password. If using Gemini, supply `GEMINI_API_KEY` in that private file/environment; for Ollama, start its service and provide the selected model on the runner. Capture can fall back to deterministic analysis on provider failure, as in [the related setup guide](/guides/ai-gemini/).

5. Start the foreground runner using the exact command shown by your dashboard. For a local dashboard:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-runner \
  runner --project storefront --server http://127.0.0.1:4400
```

For a hosted dashboard, replace `--server` with its canonical HTTPS origin. Keep the terminal/process running. Connect separate project-scoped runners/credentials for different projects. Use `--work-dir /absolute/private/runner-evidence` if you need a dedicated evidence directory; the default is `.visualguard/runner`. Install the browser dependencies required by your operating system, as for ordinary CLI captures.

6. When the project shows **Runner connected**, choose **Run test**. The UI shows queued/running/finished status and a **View result** link after upload. A finished execution can contain visual regressions; inspect the result rather than treating completion as approval. The run appears in that project's history.

Only one test is active per project. Captures use Chromium, bounded concurrency and a 15-minute worker timeout. Workers renew a 60-second lease; a lost lease or revoked credential stops the connected worker. A disconnected execution expires with a visible failure instead of silently recapturing. Queued requests expire after five minutes without a claim. The UI's connection indicator reflects a recent heartbeat, so it can briefly remain connected after a worker exits.

Captured evidence remains on the runner if capture/upload/completion is interrupted; use the normal saved-run publish workflow when appropriate. Revoking a runner credential does not revoke an unrelated project's credentials. Use **Revoke this runner credential** while the new credential is shown, or revoke it later under **People & integrations → Upload credentials**. Hosted login mode also stops accepting credentials whose owner is disabled, loses maintainer access, or has credentials invalidated. Runner credentials can upload evidence only for their project; they cannot edit configuration, trigger tests, approve reviews or manage accounts.

While a dashboard test runs, its project section shows the current stage, route/viewport and a **comparisons completed** bar (for example, 2 of 4 comparisons, 50%). Counts come from completed engine jobs, not a timer or an estimated completion time. Each comparison is one planned route/viewport. Upload and finalization have separate waiting indicators because their duration is not represented by comparison counts. A finished execution links to its actual result; it is not an automatic passing verdict.

Progress is saved in dashboard storage and survives page refreshes. Failed or disconnected executions retain their last reported counts. Upgrade both the dashboard and private runner to a version containing progress reporting; older runners can still execute work but show a generic indeterminate running state. Offline CLI tests are unchanged.

For a one-shot worker, `dashboard runner --once --project storefront --server URL` polls once, executes an already queued request if present and exits. It does not keep the dashboard connected; the default foreground loop is the normal UI workflow. `--poll 3000` controls polling in milliseconds (1000–30000). Use `dashboard runner --help` for the installed version's options.

Project configuration and execution/credential state belong in native operational database backups. Portable evidence exports do not replace that backup. Deleting the project removes its saved configuration, active request and runner credentials. New UI/runner commands require a published feature release; upgrading docs or a source checkout alone does not update an older installed npm package.

## Verify the setup

Request one test from the UI; confirm the foreground worker captures the saved profile and View result opens that project’s evidence. Stop the worker and verify disconnected/expired work remains visible.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/execution-progress/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
