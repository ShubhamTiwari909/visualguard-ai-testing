---
title: "Understand execution progress"
description: "Read each stage of a dashboard test, what the comparison count means, how failures look and why a finished test is not a passing verdict."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/test-runner.ts", "apps/platform/server/test-executions.ts", "apps/platform/client/execution-progress.tsx"]
sidebar: {"order": 9}
---

After you choose **Run test**, the project panel shows a progress box. This page explains every message in that box, what the comparison count measures, and what to do when a test stalls or fails. It applies to both the built-in runner and private runners.

## Before you start

- Know how to start a test. See [Run tests from the dashboard](/dashboard/run-tests/).
- The built-in runner is in the source checkout and the next release after 3.2.3. With the published 3.2.3 package, tests run on a [connected private runner](/dashboard/private-runners/).

## The life of a test

A dashboard test request has four states. The progress box title tells you which one, and during running, which stage.

| Title in the progress box | State | What is happening |
| --- | --- | --- |
| **Waiting for the runner…** | Queued | The request is saved. No capturer has claimed it yet |
| **Starting the browser…** | Running: starting | A capturer claimed the saved profile and is preparing |
| **Capturing screenshots…** | Running: capturing | Pages are loading and screenshots are being taken |
| **Comparing and analyzing…** | Running: comparing | The candidate screenshot was captured and is being compared, with AI if selected |
| **Uploading test results…** | Running: uploading | All comparisons are done; the evidence is being stored |
| **Saving the result link…** | Running: finalizing | The stored run is being linked to the request |
| **Running visual comparison…** | Running, no detail | An older private runner that does not report stages |
| **Test finished** | Completed | A run was created. **View result** opens it |
| **Test could not finish** | Failed | The test stopped. The reason appears in red |

Next to the title you see **Configuration v3** (or your version). That is the exact profile version this test uses. Editing the profile later does not change a test that already started.

While a test runs, the box also shows the current route and viewport, such as `/checkout · mobile`.

## What the comparison count means

A label such as **2 of 4 comparisons completed (50%)** counts finished checks. One comparison is one route at one viewport. A profile with routes `/` and `/checkout` and viewports `desktop` and `mobile` has four.

- The count only grows. It comes from real engine events, not a timer.
- It is not an estimate of time left.
- The bar fills only while capturing and comparing, and at the end.
- During **Uploading test results…** and **Saving the result link…**, the bar shows activity without a percentage, because upload time is not measured. The box adds: "Comparison processing has finished. Keeping the runner connected until the results are saved."

## Progress survives refreshes

The dashboard stores progress in its database. The page checks for updates about every 2.5 seconds. You can refresh, close the tab or open the project from another computer, and you see the same state.

A failed test keeps its last count and stage, so you can see how far it got.

## Finished does not mean passed

**Test finished** means the test ran to the end and a run was stored. The box says: "Open the result to see its visual regression and review status." The run itself can contain regressions, errors or checks that need review. Open **View result** and read the run's status and checks before you decide anything. See [Read results](/concepts/results/).

## Why a test fails

| Message | Cause |
| --- | --- |
| `Runner disconnected or timed out. Start the runner and request a new test.` | No capturer claimed the request within 5 minutes, or the capturer stopped renewing its 60-second lease |
| `Chromium is not installed on the dashboard host. Run npx playwright install chromium there, or connect a private runner.` | The built-in runner could not start a browser |
| `Capture or upload failed on the dashboard host. Check the dashboard server logs.` | The built-in runner hit an error while capturing or uploading |
| `Capture or upload failed. Check runner output; any captured evidence remains on the runner.` | A private runner hit an error |

A test also stops after 15 minutes. VisualGuard never silently captures a failed test again. Request a new one when you have fixed the cause.

## Diagnose a stalled test

1. **Stuck on Waiting for the runner…**: no capturer is available. For a private runner, check its terminal is running and says `Runner connected. Waiting for dashboard tests.` After 5 minutes the request fails on its own.
2. **Stuck on one route**: that page may be slow or unreachable from the capturer. Check that the capturer can open the URL. For the built-in runner, that is the dashboard host; `127.0.0.1` means the host itself.
3. **Fails as disconnected on Cloud Run**: the service was paused after the request returned. Redeploy with `--no-cpu-throttling --min-instances 1 --memory 2Gi`. See [Deploy to Cloud Run](/deployment/cloud-run/).
4. **Fails right after starting**: read the dashboard server log (built-in runner) or the runner terminal (private runner). It prints `Starting dashboard test <id> (configuration v1).` and then the error.

Unsaved edits in the form never affect a queued or running test. Only the saved version is used.

## Check what you are reading

- The configuration version in the box matches the profile you meant to test.
- **View result** opens a run in the right project. Its name is **Dashboard test · config v1** (or your version).
- In a disposable trial, stop a private runner mid-test and confirm the box later shows **Test could not finish** with its last count.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The box never leaves **Waiting for the runner…** | Start or reconnect the private runner, or check the built-in runner is on. See [Run tests from the dashboard](/dashboard/run-tests/) |
| Only **Running visual comparison…** with no stages | Upgrade the private runner to match the dashboard |
| The count stops and the test fails as disconnected | The capturer stopped or lost contact. Check its log, then request a new test |
| **Test finished** but no **View result** button | Refresh the page. If it still is missing, check the dashboard log for the `Dashboard test finished` line |

More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Run tests from the dashboard](/dashboard/run-tests/): the full flow and failure messages.
- [Connect a private runner](/dashboard/private-runners/): capture on your own machine.
- [Review exact visual evidence](/dashboard/reviews/): decide on the checks in the result.
