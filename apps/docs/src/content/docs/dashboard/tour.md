---
title: "Tour of the dashboard"
description: "A screen-by-screen walk through the dashboard: navigation, Run history, project tests, reviews, baselines, policies, People & integrations, profile and Audit & recovery."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["apps/platform/client/main.tsx", "apps/platform/client/project-tests.tsx", "apps/platform/client/execution-progress.tsx", "apps/platform/client/reviews.tsx", "apps/platform/client/baselines.tsx", "apps/platform/client/policies.tsx", "apps/platform/client/settings.tsx", "apps/platform/client/users.tsx", "apps/platform/client/invitations.tsx", "apps/platform/client/operations.tsx", "apps/platform/client/profile.tsx", "apps/platform/client/auth.tsx"]
sidebar: {"order": 2}
---

This page walks through every screen in the dashboard, using the exact labels you see on it. For each area it explains what it shows, what you can do there and who can do it. Use it to find your way around, then follow the links for step-by-step guides.

If you have not started a dashboard yet, begin with [Start a local dashboard](/dashboard/local/). Words such as run, check and baseline are defined in the [glossary](/concepts/glossary/).

## The layout

Every page has the same frame.

**Left sidebar**

- **VisualGuard** logo: returns to Run history.
- **Workspace** card: says **Local evidence library** in local mode or **Team evidence library** in login mode.
- **QUALITY** links: **Run history**, **Review inbox**, **Approved baselines**, **Visual regression policy**, **People & integrations**, and **Audit & recovery** (signed-in workspace administrators only).
- **PROJECTS** list: every project you can see, with its stored run count. Choose a project to open its project section on Run history.
- Footer: **Local workspace** or **Team workspace**, and your name.

**Top bar**

- A breadcrumb such as **Workspace / Run history** shows where you are.
- On the right: **Local access** in local mode, or your name in login mode. **Profile** opens your profile. **Sign out** appears in login mode.

On a narrow screen, the sidebar is replaced by a row of the same links under the top bar.

## Sign-in screen (login mode only)

In login mode, you first see **Welcome to your workspace**.

- Enter **Email** and **Password**, then choose **Sign in**.
- If Google is configured, choose **Sign in with Google**. Another provider shows **Continue with company login**.
- On an invite-only workspace, the screen also says to ask your administrator for an invitation link.

Local mode has no sign-in screen. Details: [Enable dashboard login](/dashboard/login/) and [Configure and link Google sign-in](/dashboard/google-sign-in/).

## Run history

**Run history** is the home page. It lists every stored run you are allowed to see.

**What it shows**

- Three counters: **Projects** (in this workspace), **Stored runs** (all runs) and **Matching runs** (runs that match the active filters).
- A note, **Evidence comes first**: incomplete coverage stays visible, and a passing run is not a release approval.
- The **All runs** table with these columns: **Run / project**, **Result**, **Revision** (branch, commit, pull request and deployment), **Environment**, **Checks** (count and duration) and **Started**.
- 25 runs per page, with **Previous** and **Next**.

**What you can do**

- Search with **Search runs, routes, or revisions…**. It matches route, check name, viewport, branch or revision.
- Filter by **Project**, **Status** and **Environment**, then choose **Apply filters**. **Clear** removes all filters.
- Open **Revision, deployment & date filters** to filter by **Branch**, **Commit**, **Deployment**, **Pull request**, **From** and **Through**. Dates use UTC. Revision and environment filters must match exactly.
- Choose **↻ Refresh** to reload the list.
- Workspace administrators see **+ New project**. Enter a **Project name** and a **Project ID** (lowercase letters, numbers and hyphens), then choose **Create project**.

The **Status** filter offers: Incomplete, Error, Regression, Review, Accepted and Pass. See [Read results](/concepts/results/) for what each means.

An empty workspace shows **Your evidence library starts here** with an example `dashboard import` command.

## Project section

Choose a project in the sidebar, or filter Run history by one project. A **PROJECT** panel appears above the run list. It shows the project name, its project ID and its stored run count.

**Visual test**

The panel's **Visual test** area shows how tests run for this project and which saved configuration is current:

| Status text | Meaning |
| --- | --- |
| **Runs on this dashboard** | The dashboard host captures tests itself (built-in runner) |
| **Runner connected** | A private runner checked in during the last 30 seconds and will capture |
| **Runner offline** | No private runner is connected and the built-in runner is off. **Run test** is disabled |
| **Configuration v3** | The saved test profile is at version 3 |
| **Configure this project's test settings** | No profile has been saved yet |

**What everyone with access sees**

