---
title: "Deploy the dashboard to Vercel"
description: "Follow the complete deploy the dashboard to vercel workflow with persistent storage, login and verification."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 4}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## Validation scope

These instructions are reviewed against the current scaffold/source and linked provider documentation. This documentation implementation did not deploy a live cloud service, configure real OAuth or restore a production database. Follow the verification checklist on your own isolated installation before production use. The documentation website itself is static; the dashboard hosting instructions below describe a separate application.

Both hosts require an **external persistent database**; SQLite under their ephemeral filesystem is not supported. A managed PostgreSQL service is the simplest shared example here. A transaction-capable MongoDB URI can be used instead with provider-appropriate network access. Each new database starts as a separate empty workspace; deployment does not migrate your local history.

Use the four settings `VISUALGUARD_DATABASE_URL`, `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_ADMIN_EMAIL`, `VISUALGUARD_ADMIN_PASSWORD`, plus explicit `VISUALGUARD_AUTH_MODE=login`. Keep them server-side, never `NEXT_PUBLIC_`/`VITE_`. Use an exact canonical HTTPS origin without a path/query. A generated provider domain is sufficient initially; custom domains are optional.



From the application root:

```sh
npx --no-install visualguard dashboard init --target vercel --out deploy/visualguard-vercel
cd deploy/visualguard-vercel
npm pkg set dependencies.visualguard=3.2.3
npm install
npm install --global vercel
vercel login
vercel link
```

Create a **separate dashboard project**, not your application's existing Vercel project. The generated folder pins the installed CLI version from npm; no tarball/source checkout is needed. Use **Other** framework, Node **22.x**, build `npm run build`, output `public` and the generated API/static rewrites.

Check `vercel.json` before deployment:

- The `3.1.0` source's scaffold omits `/reviews`; add `{ "source": "/reviews", "destination": "/index.html" }` to `rewrites` if absent.
- The published `3.2.0` scaffold omits `/policies`; later releases include the correction; inspect the generated configuration for your pinned release. Preserve routes for `/settings`, `/operations`, `/reviews`, `/baselines`, `/policies`, `/invite`, `/runs/:path*` and `/`. Updating the installed package does not update an existing deployment folder; regenerate into an empty directory and review the configuration, or add `{ "source": "/policies", "destination": "/index.html" }` if absent, then redeploy.
- Keep `/api/:path*` routed to the API function, not `index.html`. Invitation pages in newer releases also need the scaffold's no-referrer/no-store headers.

Create/connect a dedicated PostgreSQL resource through the [Vercel Marketplace](https://vercel.com/docs/marketplace-storage), or use your existing managed database. Set its actual URI as `VISUALGUARD_DATABASE_URL`; provider integration variable names can differ. Select nearby database/function regions and an appropriate pooled endpoint with provider-required TLS.

Enter each value privately at the CLI prompts, scoped to Production:

```sh
vercel env add VISUALGUARD_DATABASE_URL production
vercel env add VISUALGUARD_PUBLIC_URL production
vercel env add VISUALGUARD_ADMIN_EMAIL production
vercel env add VISUALGUARD_ADMIN_PASSWORD production
vercel env add VISUALGUARD_AUTH_MODE production
vercel --prod
```

Use the actual stable project origin, for example `https://my-app-visualguard.vercel.app`; enter `login` for auth mode. If the hostname is assigned only after deployment, update the public URL and redeploy before login. A local `.env` does not set production variables. [Vercel environments](https://vercel.com/docs/environment-variables), [deployment CLI](https://vercel.com/docs/cli/deploy).

Open the canonical URL, sign in, create a project/token and configure your application as in [the related setup guide](/dashboard/login/). Keep previews disabled or isolated with their own database/URL. To use a custom domain, add it in Vercel, follow its DNS instructions, then update the canonical URL and redeploy.

Vercel documents a 4.5 MB function request/response limit. VisualGuard chunks uploads/downloads; test a real large screenshot, manifest and baseline pull with the exact release. Direct unchunked large-artifact requests can be rejected. Test database connection capacity during cold starts/concurrency too: current PostgreSQL pools allow up to five connections per runtime instance. [Vercel limits](https://vercel.com/docs/functions/limitations).

## Check the generated package pin

The 3.2.3 artifact currently embeds CLI version 3.2.2. Its scaffold may therefore pin 3.2.2. The `npm pkg set` step above corrects the generated dependency to the intended tested 3.2.3 release before installation. Inspect the generated `package.json` and commit its deployment lockfile. [Read the artifact caveat](/releases/).

## Verify before using this installation

Open `/api/health`, sign in at the exact canonical HTTPS origin, refresh `/reviews`, `/baselines`, `/policies` and `/settings`, then publish real screenshots from a separate runner. Inspect every artifact and pull an approved baseline. Check database persistence after a new compute instance starts. Do not use a successful static page response as proof the API, credentials or storage work.

## Troubleshooting and next steps

Check deployment logs, literal/secret environment conflicts, canonical URL, network/TLS access and generated rewrites. Updating npm does not rewrite an existing deployment folder. Keep preview databases separate. Configure [native backups](/deployment/storage-and-backups/) and rehearse [upgrades](/deployment/upgrades/) before production changes.
