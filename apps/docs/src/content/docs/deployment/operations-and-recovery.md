---
title: "Audit and recover administrator access"
description: "Inspect account readiness and use supported host-side recovery without rewriting identity records."
audience: "operator"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/LOCAL-SETUP.md", "apps/platform/server/operations.ts"]
sidebar: { "order": 9 }
---

## Before you start

You need workspace administrator access for the audit UI, and authorized host/database access for source recovery. The commands below are **source-only**: clone the matching VisualGuard revision, install its dependencies and load the same operational database/absolute data-directory settings as the dashboard. Use a POSIX host for the password-file recovery path; it is not a native Windows or installed npm endpoint. Take a consistent native backup and stop writers as the steps require.

Administrators open **Audit & recovery** at `/operations`. Audit filters and Previous/Next pages keep history bounded. Readiness summarizes admission, transaction support and administrators; it is not production certification.

### Host-side inspection

These source-only commands connect directly to the configured operational storage. Set exactly the running dashboard's database/absolute data directory first:

```sh
pnpm platform:operations status
pnpm platform:operations admins
pnpm platform:operations preview --user ACCOUNT_ID
```

Follow `nextCursor` with `admins --after CURSOR` when present. Preview returns the existing account version, without a password hash. Recovery is not an npm command or an HTTP endpoint.

### Recover an existing password administrator

1. Stop all writers and take a native operational database backup. Confirm the intended existing password admin by ID, then preview its current version.
2. On a POSIX host, create a privately owned, non-symlink password file outside the repository with mode `600`, containing one new 12–256 character password. Use an editor rather than putting the password in shell arguments.
3. Run, substituting the exact preview values and file path:

```sh
pnpm platform:operations recover \
  --user ACCOUNT_ID --version PREVIEW_VERSION --confirm ACCOUNT_ID \
  --backup-confirmed --reason "Restore administrator access after an incident" \
  --password-file /absolute/private/path/recovery-password
```

4. Restart, sign in, confirm old sessions/upload credentials are revoked and inspect the recovery audit event. Remove the private password file after verifying access.

Recovery cannot create/promote users, merge identities or add a password to a Google-only account. It requires transactional storage and a fresh account version. If only Google admins exist, restore provider access or an appropriate native backup instead of editing identity rows.

### Backup types

- **Native database backup:** includes operational account/review/baseline/policy state and new image objects. For SQLite, stop all writers and back up the configured data directory, including any legacy objects and an explicitly separate SQLite file. Do not copy only a live main file while WAL writes continue. For PostgreSQL/MongoDB, use the provider/native consistent-backup procedure.
- **Portable evidence export:** projects/run evidence/artifact objects, excluding authentication state. It is useful for offline evidence sharing, not recovery of an administrator or the whole installation.

```sh
node packages/visualguard/dist/cli.js dashboard export /absolute/path/team-evidence.vgbackup.gz
```

Restore into a fresh isolated destination and verify accounts, permissions, old screenshots and baseline selection before trusting a native backup. Keep deployment secrets separately. A rollback of code does not roll back a migrated database.

## Verify and troubleshoot

Confirm the intended existing account ID/version before recovery, verify sign-in afterward and inspect the audit event/revoked credentials. An OIDC-only account cannot acquire a password through this path. A stale version requires a new preview, not a forced write. Restore provider access or a compatible operational backup when this recovery contract does not apply.

[Rehearse a full restore](/deployment/storage-and-backups/) rather than treating readiness inventory as production certification.
