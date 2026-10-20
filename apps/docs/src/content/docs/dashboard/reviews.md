---
title: "Review exact visual evidence"
description: "Use the reviewer inbox, discussion and scoped decisions without rewriting original results."
audience: "reviewer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/LOCAL-SETUP.md", "docs/PRODUCT-FEATURES.md", "apps/platform/client/reviews.tsx"]
sidebar: {"order": 11}
---

Use team review when another person needs to inspect a captured visual change and record a decision. The decision stays attached to the exact check in the saved run. It does not change the original screenshots or turn unrelated failures into passes.

## Before you start

- [Publish a complete run](/dashboard/publishing/) to the intended project, or [run a dashboard test](/dashboard/run-tests/).
- Sign in with Reviewer, Maintainer or workspace administrator access. Viewers can read evidence but cannot record decisions.
- Use a normal web browser. A reviewer's computer needs no capture browser installation or AI service.

## 1. Open the saved evidence

Choose the project, open its run in **Run history**, and find **Team review**. Select the route and viewport in the **Check** selector. Confirm the displayed route and source revision describe the change you intend to review.

You should see **Reference** and **Candidate** images for that check. Open either image to inspect it at full size. Expand **Captured findings** when available; use the comparison viewer for more detail. A login page or missing capture needs investigation before approval.

## 2. Discuss the change

Write a concrete note in **Comment / decision reason**, then choose **Post comment**. You can reply to an existing entry to keep a conversation together. A comment records discussion only; it does not approve or reject the appearance.

Use **Link to this review** to open a link scoped to this run and check. Share it through your team's usual channel; the recipient still needs project access.

## 3. Assign the review

In **Assign a reviewer**, select an active eligible teammate, optionally set **Deadline (UTC, optional)** and an **Assignment note**, then choose **Save assignment**.

The deadline is entered in UTC and displayed in the browser's time zone. Check it after saving, especially for teammates in another time zone. Assigning a reviewer or reaching a deadline does not itself approve a change.

Choose **Review inbox** to find work waiting for a decision. Its initial view focuses on the current reviewer's items needing attention. Open the relevant check from the inbox and inspect its evidence before deciding.

## 4. Record a decision

Enter a reason first. Use a decision that covers the entire selected check:

| Action | Use it when |
| --- | --- |
| **Approve visual change** | All visual changes in this exact check are intentional and acceptable. |
| **Request changes** | At least one visual defect remains; explain what must change. |
| **Withdraw decision** | An existing decision should no longer stand; provide the reason. |

For example, “The wider checkout button matches the approved design; text and spacing are unchanged” explains an approval. “The price overlaps the checkout control on mobile” gives a developer a specific fix.

Review history records the actor, time, reason and evidence scope. After saving, confirm the visible state and history reflect your decision. Use **Refresh thread** if someone else edited the record; review their change before retrying.

## What an approval covers

An approval covers every visual change in one captured check/job, rather than a selected few pixels. Another route, viewport or run needs its own evidence and review. If the UI says the earlier decision is no longer valid, inspect the current evidence and record a new decision.

Approval does not clear health, accessibility, performance, capture errors or incomplete coverage. It also does not approve a release, promote a baseline, or edit a local accepted-changes file. Use [approved baselines](/dashboard/approved-baselines/) and [visual policies](/dashboard/visual-policies/) for those separate decisions.

## Verify the result

Open the check as the assigned reviewer, inspect both images, record a reasoned decision and refresh. Confirm the actor, reason, route, viewport and decision history. Reopen it from the inbox to verify you are reviewing the intended run.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Decision buttons are disabled | Enter a nonblank reason and check that reference and candidate were successfully compared. Failed captures can still be discussed and assigned. |
| Only read access is shown | Ask a maintainer for Reviewer access to this project. |
| A teammate is missing from the reviewer selector | Check their active account and project membership. |
| Another person changed the record | Refresh the thread, inspect the latest history and retry deliberately. |
| Approval did not make the release pass | Inspect independent failures, other checks, missing coverage and the selected visual policy. |

More help: [dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

[Promote reviewed evidence](/dashboard/approved-baselines/) when it should become a shared reference, or [evaluate a visual policy](/dashboard/visual-policies/) to check release requirements.
