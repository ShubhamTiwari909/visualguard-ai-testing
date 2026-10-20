---
title: "Choose dashboard hosting"
description: "Plan persistent storage, login, worker placement and a separate dashboard deployment."
audience: "operator"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 1}
---

## Before you start

Complete [the local dashboard workflow](/dashboard/local/) and understand [publishing](/dashboard/publishing/). Choose a package release containing your team's required features. An administrator must control the cloud project, database, secrets and domain settings. Browser workers need network access to both tested environments and the dashboard.

Both hosts require an **external persistent database**; SQLite under their ephemeral filesystem is not supported. A managed PostgreSQL service is the simplest shared example here. A transaction-capable MongoDB URI can be used instead with provider-appropriate network access. Each new database starts as a separate empty workspace; deployment does not migrate your local history.

Use the four settings `VISUALGUARD_DATABASE_URL`, `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_ADMIN_EMAIL`, `VISUALGUARD_ADMIN_PASSWORD`, plus explicit `VISUALGUARD_AUTH_MODE=login`. Keep them server-side, never `NEXT_PUBLIC_`/`VITE_`. Use an exact canonical HTTPS origin without a path/query. A generated provider domain is sufficient initially; custom domains are optional.



## Choose a deployment path

- [Vercel](/deployment/vercel/): generated API/static deployment with an external database and explicit deep-link rewrites.
- [Cloud Run](/deployment/cloud-run/): generated container/source deployment with managed PostgreSQL or transactional MongoDB.
- [Cloud SQL](/deployment/cloud-sql/): Cloud Run-specific PostgreSQL socket/network/IAM configuration.

Choose [PostgreSQL](/deployment/postgresql/) or [transactional MongoDB](/deployment/mongodb/) independently of your AI provider. Dashboard databases store evidence as well as metadata. Workers keep application login/AI secrets; reviewers need browser access only.

## Verification sequence

Verify health and login at the canonical origin, project creation, a real uploaded capture, direct page refresh, approved-baseline download and restore to an isolated environment. Deploying a new database creates an empty workspace; plan a supported backup/restore migration if you need old history.

## Validation scope

These instructions are reviewed against the current scaffold/source and linked provider documentation. This documentation implementation did not deploy a live cloud service, configure real OAuth or restore a production database. Follow the verification checklist on your own isolated installation before production use. The documentation website itself is static; the dashboard hosting instructions below describe a separate application.
