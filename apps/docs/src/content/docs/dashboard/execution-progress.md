---
title: "Understand execution progress"
description: "Read queued, capture, upload and terminal states without confusing completion with a passing verdict."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/test-runner.ts"]
sidebar: {"order": 7}
---

## Before you start

[Connect a private runner](/dashboard/private-runners/) and save the selected project's test profile. Use a dashboard and runner release containing progress reporting; older workers can execute but display an indeterminate running state.

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

Keep the foreground worker process running and inspect its local output. Verify network access and the project-scoped credential. Requests use a saved profile version; unsaved UI edits cannot affect an already queued request. Queue/lease expiry and worker timeout are bounded; see the runner guide for current values. The system does not silently recapture after a lost lease.

## Verify the result

Open View result, check the source revision and inspect findings. A finished request may contain regressions, incomplete evidence or review work. Stop the worker in a disposable trial and confirm the last known comparison counts and failure context remain visible.
