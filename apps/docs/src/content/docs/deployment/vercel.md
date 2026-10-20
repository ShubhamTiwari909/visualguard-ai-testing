---
title: "Deploy the dashboard to Vercel"
description: "Generate a Vercel project, connect an external database, set the public URL and verify sign-in, uploads and page refreshes."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/scaffold.ts", "apps/platform/server/runtime.ts", "apps/platform/server/built-in-runner.ts", "apps/platform/server/database.ts"]
sidebar: {"order": 4}
---

This tutorial deploys the VisualGuard dashboard to Vercel as its own project. You will generate a small deployment folder, connect an external database, set the environment variables, deploy, and check that everything works. Vercel serves the UI as static files and handles the API in one serverless function.

## Before you start

- Run [a local dashboard](/dashboard/local/) once.
- Have a PostgreSQL or MongoDB database that Vercel can reach. See [PostgreSQL](/deployment/postgresql/) or [MongoDB](/deployment/mongodb/). SQLite does not work on Vercel.
- Have a Vercel account and permission to create a project.
- Plan who runs browsers: Vercel cannot run **Run test** itself, so you also need a [private runner](/dashboard/private-runners/) or CI publishing.
- Run commands from your app's root folder. Examples use macOS/Linux shells; on Windows use WSL.

:::note
This path is reviewed against the source and Vercel's documentation. It has not been certified with a live Vercel deployment. Run the verification steps on an isolated project before production use.
:::

## 1. Generate the deployment folder

```bash
npx --no-install visualguard dashboard init --target vercel --out deploy/visualguard-vercel
cd deploy/visualguard-vercel
```

You should see the full path of the new folder. It must be empty or not exist yet; `init` never overwrites files. It contains:

| File | Purpose |
| --- | --- |
| `package.json` | Depends only on `visualguard`. `build` copies the prebuilt UI into `public/`. |
| `api/dashboard.mjs` | The serverless function that handles every `/api/...` request. |
| `vercel.json` | Build settings, page rewrites, a 300-second function limit and private headers for `/invite`. |
| `.env.example` | The variables you must set. Do not put real secrets here. |
| `.gitignore` | Keeps `node_modules/`, `.env*`, `.vercel/` and `public/` out of Git. |

## 2. Pin the package version

Inspect the generated dependency before installing. Resolve the current release and save its exact version in this deployment folder:

```bash
npm install --save-exact visualguard@latest
```

Run `npm ls visualguard --depth=0` and confirm `package.json` records the intended resolved release. Commit this folder with its `package-lock.json`. See [release availability](/releases/).

## 3. Check the page rewrites

Open `vercel.json`. The `rewrites` list should send every dashboard page to `/index.html` and every API call to the function:

```json
{ "source": "/api/:path*", "destination": "/api/dashboard?__vg_path=:path*" },
{ "source": "/runs/:path*", "destination": "/index.html" },
{ "source": "/settings", "destination": "/index.html" },
{ "source": "/operations", "destination": "/index.html" },
{ "source": "/reviews", "destination": "/index.html" },
{ "source": "/baselines", "destination": "/index.html" },
{ "source": "/policies", "destination": "/index.html" },
{ "source": "/invite", "destination": "/index.html" },
{ "source": "/", "destination": "/index.html" }
```

Older scaffolds miss some pages. The 3.1.0 scaffold has no `/reviews` rule and the published 3.2.0 scaffold has no `/policies` rule. Add any missing line. Keep `/api/:path*` pointed at the function, never at `index.html`. Updating the npm package never changes a folder you already generated; regenerate into a new empty folder and compare.

## 4. Create the Vercel project

Create a **new, separate** Vercel project for the dashboard. Do not deploy it inside your app's existing project.

```bash
npm install --global vercel
vercel login
vercel link
```

When `vercel link` asks, create a new project. In the project settings, check:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Node.js version | 22.x |
| Build command | `npm run build` |
| Output directory | `public` |

`vercel.json` already sets the build command and output directory.

## 5. Connect the database

