---
title: "Run artifacts and persistence"
description: "Locate manifests, screenshots, reports, repair evidence and dashboard objects."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-27"
sourcePaths: ["packages/visualguard/README.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: { "order": 5 }
---

Every run writes `.visualguard/runs/<run>/` with `manifest.json`, the screenshots, a diff image,
crops of each changed region and `index.html`: a self-contained report with side-by-side, slider,
onion-skin and diff views. It opens straight from disk, so you can upload the run directory as a
CI artifact. `npx --no-install visualguard report` serves it locally. Add `.visualguard/` to `.gitignore`
(`init` does this for you).

## Evidence lifecycle

- The execution machine retains run files under the configured output directory, normally `.visualguard/runs/`.
- A successful dashboard import/publish stores new screenshots and DOM evidence in the **selected dashboard database** by default.
- SQLite uses `metadata.sqlite`; PostgreSQL uses `vg_objects`/`vg_object_chunks`; MongoDB uses corresponding collections. Chunks are 1 MiB with base64-encoded data, indexed by content digest.
- Therefore, by default, Vercel + PostgreSQL stores images in that PostgreSQL service, and Cloud Run + Cloud SQL stores them in Cloud SQL. The compute host's local filesystem is not the persistent cloud image store.
- Set `VISUALGUARD_ARTIFACT_STORAGE_URL` to keep the image bytes in an S3-compatible bucket, Google Cloud Storage or Azure Blob Storage instead. The database then keeps only the index (digest and size). See [store screenshots in object storage](/deployment/storage-and-backups/#store-screenshots-in-object-storage). Vercel Blob is not supported.

Accounts, sessions, run metadata, review state, baseline history and policies also persist in the database when supported by the installed release. Without object storage, database cost/capacity must include evidence: base64 uses about four bytes per three original bytes before compression/index/backup overhead; deduplication can reduce additional writes for identical objects. There is no assumed automatic time-based history retention.

Local reports contain embedded application JS/CSS and references to separate screenshot files. Copy the whole run directory when sharing. Baselines include rendering metadata/DOM/health sidecars, which belong with PNGs. Repair outcomes live under the original run with `fix-results.json`, `fixes/` and `fix-checks/` when generated.

The manifest records engine evidence; dashboard names, review decisions and operational account state have their own storage. Portable evidence exports exclude authentication and do not replace native backups. Do not assume a report URL uploads or hosts artifacts. [Back up the correct storage](/deployment/storage-and-backups/).
