---
title: "Use PostgreSQL"
description: "Set up a persistent PostgreSQL dashboard and verify project evidence after restart."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 2}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

**Use this section when:** VisualGuard is installed in another application and you want its dashboard stored in PostgreSQL. Complete section 2 first; work from the application root throughout, with the application environments still running.

Use a dedicated database with a real application user. Stop any dashboard already on port 4400. Changing the database URL selects another workspace; it does not migrate SQLite/MongoDB history automatically. PostgreSQL and MongoDB below are alternative setup paths, not dependencies you must install together.

If you already have PostgreSQL, copy its real URI and required TLS settings. Otherwise, with Docker installed, create a disposable local development instance:

```sh
docker run --detach --name visualguard-postgres-local \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=visualguard \
  --env POSTGRES_PASSWORD=visualguard_local_only \
  --env POSTGRES_DB=visualguard \
  --volume visualguard_pg_local:/var/lib/postgresql/data \
  postgres:17

docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard
```

Wait until it reports accepting connections. These credentials are only for the loopback development example; use distinct strong credentials and supported network/TLS controls in a shared deployment. The named volume retains data when the container is stopped/restarted.

Update `.env.visualguard`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard
```

Start the dashboard and create its first project in a second terminal:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard
```

```sh
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
```

In the test terminal, run the full PostgreSQL-backed workflow:

```sh
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

Open the stored run and its screenshots, restart the dashboard with the same `.env.visualguard`, and confirm its history remains. For AI plus PostgreSQL, replace `--no-ai` with `--provider gemini` after section 3's key setup, or use its Ollama provider/model flags. This local-owner configuration needs no upload token; login mode does. The app role must be able to create/update `vg_*` tables/indexes; an existing restricted role may need schema grants from its database administrator. Do not copy a literal `USER` placeholder or rely on your laptop's username being a database role.

## Verify the setup

Create a project/run, stop and restart with the same actual connection settings, and confirm history persists. Verify the selected database, not just that the server answers health requests.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/deployment/storage-and-backups/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