Create a dedicated database, or connect one through the [Vercel Marketplace](https://vercel.com/docs/marketplace-storage). Copy its connection URL. Marketplace integrations may add variables with other names; VisualGuard reads only `VISUALGUARD_DATABASE_URL` (or `DATABASE_URL`).

Pick a database region close to your function region. For PostgreSQL, prefer the provider's **pooled** connection URL with its required TLS options. Each function instance opens up to five connections, and Vercel can start many instances at once.

## 6. Add the environment variables

Add each value for Production. The CLI prompts for the value, so it does not end up in your shell history.

```bash
vercel env add VISUALGUARD_DATABASE_URL production
vercel env add VISUALGUARD_PUBLIC_URL production
vercel env add VISUALGUARD_AUTH_MODE production
vercel env add VISUALGUARD_ADMIN_EMAIL production
vercel env add VISUALGUARD_ADMIN_PASSWORD production
vercel env add VISUALGUARD_USER_ADMISSION production
```

| Variable | What to enter |
| --- | --- |
| `VISUALGUARD_DATABASE_URL` | Your database URL. |
| `VISUALGUARD_PUBLIC_URL` | The project's stable HTTPS origin, such as `https://my-team-visualguard.vercel.app`. No path. |
| `VISUALGUARD_AUTH_MODE` | `login` |
| `VISUALGUARD_ADMIN_EMAIL` | The first administrator's email. |
| `VISUALGUARD_ADMIN_PASSWORD` | A unique password of 12 to 256 characters. |
| `VISUALGUARD_USER_ADMISSION` | `invite` for a new workspace. |

A local `.env` file does not set production variables. See [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 7. Deploy

```bash
vercel --prod
```

You should see a Production URL at the end of the output. Open `https://YOUR_PROJECT.vercel.app/api/health`. It should return `{"status":"ok"}`.

## 8. Set the final public URL

If the stable hostname differs from what you entered in step 6, update it and redeploy:

```bash
vercel env rm VISUALGUARD_PUBLIC_URL production
vercel env add VISUALGUARD_PUBLIC_URL production
vercel --prod
```

Sign-in works only at the exact origin in `VISUALGUARD_PUBLIC_URL`. For a custom domain, add it in Vercel, follow its DNS steps, then set the public URL to the new domain and redeploy.

## 9. Sign in and connect your app

Open the public URL and sign in with the admin email and password. Then follow [login mode](/dashboard/login/) to create a project and an upload token, and point CI at the dashboard.

## 10. Choose who runs Run test

A Vercel function stops when its response ends, so it cannot keep a browser running. The built-in runner is therefore off on Vercel. To use **Run test** from the dashboard, connect a [private runner](/dashboard/private-runners/) on a machine that can reach your app. Only set `VISUALGUARD_BUILT_IN_RUNNER=on` on a host that can keep a browser alive; Vercel is not one.

A private runner is also the fallback for dashboards that do not offer host capture. CI runs that publish with `visualguard test <project> --dashboard <url>` work without any runner.

## Limits to test

- Vercel limits function requests and responses to 4.5 MB. VisualGuard splits uploads and downloads into chunks, but test a real large screenshot, run and baseline pull with your exact release. See [Vercel limits](https://vercel.com/docs/functions/limitations).
- The function may run for up to 300 seconds.
- Cold starts and many parallel instances can exhaust database connections. Test with realistic CI concurrency.
- Keep preview deployments off, or give them their own URL and database. A preview must never share production's database.

## Example: a design team on Vercel

A design team already hosts its marketing site on Vercel. They create `marketing-visualguard` as a separate Vercel project, add a PostgreSQL database from the Marketplace, and deploy. Their GitHub workflow publishes each PR's run with an upload token. A small always-on VM in their office runs `visualguard dashboard runner` so designers can press **Run test** for the VPN-only staging site.

## Verify the deployment

1. `https://YOUR_HOST/api/health` returns `{"status":"ok"}`.
2. You can sign in at the exact public URL.
3. Refresh `/reviews`, `/baselines`, `/policies` and `/settings` directly. Each loads the dashboard, not a 404.
4. Publish a real run from CI. Open it and view its screenshots.
5. Pull an approved baseline with `visualguard dashboard baseline pull`.
6. Redeploy, then confirm the run is still there.

A static page loading does not prove the API, credentials or database work. Check each step.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Dashboard unavailable; check deployment configuration" (503) | Open the function logs. Usually the database URL is missing or wrong. |
| "Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data" | Add `VISUALGUARD_DATABASE_URL` for Production and redeploy. |
| Refreshing a page gives 404 | Add the missing rewrite in `vercel.json` and redeploy. |
| "Hosted login requires HTTPS" or "Hosted login requires VISUALGUARD_PUBLIC_URL" | Set `VISUALGUARD_PUBLIC_URL` to the exact `https://` origin. |
| Sign-in fails on a deployment-specific URL | Open the dashboard at the exact `VISUALGUARD_PUBLIC_URL`, not a per-deployment `*.vercel.app` address. |
| Run test never starts | Connect a private runner. Vercel cannot run the built-in runner. |
| Large uploads fail | Publish with the `visualguard` CLI, which uploads in chunks. Direct API requests over 4.5 MB are rejected by Vercel. |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Connect a private runner](/dashboard/private-runners/): make **Run test** work.
- [Set up backups](/deployment/storage-and-backups/): before you store real evidence.
- [Plan upgrades](/deployment/upgrades/): keep the folder and runners in step.
