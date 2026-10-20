---
title: "Use MongoDB"
description: "Connect the dashboard to MongoDB Atlas, a local replica set or your own cluster, and confirm runs survive a restart."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/mongo.ts", "apps/platform/server/config.ts", "apps/platform/server/auth.ts", "apps/platform/.env.example", ".github/workflows/ci.yml"]
sidebar: {"order": 3}
---

This tutorial stores the dashboard in MongoDB instead of its default SQLite file. You will get a connection URL (from Atlas, a local Docker replica set or your own cluster), start the dashboard, and prove that runs survive a restart. The app you test needs no MongoDB code.

## Before you start

- Finish [the quickstart](/start/quickstart/) and [the local dashboard](/dashboard/local/). Keep your app's reference and candidate environments running.
- Pick one MongoDB source: Atlas (step 1A), Docker on your computer (step 1B), or an existing cluster (step 1C).
- Keep VisualGuard's optional npm dependencies installed. The MongoDB driver is one of them.
- Stop any dashboard already running on port 4400.
- Run commands from your app's root folder. Examples use macOS/Linux shells; on Windows use WSL.

:::note
The MongoDB path is reviewed against the source and runs in the project's own CI tests against MongoDB 7, both as a replica set and standalone. It has not been certified on a live Atlas or production cluster.
:::

## Replica set or standalone?

Some team features need database **transactions** (several writes that succeed or fail together). MongoDB supports them only on a **replica set** or a **sharded cluster**. Atlas clusters are always replica sets.

| Deployment | Admission setting | What works |
| --- | --- | --- |
| Replica set or sharded cluster | `VISUALGUARD_USER_ADMISSION=invite` (the default for new workspaces) | Everything. |
| Standalone server | `VISUALGUARD_USER_ADMISSION=legacy` (required) | Runs, reviews and publishing. **Not** invitations, Google account linking, managed lifecycle changes, baseline changes or administrator recovery. |

`invite` means unknown people need an invitation to join. `legacy` keeps the older behavior of creating accounts on first sign-in. Use a replica set for any new team install.

## 1A. Get a URL from MongoDB Atlas

1. In your Atlas project, create or select a cluster.
2. Under **Database Access**, add a database user with read and write access to a database named `visualguard`. This user is separate from your Atlas website login.
3. Under **Network Access**, add the public IP address of the machine that runs the dashboard. When you host the dashboard later, add the host's outbound addresses instead.
4. Open the cluster's **Connect → Drivers** and copy the connection string.
5. Put your user and password into it, and add `/visualguard` before the `?`. Keep the options Atlas gave you.

```text
mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority
```

`mongodb+srv://` URLs use TLS automatically. See [Atlas connection setup](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/). Skip to step 2.

## 1B. Start a local replica set with Docker

