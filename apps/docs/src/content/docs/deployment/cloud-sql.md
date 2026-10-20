---
title: "Connect Cloud Run to Cloud SQL"
description: "Create a Cloud SQL for PostgreSQL database, attach it to the Cloud Run dashboard through its socket, and keep credentials in Secret Manager."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/platform/server/database.ts", "apps/platform/server/config.ts", "apps/platform/server/scaffold.ts"]
sidebar: {"order": 6}
---

Cloud SQL is Google's managed PostgreSQL. This tutorial connects it to the dashboard you deployed on Cloud Run. Instead of a public database address, Cloud Run reaches Cloud SQL through a private Unix socket, and the passwords live in Secret Manager.

## Before you start

- Finish [Deploy the dashboard to Cloud Run](/deployment/cloud-run/) up to step 4, with the `VG_PROJECT_ID` and `VG_REGION` variables still set in your shell.
- Have permission to create Cloud SQL instances, service accounts and secrets in the project.
- Read [Use PostgreSQL](/deployment/postgresql/) for how the dashboard uses PostgreSQL.
- Examples use macOS/Linux shells; on Windows use WSL.

:::note
This path is reviewed against the source and Google's documentation. It has not been certified with a live Cloud SQL instance. Run the verification steps on an isolated instance before production use.
:::

## 1. Turn on the APIs

```bash
gcloud services enable sqladmin.googleapis.com secretmanager.googleapis.com
```

You should see `Operation ... finished successfully`.

## 2. Create the instance, database and user

Create a PostgreSQL instance named `visualguard-db` in the **same region** as your Cloud Run service. Use the Cloud console or `gcloud sql instances create`. Choose a size that fits your evidence (screenshots are stored in the database), and turn on:

- automated backups and point-in-time recovery
- deletion protection

Then create the database and a dedicated user. A hex password needs no URL encoding:

```bash
export VG_DB_PASSWORD="$(openssl rand -hex 24)"
gcloud sql databases create visualguard --instance=visualguard-db
gcloud sql users create visualguard --instance=visualguard-db --password="$VG_DB_PASSWORD"
```

