---
title: "Store evidence and recover from backups"
description: "Understand where evidence is stored, keep screenshots in S3, Google Cloud Storage or Azure Blob Storage, and make portable exports and complete operational backups."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-27"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "apps/platform/server/backup.ts",
    "apps/platform/server/object-storage.ts",
    "apps/platform/server/artifacts.ts",
  ]
sidebar: { "order": 7 }
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

### Where are images saved?

- The execution machine retains run files under the configured output directory, normally `.visualguard/runs/`.
- A successful dashboard import/publish stores new screenshots and DOM evidence in the **selected dashboard database** by default.
- SQLite uses `metadata.sqlite`; PostgreSQL uses `vg_objects`/`vg_object_chunks`; MongoDB uses corresponding collections. Chunks are 1 MiB with base64-encoded data, indexed by content digest.
- Therefore, by default, Vercel + PostgreSQL stores images in that PostgreSQL service, and Cloud Run + Cloud SQL stores them in Cloud SQL. The compute host's local filesystem is not the persistent cloud image store.
- Set `VISUALGUARD_ARTIFACT_STORAGE_URL` to keep the image bytes in an S3-compatible bucket, Google Cloud Storage or Azure Blob Storage instead. The database then keeps only the index (digest and size). See [store screenshots in object storage](/deployment/storage-and-backups/#store-screenshots-in-object-storage). Vercel Blob is not supported.

Accounts, sessions, run metadata, review state, baseline history and policies also persist in the database when supported by the installed release. Without object storage, database cost/capacity must include evidence: base64 uses about four bytes per three original bytes before compression/index/backup overhead; deduplication can reduce additional writes for identical objects. There is no assumed automatic time-based history retention.

### Store screenshots in object storage

Screenshots usually make up most of a dashboard's data. To keep the database small, set `VISUALGUARD_ARTIFACT_STORAGE_URL` on the dashboard and on every process that opens the same dashboard storage: the hosted service, `visualguard dashboard` subcommands such as `export` and `restore`, and operator tools. Leave it unset to keep everything in the database.

| Provider                                | Value                                                                      | Credentials                                                                                             | Install                 |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------- |
| Amazon S3                               | `s3://BUCKET/PREFIX?region=eu-west-1`                                      | The standard AWS chain: `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, a profile, or the host's IAM role. | `@aws-sdk/client-s3`    |
| S3-compatible (Cloudflare R2, MinIO, …) | `s3://BUCKET/PREFIX?region=auto&endpoint=https://HOST&forcePathStyle=true` | The same AWS variables, with the provider's access key.                                                 | `@aws-sdk/client-s3`    |
| Google Cloud Storage                    | `gs://BUCKET/PREFIX`                                                       | Application Default Credentials: the Cloud Run service account, or `GOOGLE_APPLICATION_CREDENTIALS`.    | `@google-cloud/storage` |
| Azure Blob Storage                      | `azure://CONTAINER/PREFIX`                                                 | `AZURE_STORAGE_CONNECTION_STRING`.                                                                      | `@azure/storage-blob`   |

`PREFIX` is optional and keeps VisualGuard's objects under one folder, for example `s3://acme-qa/visualguard/`. Never put keys in the URL; VisualGuard rejects a URL with a user name or password.

1. Create a **private** bucket or container. Do not enable public access: anyone with an object's address could read your screenshots.
2. Give the dashboard's identity read, write and delete access to the prefix. For S3, that means `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `arn:aws:s3:::BUCKET/PREFIX/*`, plus `s3:ListBucket` on the bucket. Without `s3:ListBucket`, S3 reports a missing object as access denied, and VisualGuard cannot tell the two apart. On Google Cloud, `roles/storage.objectUser` on the bucket covers it.
3. Install the provider's SDK next to VisualGuard, in the folder that runs the dashboard. It is not installed by default:

   ```sh
   npm install @aws-sdk/client-s3
   ```

   Without it, the dashboard stops at start-up with `VISUALGUARD_ARTIFACT_STORAGE_URL uses Amazon S3; install its SDK next to VisualGuard: npm install @aws-sdk/client-s3`.

4. Set the variable, for example in `.env.visualguard` or the host's settings, and restart the dashboard:

   ```sh
   VISUALGUARD_ARTIFACT_STORAGE_URL=s3://acme-qa/visualguard?region=eu-west-1
   ```

How it behaves:

- **New evidence** goes to the bucket under `PREFIX/objects/`, named by its SHA-256 digest. Identical content is stored once.
- **Existing evidence** stays in the database and keeps working. Nothing is copied or moved, so you can turn object storage on at any time. To move old evidence too, export it, then restore it into a fresh installation that has object storage set.
- **Reads are verified.** Every object read from the bucket is checked against its digest and size, so a changed or truncated object is reported instead of shown.
- **Deleting** a run or project also deletes its objects from the bucket once no other run uses them. If the bucket cannot be reached, the deletion still completes and the object cleanup is retried on the next deletion.
- **Do not remove the setting** after evidence has been stored in the bucket. Without it, those runs report `Artifact is in external object storage; set VISUALGUARD_ARTIFACT_STORAGE_URL to read it`. Restore the setting to read them again.

:::caution
A database backup no longer contains the screenshots. Back up the bucket too, for example with versioning or replication, and restore both together. A [portable export](#portable-evidence-backup) still includes every object, because it reads them through the dashboard.
:::

To check the setup, publish a run, open it in the dashboard, and look in the bucket for a new object under `PREFIX/objects/`.

### Portable evidence backup

From a machine with access to the selected DB/data directory:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard \
  export /absolute/path/team-evidence.vgbackup.gz
```

Use a new output filename. Portable export contains projects/run evidence/required artifact objects and excludes authentication state; it is not a full operational backup. Restore into a fresh local workspace with an environment file selecting SQLite:

```sh
npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite \
  --data-dir ./review-workspace restore /absolute/path/team-evidence.vgbackup.gz
npx --no-install visualguard dashboard --env-file .env.visualguard-sqlite \
  --data-dir ./review-workspace
```

Create that ignored `.env.visualguard-sqlite` first with the three local-mode/empty URL settings from [the related setup guide](/dashboard/local/), and add it to `.gitignore`. Restoration is append-only/deduplicating and can reject conflicting evidence; prefer a fresh destination rather than expecting overwrite semantics. Legacy file-backed workspaces may require their original `objects/` directory or a portable export collecting it.

### Native operational backups

For complete recovery, include the actual database, configuration/secrets and provider settings:

- **Object storage:** when `VISUALGUARD_ARTIFACT_STORAGE_URL` is set, the screenshots are in the bucket, not the database. Back up the bucket (versioning, replication or a provider backup) at least as often as the database, and keep the same `PREFIX` when you restore.
- **SQLite:** stop all writers and back up the configured data directory, the exact SQLite file and any legacy artifact directory. Include WAL state through a proper backup procedure; do not copy only a live main file blindly.
- **PostgreSQL:** use managed backups/PITR or `pg_dump`/`pg_restore` for your actual deployment, including all VisualGuard tables. For the local Docker example:

```sh
umask 077
docker exec visualguard-postgres-local pg_dump -U visualguard -d visualguard -Fc \
  > visualguard-native.dump
```

[PostgreSQL native dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html).

- **MongoDB:** use the Atlas/deployment backup and restore procedure supported by your cluster. Confirm backup availability and retention for your chosen deployment. If your operator uses MongoDB Database Tools, follow the [MongoDB dump options](https://www.mongodb.com/docs/database-tools/mongodump/) for a consistent backup of the actual deployment; the connection-only setup in [the related setup guide](/deployment/mongodb/) does not configure backups.

Restore into a **separate isolated database** and verify old screenshot bytes, accounts, permissions, reviews and current baselines. A restore also restores historical credential state, so revoke compromised sessions/tokens/invitations before reconnecting an incident recovery. Keep backups private and outside Git/CI artifacts.

### Updates

Pin the next supported package version in both runner and deployment. Rebuild/regenerate hosting assets as required, back up and validate against a restored test database before upgrading production. A previous hosting deployment does not roll back a migrated schema. Stop old writers and upgrade consistently for identity, administration and reference changes.

## Recovery checklist

1. Record the app version, actual database/data-directory identity and deployment configuration.
2. Take a consistent native backup and store the necessary secrets/provider configuration separately.
3. Restore into a new isolated destination using your database's supported restore procedure.
4. Keep production workers/integrations disconnected during the drill.
5. Verify account access and roles, projects, old screenshot bytes/DOM (from the bucket too, when object storage is set), reviews, baseline history, policies and per-project runner/configuration state.
6. Check and revoke historical compromised credentials before reconnecting an incident recovery.
7. Record the restore date, tested scope and any missing evidence. A portable export alone cannot restore accounts or the complete operational workspace.

## Next steps

[Review upgrades](/deployment/upgrades/) and [operator recovery](/deployment/operations-and-recovery/). Backend backup tools and retention policies vary; use the official documentation linked above for your exact database version/deployment.
