---
title: "Run tests from the dashboard"
description: "Save a project test profile, choose Run test, watch progress and open the result, with the built-in runner's requirements, settings, hosting notes and failure messages."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "apps/platform/server/built-in-runner.ts",
    "apps/platform/server/test-executions.ts",
    "apps/platform/server/test-runner.ts",
    "apps/platform/server/http.ts",
    "apps/platform/client/project-tests.tsx",
    "apps/platform/client/execution-progress.tsx",
    "apps/platform/server/scaffold.ts",
  ]
sidebar: { "order": 7 }
---

This tutorial runs a visual test from the browser. You save a test profile for a project, choose **Run test**, watch it progress and open the result. By default the dashboard captures the screenshots itself, using only your sign-in. Use this when you want a quick check without opening a terminal or CI.

:::note
**Check your dashboard:** **Runs on this dashboard** means host capture is available. If that option or the built-in runner setting is absent in your installed package, upgrade or use a [connected private runner](/dashboard/private-runners/). See [release availability](/releases/).
:::

## How Run test decides who captures

When you choose **Run test**, the dashboard picks one capturer:

1. If a [private runner](/dashboard/private-runners/) for this project checked in during the last 30 seconds, the private runner captures. It always takes priority.
2. Otherwise, if the built-in runner is on, the dashboard host captures with its own Chromium.
3. Otherwise, the request is refused with `Connect a runner for this project before running a test`.

The built-in runner needs no extra credential. Your signed-in Maintainer or administrator account is the only permission it needs. In local mode, the Local owner can use it.

## Before you start

- Have a project with a saved test profile. See [Configure tests per project](/dashboard/project-configuration/). Choose AI provider **None** for the first test.
- Be a Maintainer of the project or a workspace administrator. Viewers and Reviewers can watch progress but cannot start tests.
- For the built-in runner, the **dashboard host** (the machine running `visualguard dashboard`) needs:
  - Chromium for Playwright. Install it there with `npx playwright install chromium`.
  - Network access to both URLs in the profile. `127.0.0.1` means the dashboard host itself.
  - The AI setup the profile uses: `GEMINI_API_KEY` in the dashboard's environment for Gemini, or a reachable Ollama service with the model installed.
- A dashboard version that includes the built-in runner (see the note above).

## 1. Open the project

Choose the project under **PROJECTS** in the sidebar.

You should see the **PROJECT** panel. Its **Visual test** line shows who will capture and the saved version, for example **Runs on this dashboard · Configuration v1**.

| Status text                | What it means for Run test                   |
| -------------------------- | -------------------------------------------- |
| **Runs on this dashboard** | The built-in runner will capture             |
| **Runner connected**       | A private runner will capture                |
| **Runner offline**         | Nobody can capture. **Run test** is disabled |

## 2. Check the saved profile

Open **Saved test configuration** and confirm the URLs, routes, viewports and AI provider. To change them, choose **Configure tests**, edit and choose **Save test configuration**.

You should see no **Save the configuration before running a test.** message. **Run test** stays disabled while edits are unsaved.

## 3. Choose Run test

Choose **Run test**.

You should see the button change to **Requesting…** and then **Test in progress…**. A progress box appears under the heading.

## 4. Watch progress

The progress box updates about every 2.5 seconds. It shows the stage, the current route and viewport, and how many comparisons have finished.

| Title                        | What is happening                                   |
| ---------------------------- | --------------------------------------------------- |
| **Waiting for the runner…**  | The request is saved and waiting to be picked up    |
| **Starting the browser…**    | The capturer took the request and is preparing      |
| **Capturing screenshots…**   | Pages are being loaded and captured                 |
| **Comparing and analyzing…** | Screenshots are being compared, with AI if selected |
| **Uploading test results…**  | Comparisons are done; evidence is being stored      |
| **Saving the result link…**  | The new run is being linked to this request         |
| **Test finished**            | A run was created                                   |
| **Test could not finish**    | The test failed; the reason appears in red          |

A count such as **3 of 6 comparisons completed (50%)** counts finished route and viewport pairs. It is not a timer. Upload and saving have no percentage because their length is not measured. You can refresh the page or leave it; progress is stored by the dashboard. See [Understand execution progress](/dashboard/execution-progress/).

## 5. Open the result

When the box says **Test finished**, choose **View result**.

You should see a new run named **Dashboard test · config v1**, with environment `dashboard`. It also appears in **Run history** for the project.

## 6. Read the result

"Finished" means the test ran to the end. It does not mean the pages match. Check the run's status and its **Checks** table, then open **Open comparison viewer ↗** for detail. A finished test can contain regressions that need [review](/dashboard/reviews/).

## Built-in runner settings

Set these in the dashboard's environment, for example in `.env.visualguard` or your host's secret settings, then restart the dashboard.

