---
title: "Choose your setup"
description: "Choose the smallest VisualGuard setup for local tests, team review or source development."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 1}
---

| You want                                 | Database requirement                                           | Login / token                                      |
| ---------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| Visual tests and HTML reports only       | None                                                           | None                                               |
| Local dashboard/history on your computer | SQLite created automatically; no database service              | None in default loopback local mode                |
| Local dashboard with PostgreSQL          | Dedicated PostgreSQL database                                  | Optional login; token needed when login is enabled |
| Local dashboard with MongoDB             | Dedicated MongoDB database; replica set for full team features | Same as PostgreSQL                                 |
| Shared dashboard on Vercel/Cloud Run     | External PostgreSQL or transaction-capable MongoDB             | Login and project upload tokens                    |

“Without database” applies literally to standalone visual tests. The dashboard's zero-setup option is an embedded SQLite file. You do not have to install PostgreSQL or MongoDB to use the product locally.

Use one hosted installation per customer organization/team. That instance can contain multiple projects/users with separate permissions; each person does not need their own server.



## Recommended order

1. Run [your first comparison](/start/quickstart/) without AI or a dashboard.
2. Add [stable capture settings](/guides/stable-captures/) and the routes that matter.
3. Add [CI](/ci/overview/) for repeatable pull-request evidence.
4. Add a [local dashboard](/dashboard/local/) when you need history and shared review.
5. Add [login](/dashboard/login/), a persistent external database and [hosting](/deployment/overview/) for a team.

[Source contributors start here](/contributing/local-setup/). Current npm and source differences appear in [release availability](/releases/).
