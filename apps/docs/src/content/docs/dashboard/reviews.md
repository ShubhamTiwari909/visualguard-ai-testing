---
title: "Review exact visual evidence"
description: "Use the reviewer inbox, discussion and scoped decisions without rewriting original results."
audience: "reviewer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/LOCAL-SETUP.md", "docs/PRODUCT-FEATURES.md"]
sidebar: {"order": 11}
---

## Before you start

Publish a complete run to the selected project and sign in with Reviewer, Maintainer or administrator authority. Viewers can read evidence but cannot record review decisions. [Publish evidence](/dashboard/publishing/) first; no browser/AI service is required on a reviewer's computer.

## Review a captured check

1. Open a stored run and select its color-change check in **Team review / Check reviews**.
2. Compare the screenshots and findings. Add a comment/reply, assign an active reviewer and optional deadline, then inspect the **Review inbox**.
3. Choose **Approve visual change**, **Request changes** or **Withdraw decision**, with a reason. Refresh after a stale-version conflict.

Decisions apply to exact evidence/check scope. A comment or offline `accept` file is not a shared visual approval. Another run needs its own review. Deadlines are entered in UTC and displayed using the browser's time zone.

## Understand the review boundary

On a stored run, a reviewer can select a check, inspect evidence, comment, reply, assign an active reviewer and set an optional deadline. Decisions include **Approve visual change**, **Request changes** and **Withdraw decision**, with a reason.

Review history records the actor, time, source/evidence scope and decision. Conflicting writes require refresh instead of silently replacing another person's action. Deadlines are entered in UTC and displayed in the browser's time zone.

The **Review inbox** helps find assigned work, pending/rejected decisions and overdue items. Its default view focuses on the current reviewer's items needing attention.

The current approval unit is the captured check/job, not arbitrary selection of a few image pixels. Approval applies to that evidence; it does not rewrite capture reliability, independent failures or a different run's result.

## Verify and troubleshoot

Open the inbox as the assigned reviewer, record a reasoned decision, then reopen the stored run and verify the actor/evidence scope. If another person changed the record, refresh before retrying. Check project membership and active reviewer state if assignment is unavailable. A comment, local accepted file or approval of a different run does not approve this evidence.

## Next steps

[Promote reviewed evidence](/dashboard/approved-baselines/) or [evaluate a visual policy](/dashboard/visual-policies/).
