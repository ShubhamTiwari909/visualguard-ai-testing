---
title: "Store evidence and recover from backups"
description: "Understand artifact persistence, portable exports and complete operational backups."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/backup.ts"]
sidebar: {"order": 7}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

### Where are images saved?

- The execution machine retains run files under the configured output directory, normally `.visualguard/runs/`.
- A successful dashboard import/publish stores new screenshots and DOM evidence in the **selected dashboard database**.
- SQLite uses `metadata.sqlite`; PostgreSQL uses `vg_objects`/`vg_object_chunks`; MongoDB uses corresponding collections. Chunks are 1 MiB with base64-encoded data, indexed by content digest.
- Therefore Vercel + PostgreSQL stores images in that PostgreSQL service, and Cloud Run + Cloud SQL stores them in Cloud SQL. The compute host's local filesystem is not the persistent cloud image store.
- Vercel Blob, S3 and Google Cloud Storage are not required/configurable artifact backends today. Merely setting a bucket environment variable does not move images.

Accounts, sessions, run metadata, review state, baseline history and policies also persist in the database when supported by the installed release. Database cost/capacity must include evidence: base64 uses about four bytes per three original bytes before compression/index/backup overhead; deduplication can reduce additional writes for identical objects. There is no assumed automatic time-based history retention.

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
5. Verify account access and roles, projects, old screenshot bytes/DOM, reviews, baseline history, policies and per-project runner/configuration state.
6. Check and revoke historical compromised credentials before reconnecting an incident recovery.
7. Record the restore date, tested scope and any missing evidence. A portable export alone cannot restore accounts or the complete operational workspace.

## Next steps

[Review upgrades](/deployment/upgrades/) and [operator recovery](/deployment/operations-and-recovery/). Backend backup tools and retention policies vary; use the official documentation linked above for your exact database version/deployment.
