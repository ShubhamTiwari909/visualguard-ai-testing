---
title: "Understand execution progress"
description: "Read queued, capture, upload and terminal states without confusing completion with a passing verdict."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/test-runner.ts"]
sidebar: {"order": 7}
---

## Before you start

Save the selected project's test profile. The test runs on the dashboard host, or on a [connected private runner](/dashboard/private-runners/), which takes priority. **Availability:** dashboard capture without a runner credential is in the source checkout and the next release after 3.2.3. With the published 3.2.3 package, **Run test** still needs a [connected private runner](/dashboard/private-runners/). Older private runners can execute but display an indeterminate running state.

## Read each stage

| Stage | What it tells you |
| --- | --- |
| Queued | The dashboard saved a request; a worker has not claimed it yet. |
| Starting | A worker claimed the saved profile and is preparing execution. |
| Capture/comparison | Real engine job events update route/viewport and completed comparisons. |
| Upload | Capture work is finished and evidence is being transferred. |
| Finalization | The stored result is being associated with the request. |
| Finished | The request has a result link; inspect its visual verdict. |
| Failed/disconnected | Execution could not finish; last reported progress/reason remain available. |

A label such as **2 of 4 comparisons (50%)** counts completed route/viewport jobs. It is not elapsed time, an ETA or the overall upload percentage. Upload/finalization stay indeterminate without measured totals. Refreshing the page does not erase persisted progress.

## Diagnose a stalled execution

For a dashboard-host capture, inspect the dashboard server log and confirm the host can reach both application URLs. For a private runner, keep the foreground worker running, inspect its output and verify the project-scoped credential. Requests use a saved profile version; unsaved UI edits cannot affect an already queued request. Queue/lease expiry and worker timeout are bounded; see the runner guide for current values. The system does not silently recapture after a lost lease.

## Verify the result

Open View result, check the source revision and inspect findings. A finished request may contain regressions, incomplete evidence or review work. Stop the worker in a disposable trial and confirm the last known comparison counts and failure context remain visible.
