---
title: "Dashboard overview"
description: "What the VisualGuard dashboard is, how local and hosted setups differ, where data is stored, who can do what, and what it does not do."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/PRODUCT-FEATURES.md",
    "apps/platform/server/runtime.ts",
    "apps/platform/server/config.ts",
    "apps/platform/server/auth.ts",
    "apps/platform/client/main.tsx",
  ]
sidebar: { "order": 1 }
---

The VisualGuard dashboard is a web app that keeps your visual test results in one place. It stores every run by project, so your team can look back at history, discuss changes and approve them together. Read this page first to build a mental model, then follow the links to set it up.

## What the dashboard is

The command-line tool (CLI) captures screenshots, compares them and writes a **run** to a folder on your computer. A run is one test execution: its manifest, screenshots, findings and report. On its own, that folder stays on one machine.

The dashboard is a separate server that receives those runs and keeps them. You start it with `visualguard dashboard`. It is not started by `visualguard test`.

Think of it in three layers:

| Layer     | What it holds                                                       | Example                                               |
| --------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Workspace | One installation of the dashboard, with its own database and people | Your team's dashboard at `https://visual.example.com` |
| Project   | One application you test, with its own history, access and settings | `storefront`, `docs-site`                             |
| Run       | One stored test execution inside a project                          | "Run #12" comparing production and staging            |

There is one workspace per installation. There is no vendor-wide console across installations.

## How evidence gets into the dashboard

Evidence is the screenshots, page structure (DOM) snapshots and findings a run produced. There are four ways to add it:

| Way                                        | Who captures                           | Typical use                                                 | Guide                                                      |
| ------------------------------------------ | -------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `visualguard test PROJECT --dashboard URL` | Your computer or CI                    | Capture and publish in one command                          | [Publish and retry saved evidence](/dashboard/publishing/) |
| `visualguard dashboard publish RUN_DIR`    | Already captured                       | Upload a saved run again after a failure                    | [Publish and retry saved evidence](/dashboard/publishing/) |
| `visualguard dashboard import RUN_DIR`     | Already captured                       | Copy a saved run into a dashboard on the same machine       | [Start a local dashboard](/dashboard/local/)               |
| **Run test** button in the dashboard       | The dashboard host or a private runner | Start a test from the browser using a saved project profile | [Run tests from the dashboard](/dashboard/run-tests/)      |

:::note
When the project shows **Runs on this dashboard**, the dashboard can capture **Run test** itself using your sign-in. If host capture is unsupported or unavailable, connect a [private runner](/dashboard/private-runners/).
:::

## Local mode and login mode

The dashboard runs in one of two access modes. The mode decides who can open it and how people identify themselves.

|                                         | Local mode                                                | Login mode                                                                                         |
| --------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Who it is for                           | One developer on their own computer                       | A team, on a shared or hosted server                                                               |
| How you get in                          | Open the page. You are the **Local owner**                | Sign in with email and password, or Google                                                         |
| Where it listens                        | Only on this computer (`127.0.0.1`, `localhost` or `::1`) | Any address, with an exact public URL                                                              |
| Uploading from the CLI                  | No token needed                                           | Needs a project upload token                                                                       |
| Accounts, invitations, Audit & recovery | Not available                                             | Available                                                                                          |
| How it is chosen                        | Default when `VISUALGUARD_PUBLIC_URL` is not set          | `VISUALGUARD_AUTH_MODE=login` plus `VISUALGUARD_PUBLIC_URL`. Cloud Run and Vercel default to login |

Hosted login on a non-loopback address requires HTTPS. See [Enable dashboard login](/dashboard/login/).

## Where data is stored

The dashboard stores run metadata and screenshots in a database you choose. You select it with `VISUALGUARD_DATABASE_URL`. If that is not set, the dashboard also reads `DATABASE_URL`, so set `VISUALGUARD_DATABASE_URL=` (empty) to force SQLite when your app already has a `DATABASE_URL`.