- **Saved test configuration**: the saved production URL, staging URL, routes, viewports and AI provider.
- The latest test's progress or result, with **View result** when a run was created.

**What Maintainers and administrators can also do**

- **Configure tests**: edit and choose **Save test configuration**. See [Configure tests per project](/dashboard/project-configuration/).
- **Run test**: start a test from the saved profile. The button reads **Requesting…**, then **Test in progress…** while a test is active. See [Run tests from the dashboard](/dashboard/run-tests/).
- **Connect a runner for this project** (or **Use a private runner instead** when the built-in runner is on): create a 30-day runner credential and copy the runner command. See [Connect a private runner](/dashboard/private-runners/).
- **Delete project**: permanently delete the project after typing its ID. See [Projects, names and identities](/dashboard/projects/).

**Progress while a test runs**

The progress box shows a title such as **Waiting for the runner…**, **Starting the browser…**, **Capturing screenshots…**, **Comparing and analyzing…**, **Uploading test results…** or **Saving the result link…**. It ends with **Test finished** or **Test could not finish**. A count such as **2 of 4 comparisons completed (50%)** shows finished route and viewport pairs. See [Understand execution progress](/dashboard/execution-progress/).

## Run detail

Open a run from Run history. The page is headed **SAVED RUN EVIDENCE** with the run name and status.

**What it shows**

- The run number, start time, duration, comparison mode and environment, plus branch, commit, pull request and deployment when supplied.
- An **Incomplete evidence** warning with reasons when the run did not cover everything it planned. Such a run cannot establish complete coverage.
- A result strip with counts for regression, review, error, accepted and pass.
- The **Checks** table: **Page / checkpoint**, **Viewport**, **Result**, **Evidence** (reference and candidate thumbnails) and **Explanation**. Use **Filter checks…** to narrow it. When a check compared against an approved baseline, its explanation names the set and version.
- **Visual regression policy**: choose **Assess this run** to check this run against the project's policy.
- **Team review**: discuss and decide on one check at a time.
- **Evidence identity & provenance** (collapsed): engine run ID, evidence digest, import time, engine and schema versions, artifact count, expected checks and source revision. **View saved evidence JSON ↗** opens the raw record.

**What you can do**

- Choose **Open comparison viewer ↗** to open the full read-only report, the same viewer the CLI produces. Choosing a route in the Checks table opens the viewer at that check.
- Open a reference or candidate image, or a **Reference DOM ↗** or **Candidate DOM ↗** snapshot, in a new tab.
- Maintainers and administrators see **Edit run name** and **Delete run**.

## Team review and Review inbox

**Team review** (on each run) lets you pick a **Check**, compare the reference and candidate, and read **Captured findings**. Reviewers can:

- **Assign a reviewer** with an optional **Deadline (UTC, optional)** and **Assignment note**, then **Save assignment**.
- Write in **Comment / decision reason** and choose **Post comment**, **Approve visual change**, **Request changes** or **Withdraw decision**.
- Use **Reply** on an entry, **Refresh thread** and **Link to this review**.

**Review inbox** (sidebar) lists checks that have review activity. Filter by **Project**, **Assignment** (**Assigned to me**, **Unassigned**, **Everyone**), **Decision** (**Needs attention**, **Awaiting a decision**, **Changes requested**, **Visual change approved**, **All decisions**) and **Overdue only**. A check enters the inbox only after someone comments, assigns or decides.

Viewers can read reviews. Reviewers, Maintainers and administrators can write. Details: [Review exact visual evidence](/dashboard/reviews/).

## Approved baselines

**Approved baselines** (sidebar) holds the team's approved screenshots in named sets such as `main`.

- Choose a **Project**, type a **Baseline set** and choose **Open set**.
- The set shows its current version and a table of **Check**, **Viewport**, **Rendering identity** and **Reference**.
- Maintainers see **Promote reviewed evidence** (or **Initialize approved baselines** for a new set). Choose a **Candidate run**, enter the **Landed revision**, a **Promotion reason** and confirm, then choose **Create version 1** or **Promote as new version**.
- **Version history** lists every version. Maintainers can choose **Restore v2** to create a new version from an older one.

Details: [Promote approved baselines](/dashboard/approved-baselines/).

## Visual regression policy

**Visual regression policy** (sidebar) defines what evidence a commit needs before it counts as ready.

- Choose a **Project**. Maintainers edit **Rollout mode**, **Approved baseline set**, **PR target branch**, **Evidence environment**, **Evidence valid for (hours)**, **GitHub repository (optional)**, **Required screenshot check IDs** and **Require reviewer approval for changed screenshots**, then choose **Save new policy version**.
- **Assess visual evidence**: pick an **Evidence run** or enter an **Exact candidate commit**, then choose **Assess current policy**. The result is Pending, Satisfied or Blocked, with reasons.
- **GitHub PR checks**: enter a **Pull request number** and choose **Reconcile GitHub check**.
- **Policy history** lists every saved version.

