---
title: "Choose your setup"
description: "Pick the smallest VisualGuard setup for local tests, a dashboard, a shared team install or source development."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "packages/visualguard/src/cli/commands/dashboard.ts",
    "packages/visualguard/src/sdk.ts",
  ]
sidebar: { "order": 1 }
---

VisualGuard works at several sizes. You can run it as a single command on your laptop, or as a shared dashboard for a whole team. This page helps you pick the smallest setup that does what you need today. You can add more later without starting again.

## Before you start

- Know what you want to compare: two running versions of your app, or one version against saved screenshots. [Comparison modes](/concepts/comparison-modes/) explains the options.
- Check the [requirements](/start/requirements/) for your choice.

## Pick a setup

| You want                                                  | Database                                                           | Login or token                                                   | Start here                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Visual tests and HTML reports only                        | None                                                               | None                                                             | [Run your first visual test](/start/quickstart/)      |
| Visual comparisons from a Node.js script or custom CI job | None                                                               | Only credentials required by the target app or optional services | [SDK for scripts and CI](/guides/programmatic-api/)   |
| A dashboard with history on your own computer             | A SQLite file, created for you                                     | None in the default local mode                                   | [Start a local dashboard](/dashboard/local/)          |
| A local dashboard backed by PostgreSQL                    | A dedicated PostgreSQL database                                    | Optional login; a token is needed once login is on               | [Use PostgreSQL](/deployment/postgresql/)             |
| A local dashboard backed by MongoDB                       | A dedicated MongoDB database; a replica set for full team features | Same as PostgreSQL                                               | [Use MongoDB](/deployment/mongodb/)                   |
| A shared team dashboard on Cloud Run or Vercel            | External PostgreSQL, or MongoDB that supports transactions         | Login, plus project upload tokens for publishing                 | [Choose dashboard hosting](/deployment/overview/)     |
| To change VisualGuard itself                              | None for tests; SQLite for the local dashboard                     | None locally                                                     | [Run from source locally](/contributing/local-setup/) |

### What each setup gives you

- **Tests only.** You run `visualguard test`. Results are saved under `.visualguard/runs/` with an HTML report. Nothing else is installed or hosted. This is the right start for almost everyone.
- **SDK.** Your Node.js script awaits `runVisualGuard()` using a config file or inline options. It receives structured results and HTML/JUnit paths, then decides the process exit status. Start with the [complete SDK guide](/guides/programmatic-api/), including section capture and a GitHub Actions example.
- **Local dashboard.** You run `visualguard dashboard`. It opens at `http://127.0.0.1:4400` and keeps run history in an embedded SQLite file. You do not need to install PostgreSQL or MongoDB.
- **Shared dashboard.** You host one dashboard for your team. People sign in, see the same projects and record [reviews](/dashboard/reviews/). Tests still run on a computer or CI worker, or on the dashboard host when your release supports it (see below).

:::tip
"No database" is literally true for standalone tests. The dashboard's zero-setup option uses an embedded SQLite file, so you still do not install a database service.
:::

### One install per team

Use one hosted dashboard per organisation or team. That one install can hold many projects and many people, each with their own permissions. Each person does not need their own server.

### Where tests run

The browser always runs somewhere you control:

- **Your computer or CI worker** runs `visualguard test`. This works in every release.
- **The dashboard host** runs a test when someone presses **Run test**. This needs a dashboard with built-in capture enabled and Chromium on the host. Use a private runner on Vercel.
- **A private runner** that you connect to the dashboard. Use this when host capture is unavailable or cannot reach your app.

See [dashboard tests and private runners](/dashboard/private-runners/) for details.

## Example: a small team growing step by step

A three-person team builds a storefront. Week one, a developer runs the [quickstart](/start/quickstart/) against production and a local branch. Week two, they add the checkout routes and [stable capture settings](/guides/stable-captures/). Week three, they add the [GitHub Action](/ci/github-actions/) so every pull request gets a report. A month later, the designer wants to approve changes in a browser, so they [deploy a shared dashboard](/deployment/overview/) with login and PostgreSQL.

## Recommended order

1. Run [your first comparison](/start/quickstart/) without AI or a dashboard.
2. Add the [routes that matter](/guides/routes/) and [stable capture settings](/guides/stable-captures/).
3. Add [CI](/ci/overview/) so every pull request gets the same evidence.
4. Add a [local dashboard](/dashboard/local/) when you want history and shared review.
5. Add [login](/dashboard/login/), an external database and [hosting](/deployment/overview/) when a team needs it.

Add [AI analysis](/guides/ai-gemini/) at any step. It is always optional.

## Troubleshooting

| Problem                                           | Fix                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| You are not sure whether you need a dashboard     | Start without one. You can [import saved runs](/dashboard/local/) into a dashboard later.                                      |
| The dashboard picked up your app's `DATABASE_URL` | Set `VISUALGUARD_DATABASE_URL=` (empty) in the dashboard's env file to force SQLite. See [local dashboard](/dashboard/local/). |
| **Run test** does not start a capture             | Check the project's execution status. If host capture is unavailable, connect a [private runner](/dashboard/private-runners/). |
| Team members each started their own dashboard     | Host one shared dashboard and [invite people](/dashboard/people-and-permissions/) instead.                                     |

More help: [troubleshooting](/troubleshooting/).

## Next steps

- [Find what you need](/start/common-tasks/): jump straight to the command or page for your task.
- [Requirements](/start/requirements/): check Node.js and browsers.
- [Run your first visual test](/start/quickstart/): the fastest way to see VisualGuard work.
- [Release availability](/releases/): see what the published package and the source checkout each include.
