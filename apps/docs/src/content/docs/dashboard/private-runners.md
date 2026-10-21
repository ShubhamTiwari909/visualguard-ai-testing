---
title: "Connect a private runner"
description: "Run dashboard-requested tests on your own computer or CI worker with a project-scoped runner credential, when the dashboard host cannot reach your app or run a browser."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "apps/platform/server/test-runner.ts",
    "apps/platform/server/test-executions.ts",
    "apps/platform/client/project-tests.tsx",
    "packages/visualguard/src/cli/commands/dashboard.ts",
  ]
sidebar: { "order": 8 }
---

A private runner is a small VisualGuard process you keep running on your own computer or CI worker. It picks up tests that people request with **Run test** in the dashboard, captures them there and uploads the result. This tutorial connects one to a project.

New to **Run test**? Start with [Run tests from the dashboard](/dashboard/run-tests/). On a dashboard that offers built-in capture, you only need a private runner in the cases below. Check the project's execution status; dashboards without host-capture support always need a private runner.

## When you need a private runner

- The dashboard cannot reach your app. Examples: a staging site behind a VPN, or an app on your laptop's `127.0.0.1` while the dashboard is hosted.
- The dashboard host cannot run a browser, as on Vercel and other serverless hosts.
- Your app's login state or AI keys must stay on your own machine.
- Your installed dashboard does not offer host capture.

A connected private runner always takes priority over the built-in runner.

## How it works

1. The runner asks the dashboard for work every 3 seconds, using a runner credential for one project.
2. When someone chooses **Run test**, the runner claims the request and gets a copy of the saved test profile.
3. It captures with Chromium on its own machine and reports progress while it works.
4. It uploads the run to the project and links it to the request. **View result** appears in the dashboard.

The runner needs no database URL and no dashboard password. It only needs the credential and network access.

## Before you start

- A project with a saved test profile. See [Configure tests per project](/dashboard/project-configuration/). Choose AI provider **None** for the first test.
- Maintainer access to the project, or workspace administrator access, to create the credential.
- A runner machine (your computer or a CI worker) that can reach:
  - both URLs in the profile, and
  - the dashboard, over HTTPS, or over plain HTTP only on `localhost`, `127.0.0.1` or `[::1]`.
- A VisualGuard version that matches your dashboard. Run commands on the runner from your app's root folder. Examples use macOS or Linux shells; on Windows use WSL.

## 1. Create a runner credential

1. In the dashboard, choose the project under **PROJECTS**.
2. In the **PROJECT** panel, expand **Connect a runner for this project**. When the built-in runner is on, it is called **Use a private runner instead**.
3. Choose **Create 30-day runner credential**.

You should see a line like this, shown only once:

```dotenv
VISUALGUARD_RUNNER_TOKEN=vg_runner_...
```

Copy it now. The panel also shows the exact command to start the runner for this project. If you copied the credential somewhere unsafe, choose **Revoke this runner credential** right away and create a new one.

:::note
A runner credential is not an upload token. Upload tokens cannot claim tests, and runner credentials cannot be used to browse the dashboard.
:::

## 2. Install VisualGuard and Chromium on the runner

On the runner machine, in your app's folder:

```bash
npm install --save-dev --save-exact visualguard
npm install --save-dev playwright
npx playwright install chromium
```

You should see Playwright download Chromium. Also install any system packages your operating system needs for browsers, as for ordinary CLI tests. See [Install VisualGuard](/start/install/).

## 3. Store the credential privately

Create `.env.visualguard-runner` with the real credential:

```dotenv
VISUALGUARD_RUNNER_TOKEN=vg_runner_YOUR_CREDENTIAL
```

Keep it out of Git:

```bash
echo ".env.visualguard-runner" >> .gitignore
```

If the profile uses Gemini, put `GEMINI_API_KEY` in this file or in `.env.local`; the runner reads `.env` and `.env.local` too. For Ollama, start the service on the runner and install the model. If AI fails, the comparison can still finish without AI, as described in [Use Gemini](/guides/ai-gemini/).

## 4. Start the runner

Use the command the dashboard showed you. For a local dashboard it looks like this:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard-runner \
  runner --project storefront --server http://127.0.0.1:4400
```

For a hosted dashboard, use its HTTPS address, such as `--server https://visual.example.com`.

You should see:

```text
Connecting runner to http://127.0.0.1:4400, project storefront.
Runner connected. Waiting for dashboard tests.
```

Leave this terminal open. The runner works only while it runs. Stop it with Ctrl+C.

| Option                   | What it does                                            | Default               |
| ------------------------ | ------------------------------------------------------- | --------------------- |
| `--project <id>`         | The project ID. Display names are not accepted here     | Required              |
| `--server <url>`         | The dashboard address, without a path                   | Required              |
| `--poll <milliseconds>`  | How often to ask for work, from 1000 to 30000           | `3000`                |
| `--work-dir <directory>` | Where captured evidence is written                      | `.visualguard/runner` |
| `--once`                 | Ask once, run a waiting test if there is one, then exit | Off                   |