| Storage          | When to use it                         | How to select it                                                                                                                            |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite (default) | Local trials and single-machine setups | Leave the database URL empty. Data goes to `.visualguard/platform/metadata.sqlite` under the folder you started from, or under `--data-dir` |
| PostgreSQL       | Hosted teams, Cloud SQL                | `VISUALGUARD_DATABASE_URL=postgresql://...`                                                                                                 |
| MongoDB          | Hosted teams that already run MongoDB  | `VISUALGUARD_DATABASE_URL=mongodb://...` or `mongodb+srv://...`                                                                             |

Cloud Run and Vercel refuse to start without a database URL, because their local disk does not persist. Some team features, such as invitations, account changes and approved baselines, need transactional storage: SQLite, PostgreSQL or a MongoDB replica set. See [Storage and backups](/deployment/storage-and-backups/).

The dashboard needs Node.js 22.12 or newer.

## Who can do what

In login mode, each person has a role per project. Workspace administrators can do everything in every project. In local mode, the Local owner is an administrator.

| Role                    | Can do                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Viewer                  | Open runs, reports, saved test settings, baselines and policies in assigned projects                                                                                       |
| Reviewer                | Everything a Viewer can, plus comment, assign reviewers and approve or reject visual changes                                                                               |
| Maintainer              | Everything a Reviewer can, plus configure and run tests, rename or delete runs and the project, manage project access and credentials, promote baselines and edit policies |
| Workspace administrator | Every project as a Maintainer, plus create projects, manage accounts and invitations, and open **Audit & recovery**                                                        |

Upload tokens and runner credentials are not people. They can only send evidence to their one project. See [Invite people and manage permissions](/dashboard/people-and-permissions/).

## What you can do in the dashboard

- Browse and filter **Run history** by project, status, environment, branch, commit, pull request, deployment and date.
- Open a run, inspect each check and open the full comparison viewer.
- Save a test profile per project and start a test with **Run test**, then watch its progress.
- Review checks one at a time in **Team review** and track work in the **Review inbox**.
- Promote reviewed evidence into **Approved baselines** and pull them into CI.
- Evaluate a **Visual regression policy** for an exact commit, and optionally post a GitHub check.
- Rename projects and runs. Old project IDs keep working as aliases.
- Delete runs and projects after typing the ID to confirm.

For a screen-by-screen walkthrough, read the [Tour of the dashboard](/dashboard/tour/).

## What the dashboard does not do

- It does not schedule tests. Every test starts from a person, a CLI command or CI.
- It does not send email. Invitation links are copied and shared by hand.
- It does not store application passwords, cookies, API keys or capture hooks in project settings. Those stay on the machine that captures.
- It does not treat a passing run as a release approval. Run status describes the captured evidence only.
- It does not verify Git history. When you promote a baseline, you confirm the change landed.
- It does not merge pull requests or configure branch protection. GitHub checks are reports you choose to require.
- It does not delete old runs on a timer. There is no automatic time-based retention.
- It does not change your offline CLI workflow. `visualguard.config.ts` keeps working on its own.

## Uploads and deletion, briefly

Uploads travel in 1 MiB checksummed chunks and can resume for up to 24 hours. A run is saved only after all its required files arrive and validate. Your original local run folder stays where it was.

Deleting a run or project is permanent. Screenshots shared with other runs or with approved baselines are kept. A deleted project's ID stays reserved, so old credentials can never point at a new project. Deletion does not remove copies on runner machines or in your own backups.

## Next steps

- [Tour of the dashboard](/dashboard/tour/): see every screen and what you can do there.
- [Start a local dashboard](/dashboard/local/): try it on your computer with SQLite in a few minutes.
- [Run tests from the dashboard](/dashboard/run-tests/): save a test profile and press **Run test**.
- [Enable dashboard login](/dashboard/login/): move from local mode to a team setup.
