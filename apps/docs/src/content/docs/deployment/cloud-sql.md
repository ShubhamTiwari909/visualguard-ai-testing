---
title: "Connect Cloud Run to Cloud SQL"
description: "Follow the complete connect cloud run to cloud sql workflow with persistent storage, login and verification."
audience: "operator"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 6}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## Validation scope

These instructions are reviewed against the current scaffold/source and linked provider documentation. This documentation implementation did not deploy a live cloud service, configure real OAuth or restore a production database. Follow the verification checklist on your own isolated installation before production use. The documentation website itself is static; the dashboard hosting instructions below describe a separate application.

Complete [Cloud Run setup](/deployment/cloud-run/) first. These steps replace its generic database connection with the actual Cloud SQL attachment and secret mapping.

Cloud SQL also works, but requires its connection path, not just a generic public URI:

1. Create a PostgreSQL instance in the same region, a dedicated `visualguard` database/user, and schema permissions. Enable backups/PITR/deletion protection as appropriate.
2. Create/select the Cloud Run runtime service account, grant `roles/cloudsql.client`, and attach the instance to the service using its `PROJECT:REGION:INSTANCE` connection name. Use the second-generation execution environment for the documented supported proxy/CA combinations.
3. For the public-IP built-in proxy/socket path, do not add `0.0.0.0/0` to database authorized networks. Private-IP-only SQL needs appropriate VPC egress/connector networking.
4. Store a PostgreSQL URL in Secret Manager with its URI-encoded socket host, for example:

```text
postgresql://visualguard:HEX_PASSWORD@localhost:5432/visualguard?host=%2Fcloudsql%2FPROJECT%3AREGION%3AINSTANCE
```

5. Grant that runtime identity secret access and deploy with the real service account, SQL attachment and secret versions. For example, adapt the earlier `gcloud run deploy` with `--service-account YOUR_RUNTIME_SA`, `--execution-environment gen2`, `--add-cloudsql-instances PROJECT:REGION:INSTANCE` and `--set-secrets VISUALGUARD_DATABASE_URL=visualguard-db-url:1,VISUALGUARD_ADMIN_PASSWORD=visualguard-admin-password:1`. Remove those two values from an env-vars file when using the secret mapping; an environment variable cannot simultaneously be a literal and a secret reference.
6. Verify startup, `/api/health`, login, publishing and restoration against the actual Cloud SQL instance.

Follow [Google's Cloud SQL connection instructions](https://docs.cloud.google.com/sql/docs/postgres/connect-run) and [Secret Manager configuration](https://docs.cloud.google.com/run/docs/configuring/services/secrets) for the chosen network/IAM setup. The app uses the existing `pg` driver/socket support; it does not install a separate Cloud SQL connector automatically.

## Verify before using this installation

Open `/api/health`, sign in at the exact canonical HTTPS origin, refresh `/reviews`, `/baselines`, `/policies` and `/settings`, then publish real screenshots from a separate runner. Inspect every artifact and pull an approved baseline. Check database persistence after a new compute instance starts. Do not use a successful static page response as proof the API, credentials or storage work.

## Troubleshooting and next steps

Check deployment logs, literal/secret environment conflicts, canonical URL, network/TLS access and generated rewrites. Updating npm does not rewrite an existing deployment folder. Keep preview databases separate. Configure [native backups](/deployment/storage-and-backups/) and rehearse [upgrades](/deployment/upgrades/) before production changes.