Run `npx --no-install visualguard dashboard runner --help` to see the options of your installed version.

## 5. Run a test

1. In the dashboard, wait until the **Visual test** line says **Runner connected**. This can take a few seconds.
2. Choose **Run test**.

You should see the progress box move from **Waiting for the runner…** to **Starting the browser…**, **Capturing screenshots…** and onward. The runner terminal prints:

```text
Starting dashboard test <request id> (configuration v1).
Dashboard test finished: http://127.0.0.1:4400/runs/<run id> [<status>]
```

When the box says **Test finished**, choose **View result**. The run appears in the project's **Run history**.

## Check the connection

- The **Visual test** line says **Runner connected** while the runner is running.
- **Run test** produces a run you can open with **View result**.
- Stop the runner, wait about 30 seconds and refresh. The line should say **Runner offline**, or **Runs on this dashboard** if the built-in runner is on.

The connected status reflects the last check-in within 30 seconds, so it can stay **Runner connected** briefly after the runner stops.

## Manage runner credentials

- Runner credentials last 30 days when created from the panel. Create a new one before the old one expires.
- They appear in **People & integrations** under **Upload credentials**, named **Runner for** and the project name. Choose **Revoke** there to stop one.
- Each credential works for one project only. Revoking it does not affect other projects. Use one runner and one credential per project.
- A runner credential can claim tests, report progress and upload runs for its project. It cannot edit settings, start tests, approve reviews or manage people.
- In login mode, a credential stops working when its owner is disabled, loses Maintainer access, or has sessions and credentials revoked.

## What happens when something goes wrong

- **Capture fails.** The dashboard shows `Capture or upload failed. Check runner output; any captured evidence remains on the runner.` The runner prints `Dashboard test failed; evidence remains under <work dir>.` You can inspect that evidence, or publish a saved run with an upload token as in [Publish and retry saved evidence](/dashboard/publishing/).
- **The upload worked, but the dashboard did not confirm it.** The runner retries the confirmation a few times with the same run. If it still fails, it prints `Run uploaded: <link>. Completion could not be acknowledged; retain this result instead of repeating the capture.` Use that link instead of testing again.
- **The runner loses contact.** It renews a 60-second lease while it works. If the dashboard rejects it, or no renewal succeeds for 45 seconds, it stops the capture. The dashboard marks the test `Runner disconnected or timed out. Start the runner and request a new test.` It never captures again on its own.
- **Nobody picks up the request.** A request waits 5 minutes for a runner, then fails.
- **A test runs too long.** Each test stops after 15 minutes.

Only one test can be active per project at a time.

## One-shot runners in CI

`--once` asks for work a single time. If a test is waiting, it runs it and exits; otherwise it exits at once.

```bash
npx --no-install visualguard dashboard runner --once \
  --project storefront --server https://visual.example.com
```

Set `VISUALGUARD_RUNNER_TOKEN` from a CI secret. A one-shot runner does not keep the project connected, so someone must request the test first. For everyday use, keep the normal runner running.

## Backups and upgrades

Saved profiles, test requests and credentials live in the dashboard database. Include them in your native database backups; a portable evidence export does not replace that. See [Storage and backups](/deployment/storage-and-backups/).

Upgrade the dashboard and the runner together. An older runner can still run tests, but shows a plain "running" state without detailed progress. Updating the docs or a source checkout does not upgrade an installed npm package.

## Troubleshooting

| Problem                                                                                | Fix                                                                                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Set VISUALGUARD_RUNNER_TOKEN to this project's runner credential`                     | The variable is missing or is an upload token. Use the `vg_runner_...` credential and pass `--env-file .env.visualguard-runner` |
| `Runner claim request rejected (403); check the runner credential, project and server` | The credential is revoked, expired or for another project, or `--project` is wrong. Create a new credential for this project    |
| `Use an HTTPS dashboard origin, or HTTP on loopback`                                   | Use the dashboard's `https://` address with no path                                                                             |
| `Use the project's ID`                                                                 | `--project` needs the project ID, such as `storefront`, not the display name                                                    |
| The panel stays **Runner offline**                                                     | Check the runner terminal for errors, and that `--server` is the same address you open in the browser                           |
| `Capture or upload failed...`                                                          | Read the runner output. Usually a URL the runner cannot reach, a missing browser, or a missing AI key                           |

More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Understand execution progress](/dashboard/execution-progress/): read each stage of a running test.
- [Run tests from the dashboard](/dashboard/run-tests/): the full **Run test** flow and the built-in runner.
- [Publish and retry saved evidence](/dashboard/publishing/): publish runs from CI instead.
