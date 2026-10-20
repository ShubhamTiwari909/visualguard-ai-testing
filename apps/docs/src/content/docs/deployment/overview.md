---
title: "Choose dashboard hosting"
description: "Pick a database, a host and who runs the browsers before you deploy a shared VisualGuard dashboard."
audience: "operator"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/config.ts", "apps/platform/server/runtime.ts", "apps/platform/server/scaffold.ts", "apps/platform/server/built-in-runner.ts", "apps/platform/server/auth.ts"]
sidebar: {"order": 1}
---

The VisualGuard dashboard is a separate web app that stores runs, screenshots, reviews and baselines for a team. This page helps you make three choices before you deploy it: which database, which host, and which machine runs the browsers. Each choice links to a step-by-step guide.

## Before you start

- Run [a local dashboard](/dashboard/local/) once, so you know what you are deploying.
- Read [publishing](/dashboard/publishing/) to see how CI sends runs to a dashboard.
- Make sure you can manage the cloud project, database, secrets and domain for the deployment.

:::note
The hosted and external-database paths on these pages are reviewed against the source and the providers' documentation. They have not been certified with a live cloud, Google sign-in, PostgreSQL or MongoDB deployment. Run each page's verification steps on your own isolated install before production use.
:::

## Choice 1: the database

The dashboard picks its database from `VISUALGUARD_DATABASE_URL` (or `DATABASE_URL` if that is unset). It stores **everything** there: accounts, runs, reviews, baselines, policies, and the screenshot and DOM files themselves.

| Database | URL | Good for | Limits |
| --- | --- | --- | --- |
| SQLite (default) | Leave the URL empty | One computer, local mode, trying things out | Not supported on Vercel or Cloud Run, because their disks are temporary. |
| [PostgreSQL](/deployment/postgresql/) | `postgresql://` or `postgres://` | Most shared deployments; managed services are easy to find | You manage capacity and backups. |
| [MongoDB](/deployment/mongodb/) | `mongodb://` or `mongodb+srv://` | Teams already on MongoDB or Atlas | Needs a replica set or sharded cluster for the full team workflow. |

Any other URL scheme stops startup with "Database URL must use postgresql://, postgres://, mongodb:// or mongodb+srv://". A new database is a new, empty workspace. Switching does not copy history from your local SQLite; see [backups](/deployment/storage-and-backups/) to move evidence.

## Choice 2: the host

| Host | How it runs | Guide |
| --- | --- | --- |
| Vercel | Static UI plus one serverless API function. | [Deploy to Vercel](/deployment/vercel/) |
| Google Cloud Run | One container built from a generated Dockerfile. | [Deploy to Cloud Run](/deployment/cloud-run/), plus [Cloud SQL](/deployment/cloud-sql/) for Google's PostgreSQL |
| Your own server or Docker | `visualguard dashboard` as a long-running Node process. | Use the Cloud Run Dockerfile, or run the command under a process manager. |

`visualguard dashboard init --target vercel` or `--target cloud-run` generates a small deployment folder. It needs no React, Vite or VisualGuard source code. On your own server, run:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard --host 0.0.0.0 --port 4400
```

Put an HTTPS reverse proxy in front of it. Login mode refuses a plain `http://` public URL unless the host is `localhost`, `127.0.0.1` or `[::1]`.

## Choice 3: who runs the browsers

The **Run test** button in the dashboard needs a machine with a browser that can reach your app. CI runs are separate: CI captures on its own runners and publishes the results.

| Option | Where captures run | Works on |
| --- | --- | --- |
| Built-in runner | The dashboard server, using the signed-in user's authorization. No runner token. | Cloud Run (the generated image installs Chromium) and your own server. Off by default on Vercel. |
| [Private runner](/dashboard/private-runners/) | A machine you connect with `visualguard dashboard runner`. Takes priority when connected. | Any host. Required on Vercel, and when the dashboard cannot reach your app (for example a VPN-only staging site). |

:::caution
Check the installed dashboard and generated image before relying on host capture. The project should show **Runs on this dashboard**, and the host must include Chromium. If that capability is absent, upgrade or use a connected private runner.
:::

`VISUALGUARD_BUILT_IN_RUNNER=off` turns the built-in runner off; `on` turns it on, including on Vercel (only do that on a host that can keep a browser running). `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` limits how many built-in tests run at once (default `1`).

## Settings every hosted dashboard needs

| Variable | Value | Notes |
| --- | --- | --- |
| `VISUALGUARD_DATABASE_URL` | Your database URL | Required on Vercel and Cloud Run. Startup fails with "Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data" otherwise. |
| `VISUALGUARD_PUBLIC_URL` | The exact HTTPS origin, such as `https://visualguard.example.com` | No path, query or trailing route. Required for login mode. |
| `VISUALGUARD_AUTH_MODE` | `login` | `local` only works on loopback. |
| `VISUALGUARD_ADMIN_EMAIL` | The first administrator's email | Used once, to create the first account. |
| `VISUALGUARD_ADMIN_PASSWORD` | 12 to 256 characters | Changing it later does not reset an existing account. |
| `VISUALGUARD_USER_ADMISSION` | `invite` or `legacy` | New workspaces default to `invite`. Existing workspaces with users must set it before upgrading. |

Keep all of them server-side. Never prefix them with `NEXT_PUBLIC_` or `VITE_`, or they may end up in browser code. A host-generated domain is fine to start; a custom domain is optional. Add [Google sign-in](/dashboard/google-sign-in/) later if you want it.

## Example: a small team's choice

A team of eight already uses Google Cloud and wants **Run test** to work without extra machines. They choose:

- **Database:** Cloud SQL for PostgreSQL, with automatic backups.
- **Host:** Cloud Run, one always-on instance with 2 GiB of memory.
- **Browsers:** the built-in runner where supported, plus a private runner for their VPN-only admin app.

They follow [Cloud Run](/deployment/cloud-run/), then [Cloud SQL](/deployment/cloud-sql/), then [backups](/deployment/storage-and-backups/).

## Check a new deployment

Whatever you choose, confirm these before you invite the team:

1. `https://YOUR_HOST/api/health` returns `{"status":"ok"}`. This also proves the database answers.
2. You can sign in at the exact public URL.
3. Refreshing `/reviews`, `/baselines`, `/policies` and `/settings` loads the page, not a 404.
4. A real run published from CI shows its screenshots.
5. After a restart or a new instance, the run is still there.
6. You can pull an approved baseline, and restore a backup into a separate database.

## Next steps

- [Use PostgreSQL](/deployment/postgresql/): the simplest shared database.
- [Deploy to Cloud Run](/deployment/cloud-run/): a container host that can run tests itself.
- [Deploy to Vercel](/deployment/vercel/): a serverless host with a private runner.
- [Store evidence and back it up](/deployment/storage-and-backups/): plan recovery before you need it.