Viewers can read the policy and run assessments. Details: [Evaluate a visual policy](/dashboard/visual-policies/).

## People & integrations

**People & integrations** (sidebar, or **Profile** in the top bar) collects your account settings and project access. The sections you see depend on the mode and your role.

| Section | What it does | Who sees it |
| --- | --- | --- |
| **Your profile** | Shows your **Name**, **Email** and **Workspace role** (**Local owner**, **Workspace administrator** or **Workspace member**) | Everyone |
| **Your sign-in methods** | Shows whether Google is linked, with **Link Google account** | Login mode |
| **Invitations** | Create a one-time link for one person, one project and one role; **Cancel** or **Replace link** | Login mode, administrators |
| **Your password** | **Change password** for password accounts | Login mode |
| **Workspace accounts** | Search accounts, **Manage** a person, disable, restore, promote, demote, revoke sessions and reset passwords; **Create a password member account** | Login mode, administrators |
| **Project access** | Pick a project, **Edit project name & ID**, **Grant access** with a **Project role**, and **Remove** members | Maintainers of that project and administrators |
| **Upload credentials** | Create a named upload token (**Expires in days**, 1 to 90) and **Revoke** tokens. Runner credentials appear here too | Maintainers of that project and administrators |

A new upload token appears once under **Copy your upload token now**. Copy it before you choose **Dismiss**.

Details: [Invite people and manage permissions](/dashboard/people-and-permissions/), [Publish and retry saved evidence](/dashboard/publishing/) and [Configure and link Google sign-in](/dashboard/google-sign-in/).

## Invitation page

An invitation link opens **Join your team**. The invited person verifies their account (**Verify with Google**, a password sign-in, or **Verify existing account**), reviews the project and role, and chooses **Accept invitation**. Opening the link alone grants nothing. See [Invite people and manage permissions](/dashboard/people-and-permissions/).

## Audit & recovery

**Audit & recovery** appears only for signed-in workspace administrators in login mode.

- **Sign-in readiness**: whether **Account recovery storage** is supported, the **New account admission** mode (**Invitation required** or **Automatic provider account creation**), and counts of **Active administrators** and **Password administrators**. Warnings and shared emails appear here too.
- **Administrator recovery** (collapsed): the host-side steps and commands for restoring a locked-out password administrator.
- **Audit history**: up to 50 events per page, filtered by **Person**, **Action**, **From (UTC)** and **Through (UTC)**. Choose **Filter activity**, **Clear filters** or **View event details**.

Choose **Refresh operations** to reload. See [Operations and recovery](/deployment/operations-and-recovery/).

## Local mode and login mode at a glance

| Area | Local mode | Login mode |
| --- | --- | --- |
| Sign-in screen | None | Email and password, plus Google if configured |
| Your role | Local owner (an administrator) | Your account's workspace and project roles |
| Invitations, Workspace accounts, Your password, Your sign-in methods | Hidden | Shown to the right people |
| Audit & recovery | Hidden | Administrators only |
| Projects you see | All | Administrators see all; others see assigned projects |

## Which role sees what

| Area | Viewer | Reviewer | Maintainer | Administrator |
| --- | --- | --- | --- | --- |
| Run history, run detail, comparison viewer | Read | Read | Read, rename and delete runs | Same as Maintainer, in every project |
| **+ New project** | No | No | No | Yes |
| **Configure tests**, **Run test**, runner credential, **Delete project** | No | No | Yes | Yes |
| **Team review** and **Review inbox** | Read | Comment, assign and decide | Same as Reviewer | Same as Reviewer |
| **Approved baselines** | Read | Read | Promote and restore | Promote and restore |
| **Visual regression policy** | Read and assess | Read and assess | Edit and reconcile | Edit and reconcile |
| **Project access** and **Upload credentials** | No | No | Yes, for their projects | Yes |
| **Invitations**, **Workspace accounts**, **Audit & recovery** | No | No | No | Yes |

## Next steps

- [Start a local dashboard](/dashboard/local/): set up the screens above on your own computer.
- [Run tests from the dashboard](/dashboard/run-tests/): use **Configure tests** and **Run test** end to end.
- [Review exact visual evidence](/dashboard/reviews/): work through Team review and the Review inbox.
- [Invite people and manage permissions](/dashboard/people-and-permissions/): give your team the right roles.
