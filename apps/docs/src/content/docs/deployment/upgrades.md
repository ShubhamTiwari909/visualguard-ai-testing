---
title: "Upgrade an existing installation"
description: "Pin compatible releases, back up before migration and verify deployment files and evidence after upgrade."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/CHANGELOG.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 8}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

## 1. Inventory the current installation

Record the installed npm package version, CLI-reported version, server/deployment version, database engine/version, current canonical URL and worker releases. Check the [release matrix](/releases/) and package changelog. Use package-manager metadata to verify the installed version if it differs from the embedded CLI label.

## 2. Back up and test a restored copy

Take a native operational backup plus private deployment/provider configuration. Restore into a new isolated database and verify old screenshots, accounts, roles and current baselines. Portable evidence exports exclude authentication and cannot replace this step.

## 3. Follow the release-specific migration

The 3.2.0 migration from 3.1.0 requires the following behavior:

- Take a native operational database backup and stop older dashboard writers before upgrading. Upgrade all dashboard instances consistently; keep the runner and server on compatible releases. A code rollback does not restore an older database schema.
- Existing installations with users but no recorded admission policy must explicitly choose `VISUALGUARD_USER_ADMISSION=invite` or `legacy` before startup. Fresh hosted workspaces default to invite-only admission. Use SQLite, PostgreSQL or a transaction-capable MongoDB replica set/sharded deployment for the full team workflow; standalone MongoDB needs explicit legacy mode and does not support invitations, account linking, managed lifecycle changes, baseline mutations or administrator recovery.
- Preserve existing account IDs and use explicit Google linking with current-account proof. Matching email addresses do not merge identities. Keep a tested password administrator; changing bootstrap environment credentials does not reset an existing account.
- Rebuild/redeploy the dashboard package and generated hosting assets as well as updating the test runner. Verify direct navigation to all supported pages. The published 3.2.0 Vercel scaffold omits `/policies`; add its `/index.html` rewrite before redeploying, or regenerate from a release containing the scaffold correction. Updating the package alone does not update an old deployment folder.
- GitHub checks need server-side supported credentials, repository mappings, a webhook secret/raw-body forwarding and external scheduled reconciliation. Credential rotation and scheduler monitoring remain operator responsibilities. Start in Informative mode; checks are point-in-time observations, not continuous release authorization.
- Native database backups include new screenshot/DOM chunks and operational state. Portable evidence exports exclude authentication state and cannot replace a full recovery backup. Test a restore in a separate environment before relying on the upgrade.

See the [npm setup guide](/start/install/) for application/dashboard setup and the [local source guide](/contributing/local-setup/) for operator recovery. These are upgrade instructions, not a claim that a real Google/cloud deployment has been validated.

## 4. Upgrade consistently

Stop older writers when the release requires it. Pin the chosen compatible version in both the capture application and dashboard deployment. Rebuild/redeploy generated assets; regenerate an old scaffold into a separate empty directory and review rewrites instead of overwriting a customized live folder blindly. Do not omit optional database/OIDC dependencies.

## 5. Verify and plan rollback

Verify login/linking, project permissions, representative old/new captures, review/baseline selection, UI-triggered worker execution and exact-revision policy. Restore normal workers/integrations only after checks succeed. A code rollback does not undo a schema migration; preserve the compatible backup and stop writers before a database rollback. [Review backup procedures](/deployment/storage-and-backups/) and record what was actually exercised.
