# Dashboard names and project identifiers

## Give a run a custom name

This feature branch starts from merged `main`, independently of the F03 review-inbox branch. Its naming features have separate commits. No formatting, lint, type checks, builds, browser checks, or tests have been run locally for these changes.

With a feature-enabled package, supply a name when binding a test to a dashboard project:

```sh
npx visualguard test storefront --run-name "Checkout release smoke" \
  --production http://localhost:3101 --staging http://localhost:3100 --route / --no-ai
```

Both application URLs need to be running. Use your actual URLs, or omit the URL flags if your existing configuration supplies them. For a running dashboard add `--dashboard http://127.0.0.1:4400`; for a hosted dashboard also supply its existing `VISUALGUARD_UPLOAD_TOKEN`.

Saved evidence can receive an initial name during import or publishing:

```sh
npx visualguard dashboard import /absolute/path/to/run --project storefront --run-name "Checkout smoke"
npx visualguard dashboard publish /absolute/path/to/run --project storefront \
  --server https://dashboard.example.com --run-name "Checkout smoke"
```

The source repository import/publish commands also accept `--run-name`. The dashboard API accepts `metadata.runName`. Names contain 1–120 trimmed characters. Run history searches match custom names. The original run number, UUID, screenshots, engine results, and offline report remain available; unnamed runs keep their default `Run #…` label.

`--run-name` on `test` requires a project. It does not modify the offline engine's manifest. The initial name is part of the upload metadata, so interrupted uploads must be retried with the same initial name and other labels. Changing metadata for an existing engine run ID remains a conflict.

To inspect source changes manually, start `pnpm platform:dev`; an installed package or compiled dashboard needs a manual rebuild/repack before these changes appear. Import a disposable saved run with `--run-name`, find it in history by that name, and verify that its comparison viewer, original number, and verdict remain correct. Repeat the same import to confirm idempotence. Try an empty or overlength initial name and verify rejection before capture/upload.

## Hosted diff-image storage

The dashboard stores all new reference, candidate, diff, crop, and DOM artifacts in the selected database. `vg_objects` holds the checksummed object metadata and `vg_object_chunks` holds immutable 1 MiB chunks. PostgreSQL/SQLite store binary bytes; MongoDB stores base64-encoded chunk data. Objects are deduplicated by content hash.

On Cloud Run or Vercel, configure an external MongoDB or PostgreSQL database using the existing `VISUALGUARD_DATABASE_URL`. The dashboard reads protected evidence through its authenticated API; it does not depend on the hosting filesystem to retain images. Local mode stores new evidence in `.visualguard/platform/metadata.sqlite` by default. Earlier F01 workspaces can also have legacy `objects/` files and must retain those until migrated/exported.

There is currently no S3, Google Cloud Storage, or Vercel Blob adapter. Database storage and native backups therefore need to include image bytes. Existing portable evidence exports also include image chunks. See the [standalone walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for hosting and backup procedures.