You should see `Created database [visualguard]` and `Created user [visualguard]`. The dashboard creates its own tables on first start. If that fails with `permission denied for schema public`, grant the user `USAGE, CREATE` on the schema as in [Use PostgreSQL](/deployment/postgresql/#1b-create-a-database-on-a-hosted-service).

## 3. Create a runtime service account

Give the dashboard its own identity, and let it connect to Cloud SQL:

```bash
gcloud iam service-accounts create visualguard-run --display-name="VisualGuard dashboard"
export VG_SA="visualguard-run@${VG_PROJECT_ID}.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$VG_PROJECT_ID" \
  --member="serviceAccount:${VG_SA}" --role="roles/cloudsql.client"
```

## 4. Build the socket URL

Read the instance's connection name. It looks like `PROJECT:REGION:INSTANCE`:

```bash
export VG_SQL_CONNECTION="$(gcloud sql instances describe visualguard-db --format='value(connectionName)')"
echo "$VG_SQL_CONNECTION"
```

Cloud Run mounts the instance's socket at `/cloudsql/PROJECT:REGION:INSTANCE`. The URL passes that path in the `host` option, URL-encoded (`/` becomes `%2F` and `:` becomes `%3A`):

```text
postgresql://visualguard:HEX_PASSWORD@localhost:5432/visualguard?host=%2Fcloudsql%2FPROJECT%3AREGION%3AINSTANCE
```

Build it from your variables:

```bash
export VG_SOCKET="$(printf '/cloudsql/%s' "$VG_SQL_CONNECTION" | sed -e 's|/|%2F|g' -e 's|:|%3A|g')"
export VG_DATABASE_URL="postgresql://visualguard:${VG_DB_PASSWORD}@localhost:5432/visualguard?host=${VG_SOCKET}"
```

The dashboard uses its normal `pg` driver with this socket. It does not install a separate Cloud SQL connector.

## 5. Store the secrets

Store the database URL and the admin password in Secret Manager, and let the service account read only these two:

```bash
printf '%s' "$VG_DATABASE_URL" | gcloud secrets create visualguard-db-url --data-file=-
printf '%s' 'YOUR_UNIQUE_INITIAL_PASSWORD' | gcloud secrets create visualguard-admin-password --data-file=-

for secret in visualguard-db-url visualguard-admin-password; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${VG_SA}" --role="roles/secretmanager.secretAccessor"
done
```

Remove `VISUALGUARD_DATABASE_URL` and `VISUALGUARD_ADMIN_PASSWORD` from `.env.cloud-run.yaml`. One variable cannot be both a plain value and a secret.

## 6. Deploy with the attachment

From the Cloud Run deployment folder, deploy with the service account, the SQL attachment and the secrets:

```bash
gcloud run deploy visualguard-dashboard \
  --source . --region "$VG_REGION" --env-vars-file .env.cloud-run.yaml \
  --port 8080 --max-instances 3 --no-allow-unauthenticated \
  --no-cpu-throttling --min-instances 1 --memory 2Gi \
  --service-account "$VG_SA" \
  --execution-environment gen2 \
  --add-cloudsql-instances "$VG_SQL_CONNECTION" \
  --set-secrets VISUALGUARD_DATABASE_URL=visualguard-db-url:1,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1
```

| Flag | Why |
| --- | --- |
| `--service-account` | Run as the identity that can reach Cloud SQL and the secrets. |
| `--execution-environment gen2` | The second-generation environment Google documents for this connection. |
| `--add-cloudsql-instances` | Mount the instance's socket under `/cloudsql/`. |
| `--set-secrets` | Map pinned secret versions to environment variables. |

The remaining flags are explained in [Cloud Run step 5](/deployment/cloud-run/#5-deploy). Then continue with Cloud Run steps 6 and 7 to set the public URL and allow browser access.

## Network rules

- The socket path uses the instance's public IP through Google's built-in proxy. Do **not** add `0.0.0.0/0` to the instance's authorized networks; the socket does not need it.
- A private-IP-only instance needs VPC egress from Cloud Run (Direct VPC egress or a connector). Set that up first.

See [Connect from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-run) and [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

## Example: rotating the database password

Six months later, the team rotates the password. They set a new password with `gcloud sql users set-password`, rebuild the URL, add it as version 2 of `visualguard-db-url`, and run `gcloud run services update visualguard-dashboard --region "$VG_REGION" --set-secrets VISUALGUARD_DATABASE_URL=visualguard-db-url:2,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1`. The new revision starts with the new URL. Changing `visualguard-admin-password` later does not change an existing administrator's password; it is only used to create the first account.

## Verify the connection

1. `curl --fail "$VG_DASHBOARD_URL/api/health"` prints `{"status":"ok"}`. This proves the database answers.
2. Sign in at the exact public URL.
3. Refresh `/reviews`, `/baselines`, `/policies` and `/settings` directly.
4. Publish a real run from CI and open its screenshots.
5. In Cloud SQL Studio, run `SELECT count(*) FROM vg_runs;`. It should be at least `1`.
6. Deploy a new revision, or let a new instance start. The run should still be there.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ENOENT` on `/cloudsql/...` | The instance is not attached. Add `--add-cloudsql-instances` with the exact connection name. |
| `password authentication failed` | The secret's URL has the wrong password. Rebuild it and add a new secret version. |
| Permission denied reading a secret | Grant `roles/secretmanager.secretAccessor` on that secret to the runtime service account. |
| `Cannot update environment variable ... to the given type` | The variable is still a plain value. Remove it from the env-vars file, then set it as a secret. |
| Connection times out with a private-IP instance | Add VPC egress from Cloud Run to the instance's network. |
| `permission denied for schema public` | Grant the `visualguard` user `USAGE, CREATE` on the schema. |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Set up backups](/deployment/storage-and-backups/): check Cloud SQL backups and practice a restore.
- [Plan upgrades](/deployment/upgrades/): back up before each new release.
- [Turn on login](/dashboard/login/): invite your team.
