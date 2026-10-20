---
title: "Use PostgreSQL"
description: "Create a PostgreSQL database and user, point the dashboard at it, and confirm runs survive a restart."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/config.ts", "apps/platform/server/database.ts", "apps/platform/.env.example", ".github/workflows/ci.yml"]
sidebar: {"order": 2}
---

This tutorial moves the dashboard from its default SQLite file to PostgreSQL. You will create a database and user, write the connection URL, start the dashboard, and prove that runs survive a restart. Use it before a [Vercel](/deployment/vercel/) or [Cloud Run](/deployment/cloud-run/) deployment, or whenever several people share one dashboard.

## Before you start

- Finish [the quickstart](/start/quickstart/) and [the local dashboard](/dashboard/local/). Keep your app's reference and candidate environments running.
- Pick one PostgreSQL source: Docker on your computer (step 1A), or a hosted service (step 1B).
- Stop any dashboard already running on port 4400.
- Run commands from your app's root folder. Examples use macOS/Linux shells; on Windows use WSL.

:::note
The PostgreSQL path is reviewed against the source and runs in the project's own CI tests against PostgreSQL 17. It has not been certified on a live hosted PostgreSQL service. Check your provider's limits before production use.
:::

## 1A. Start PostgreSQL locally with Docker

Use this for development on one computer. It needs [Docker](https://docs.docker.com/get-docker/).

```bash
docker run --detach --name visualguard-postgres-local \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=visualguard \
  --env POSTGRES_PASSWORD=visualguard_local_only \
  --env POSTGRES_DB=visualguard \
  --volume visualguard_pg_local:/var/lib/postgresql/data \
  postgres:17

docker exec visualguard-postgres-local pg_isready -U visualguard -d visualguard
```

You should see `/var/run/postgresql:5432 - accepting connections`. If it says `no response`, wait a few seconds and run `pg_isready` again.

This creates the `visualguard` user and database for you. Port `5433` avoids clashing with a PostgreSQL you may already run on `5432`. The named volume `visualguard_pg_local` keeps your data when the container stops. These credentials are for this loopback example only. Skip to step 2.

## 1B. Create a database on a hosted service

Use this for a shared or production dashboard. Any managed PostgreSQL works, for example from your cloud provider or the [Vercel Marketplace](https://vercel.com/docs/marketplace-storage). On Google Cloud, follow [Cloud SQL](/deployment/cloud-sql/) instead.

Create a dedicated database and a dedicated login for VisualGuard. Connect with your provider's admin user (for example with `psql` or the provider's SQL console) and run:

```sql
CREATE ROLE visualguard LOGIN PASSWORD 'replace-with-a-long-unique-password';
CREATE DATABASE visualguard OWNER visualguard;
```

Making `visualguard` the owner lets it create its own tables. You do not need to create any tables yourself.

If you must use an existing database owned by someone else, ask its administrator to let the role create tables in the schema:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO visualguard;
```

Then allow the dashboard's network address to connect. Most providers call this **allowed IPs**, **authorized networks** or **firewall rules**. Do not open the database to every address (`0.0.0.0/0`) unless the provider requires TLS and strong passwords and you accept the risk.

## 2. Write the connection URL

The URL has this shape:

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?OPTIONS
```

| Part | Local Docker example | Hosted example |
| --- | --- | --- |
| `USER` | `visualguard` | `visualguard` |
| `PASSWORD` | `visualguard_local_only` | Your password, URL-encoded |
| `HOST` | `127.0.0.1` | Your provider's hostname |
| `PORT` | `5433` | Usually `5432` (can be left out) |
| `DATABASE` | `visualguard` | `visualguard` |
| `OPTIONS` | none | TLS options from your provider, often `sslmode=require` |

URL-encode special characters in the user and password only, for example `@` as `%40` and `/` as `%2F`. Do not encode the whole URL. Use your provider's exact TLS settings; many reject connections without TLS. Replace every placeholder with a real value. A literal `USER`, or your laptop's username, is not a database role.

Both `postgresql://` and `postgres://` work.

## 3. Save the dashboard settings

Create `.env.visualguard` in your app's root folder and add it to `.gitignore`:

```dotenv
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
VISUALGUARD_DATABASE_URL=postgresql://visualguard:visualguard_local_only@127.0.0.1:5433/visualguard
```

For a hosted database, use your hosted URL. Local mode trusts this computer and needs no password or upload token. For a shared, signed-in dashboard, see [login mode](/dashboard/login/).

The dashboard reads this file only when you pass `--env-file`. Values already exported in your shell win over the file, so run `unset VISUALGUARD_DATABASE_URL DATABASE_URL` first if you exported an old URL.

## 4. Start the dashboard

In terminal A:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. On first start, the dashboard creates its tables: `vg_projects`, `vg_runs`, `vg_jobs`, `vg_state`, `vg_objects`, `vg_object_chunks` and `vg_project_tombstones`. Leave this terminal running.

The dashboard opens up to five connections per running instance and waits up to 10 seconds for each new connection.

## 5. Create a project and publish a run

In terminal B, with your app's environments still running:

```bash
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The first command creates the project. The second captures your app and uploads the run, screenshots included, into PostgreSQL. The test machine only needs the dashboard URL, never the database password. For AI explanations, replace `--no-ai` with `--provider gemini` after [Gemini setup](/guides/ai-gemini/), or use the [Ollama](/guides/ai-ollama/) flags.

## Verify the data is in PostgreSQL

1. Open `http://127.0.0.1:4400`. Open the run and click a screenshot.
2. Ask the database directly. For the Docker example:

   ```bash
   docker exec visualguard-postgres-local psql -U visualguard -d visualguard \
     -c "SELECT count(*) FROM vg_runs;" -c "SELECT count(*) FROM vg_objects;"
   ```

   Both counts should be at least `1`. For a hosted database, run the same two queries in your provider's SQL console.
3. Stop the dashboard with Ctrl+C. Start it again with the same command.
4. Open the run again. It should still be there with its screenshots.

A health check alone is not enough. Make sure the run is in the database you meant to use.

## Example: switching a team from SQLite

A team has used local SQLite for a month and now wants a shared dashboard. They:

1. Export their evidence: `npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite export ./team-evidence.vgbackup.gz`.
2. Create a hosted database as in step 1B and point `.env.visualguard` at it.
3. Restore into it: `npx --no-install visualguard dashboard --env-file .env.visualguard restore ./team-evidence.vgbackup.gz`.

Accounts are not part of the export, so they create users again. See [backups](/deployment/storage-and-backups/).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ECONNREFUSED` | The database is not running or the port is wrong. For Docker, run `docker ps` and use port `5433`. |
| `password authentication failed for user` | The user or password is wrong, or a special character is not URL-encoded. |
| `permission denied for schema public` | Make the role the database owner, or grant `USAGE, CREATE ON SCHEMA public`. |
| `database "visualguard" does not exist` | Create it, or fix the name after the last `/` in the URL. |
| `timeout exceeded when trying to connect` | Your address is not allowed by the provider's firewall, or TLS settings are wrong. |
| `Database URL must use postgresql://, postgres://, mongodb:// or mongodb+srv://` | Fix the URL scheme. Check for stray quotes or spaces. |
| Runs from yesterday are missing | The dashboard opened a different database. Check for an exported `VISUALGUARD_DATABASE_URL` or `DATABASE_URL`. |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Back up and restore](/deployment/storage-and-backups/): set up `pg_dump` or managed backups now.
- [Deploy to Vercel](/deployment/vercel/) or [Cloud Run](/deployment/cloud-run/): host the dashboard with this database.
- [Turn on login](/dashboard/login/): let your team sign in.