| Setting                                   | What it does                                                                                                                                         | Default                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `VISUALGUARD_BUILT_IN_RUNNER`             | `on` lets the dashboard capture tests itself. `off` (also `0`, `false` or `no`) means every test needs a private runner                              | On, except on Vercel (when `VERCEL` is set), where it is off |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` | How many built-in tests may run at the same time across all projects served by this dashboard process. Extra requests are refused until one finishes | `1`                                                          |

Only turn the built-in runner on where a browser can keep running after the web request returns.

Capacity is reserved before saving a request, so simultaneous requests from different projects cannot exceed the process limit. A rejected request does not leave a queued test behind, and a failed save releases its reserved slot. Separate server replicas each have their own limit.

## Rules that always apply

- One active test per project. A second request gets `This project already has an active test`.
- A request that nobody picks up within 5 minutes fails.
- The capturer renews a 60-second lease while it works. If the lease runs out, the test fails as disconnected. It is never captured again silently.
- A single test stops after 15 minutes.
- Tests capture with Chromium, one page at a time.
- The built-in runner works in a temporary folder on the dashboard host and deletes it after each test. A capture that fails before evidence is stored may leave no saved run; inspect the failure and request a new test. A completed run with visual regressions is still saved.

## Where the built-in runner works

| Host                                      | Built-in runner | What to do                                                                                                                                                                                                               |
| ----------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local dashboard (`visualguard dashboard`) | On              | Install Chromium on your computer with `npx playwright install chromium`                                                                                                                                                 |
| Cloud Run                                 | On              | The generated image installs Chromium. Deploy with `--no-cpu-throttling`, `--min-instances 1` and `--memory 2Gi`, because capture continues after the request returns. See [Deploy to Cloud Run](/deployment/cloud-run/) |
| Other long-running servers or containers  | On              | Install Chromium on that host                                                                                                                                                                                            |
| Vercel and other serverless hosts         | Off             | Functions cannot keep a browser alive. [Connect a private runner](/dashboard/private-runners/)                                                                                                                           |

On Cloud Run without those flags, a test started from the dashboard is paused when the request returns and fails as disconnected.

## When to use a private runner instead

Use a [private runner](/dashboard/private-runners/) when:

- The dashboard host cannot reach your app, for example a staging site behind a VPN, or an app on your laptop's `127.0.0.1` while the dashboard is hosted.
- The dashboard host cannot run a browser, as on Vercel.
- Your app's login state or AI keys must stay on your own computer or CI worker.
- Your installed dashboard does not offer built-in capture.

A connected private runner always wins over the built-in runner.

## Check the result

- **View result** opens a run named **Dashboard test · config v1** (or your current version) in the right project.
- **Run history** lists the run with environment `dashboard`.
- The **Visual test** line still shows **Runs on this dashboard**, and **Run test** is enabled again.

## Troubleshooting

These messages appear under **Run test** or in the progress box.

| Message                                                                                                                    | What it means and what to do                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Connect a runner for this project before running a test`                                                                  | No private runner is connected and the built-in runner is off or unavailable (for example on a dashboard without host-capture support, or on Vercel). [Connect a private runner](/dashboard/private-runners/), or set `VISUALGUARD_BUILT_IN_RUNNER=on` on a host that can run a browser |
| `The dashboard is running another test; try again shortly`                                                                 | The built-in runner is at its concurrency limit. Wait, or raise `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` if the host has room                                                                                                                                                          |
| `This project already has an active test`                                                                                  | Wait for the current test to finish or fail                                                                                                                                                                                                                                             |
| `Save or refresh this project's configuration before running`                                                              | The profile changed or was never saved. Save it, or refresh the page to load the latest version                                                                                                                                                                                         |
| `Another test was requested; refresh the project`                                                                          | Someone else requested a test at the same moment. Refresh the page                                                                                                                                                                                                                      |
| `Chromium is not installed on the dashboard host. Run npx playwright install chromium there, or connect a private runner.` | Install Chromium on the dashboard host and try again                                                                                                                                                                                                                                    |
| `Capture or upload failed on the dashboard host. Check the dashboard server logs.`                                         | Read the dashboard's log. Check whether the host can reach both URLs and write evidence. AI failures can instead fall back to deterministic comparison; if a run completes without AI, check its fallback warning and provider configuration                                            |
| `Runner disconnected or timed out. Start the runner and request a new test.`                                               | The capturer stopped renewing its lease, or nobody picked up the request in 5 minutes. On Cloud Run, check the deploy flags above. A dashboard restart during a test also causes this                                                                                                   |
| `You do not have access to this project or action`                                                                         | Only Maintainers and administrators can start tests                                                                                                                                                                                                                                     |

The dashboard log prints `Starting dashboard test <id> (configuration v1).` when capture starts and `Dashboard test finished: /runs/<id> [<status>]` when it ends. More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Understand execution progress](/dashboard/execution-progress/): read every stage and failure state.
- [Connect a private runner](/dashboard/private-runners/): capture on your own computer or CI worker.
- [Review exact visual evidence](/dashboard/reviews/): review the checks in your new run.