Use this for development on one computer. It needs [Docker](https://docs.docker.com/get-docker/). It starts a one-member replica set named `rs0`, which supports transactions.

```bash
docker run --detach --name visualguard-mongo-local \
  --publish 127.0.0.1:27017:27017 \
  --volume visualguard_mongo_local:/data/db \
  mongo:7 --replSet rs0 --bind_ip_all

docker exec visualguard-mongo-local mongosh --quiet \
  --eval 'rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]})'
```

You should see `{ ok: 1 }`. If you see a connection error, wait a few seconds and run the `rs.initiate` command again. Then check that the member is ready:

```bash
docker exec visualguard-mongo-local mongosh --quiet --eval 'db.hello().isWritablePrimary'
```

You should see `true`. Your URL is:

```text
mongodb://127.0.0.1:27017/visualguard?replicaSet=rs0
```

This local instance has no password and listens only on `127.0.0.1`. Never expose it to a network. The named volume keeps your data when the container stops; run only `docker start visualguard-mongo-local` next time.

## 1C. Use an existing cluster

Create a dedicated user. In `mongosh`, connected as an administrator:

```javascript
use admin
db.createUser({
  user: "visualguard",
  pwd: "replace-with-a-long-unique-password",
  roles: [{ role: "readWrite", db: "visualguard" }]
})
```

Then build the URL with the database name and your cluster's options:

```text
mongodb://visualguard:ENCODED_PASSWORD@db1.example.com:27017,db2.example.com:27017/visualguard?replicaSet=rs0&authSource=admin&tls=true
```

Keep your cluster's authentication, TLS and replica-set options. Allow the dashboard's network address in your firewall.

## 2. Check the URL

| Rule | Right | Wrong |
| --- | --- | --- |
| Include a database name after the host | `...mongodb.net/visualguard?...` | `...mongodb.net/?...` |
| Use letters, digits, `_` or `-` in the name | `visualguard`, `vg_team` | `visual.guard` |
| URL-encode special characters in user and password only | `p%40ss` for `p@ss` | Encoding the whole URL |
| Start with `mongodb://` or `mongodb+srv://` | `mongodb+srv://...` | `mongo://...` |

A URL without a database name fails with "MongoDB URL must include a database name". You do not need to create collections; VisualGuard creates them and their indexes on start. See [connection string rules](https://www.mongodb.com/docs/manual/reference/connection-string/).

## 3. Save the dashboard settings

Create `.env.visualguard` in your app's root folder and add it to `.gitignore`:

```dotenv
VISUALGUARD_DATABASE_URL="mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/visualguard?retryWrites=true&w=majority"
VISUALGUARD_AUTH_MODE=local
VISUALGUARD_PUBLIC_URL=
```

Use your real URL. For a standalone server, also add `VISUALGUARD_USER_ADMISSION=legacy`. Local mode needs no password or upload token and must stay on loopback. For a shared dashboard, see [login mode](/dashboard/login/).

## 4. Start the dashboard

In terminal A:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`. Leave it running.

The dashboard reads this file only when you pass `--env-file`. Values already exported in your shell win over the file. If you exported an old `VISUALGUARD_DATABASE_URL`, run `unset VISUALGUARD_DATABASE_URL` first. The dashboard opens up to five connections per instance and gives up after 10 seconds if it cannot reach a server.

## 5. Create a project and publish a run

In terminal B:

```bash
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
npx --no-install visualguard test storefront \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

The first command creates the project. The second captures your app and uploads the run into MongoDB. The test machine needs only the dashboard URL, never the MongoDB password. For AI, replace `--no-ai` with `--provider gemini` after [Gemini setup](/guides/ai-gemini/), or use the [Ollama](/guides/ai-ollama/) flags.

## Verify the data is in MongoDB

1. Open the run in the dashboard and click a screenshot.
2. In Atlas's **Browse Collections**, MongoDB Compass or `mongosh`, open the `visualguard` database. You should see `vg_projects`, `vg_runs`, `vg_state`, `vg_objects`, `vg_object_chunks` and `vg_project_tombstones`. For the Docker example:

   ```bash
   docker exec visualguard-mongo-local mongosh visualguard --quiet \
     --eval 'db.vg_runs.countDocuments()'
   ```

   The count should be at least `1`.
3. Stop the dashboard with Ctrl+C and start it again with the same command.
4. The run should still be there with its screenshots.

Changing the URL selects a different workspace. It does not copy history from SQLite or PostgreSQL.

## Example: a pilot on Atlas

A team tries VisualGuard on a free Atlas cluster. They create the `visualguard` user, allow their office IP, and run the dashboard locally in local mode for a week. When they move to [Cloud Run](/deployment/cloud-run/), they reuse the same URL and add Cloud Run's outbound addresses in **Network Access**. Their history comes with them because the data lives in Atlas.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `MongoDB URL must include a database name` | Add `/visualguard` right after the host, before `?`. |
| `Server selection timed out` | Your IP is not in **Network Access**, the replica set is not initiated, or TLS options are wrong. |
| `bad auth` or `Authentication failed` | Fix the user or password, URL-encode special characters, or add `authSource=admin`. |
| `Invitation admission requires transactional storage` | Use a replica set or Atlas, or set `VISUALGUARD_USER_ADMISSION=legacy` for a standalone server. |
| `Account linking requires transactional storage` | Google linking needs a replica set or sharded cluster. |
| An error says the `mongodb` package cannot be found | Reinstall without skipping optional dependencies (for example, without `--omit=optional`). |
| Docker `rs.initiate` reports `already initialized` | The replica set is already set up. Continue with the next step. |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Back up and restore](/deployment/storage-and-backups/): set up Atlas or `mongodump` backups.
- [Deploy to Cloud Run](/deployment/cloud-run/) or [Vercel](/deployment/vercel/): host the dashboard with this database.
- [Turn on login](/dashboard/login/): let your team sign in.
