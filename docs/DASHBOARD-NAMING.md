# Dashboard names and project identifiers

## Give a run a custom name

Give runs meaningful labels, edit project names, and change public project IDs while keeping existing history and integrations connected.

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

## Edit an existing run name

Open a run and select **Edit run name**. Project maintainers and workspace administrators can save a custom name; viewers and reviewers retain read-only access to this control. Clear the field to restore the default `Run #…` label. This changes the dashboard label and search index, without changing the immutable manifest, source revision, initial upload metadata, verdict, evidence digest, or screenshots.

The API uses `PATCH /api/runs/RUN_UUID` with `{ "name": "Release smoke", "expectedVersion": 0 }`, using `nameVersion` from the current run (default 0). It requires the existing browser/local action token and maintainer permission. Stale edits return 409; refresh and reconsider the new name before retrying. A successful response contains the run UUID, updated name (`null` for the default), and new name version. Upload credentials cannot rename runs.

Portable exports retain the current display name/version. Re-importing an identical saved run preserves any edits already made to that stored run. Retry uploads with their original initial metadata; use the edit control to rename an existing run.

Manual acceptance: rename a disposable run, search for the new label, refresh/restart, and inspect its comparison viewer and original number. Clear the label and verify the fallback. Open the run in two browsers, rename in one, then save in the other; expect a conflict. Check that viewers/reviewers and upload tokens cannot call the rename API, and that omitting the action token fails. Export and restore into a fresh workspace; the current label should survive.

## Hosted diff-image storage

The dashboard stores all new reference, candidate, diff, crop, and DOM artifacts in the selected database. `vg_objects` holds the checksummed object metadata and `vg_object_chunks` holds base64-encoded chunks representing up to 1 MiB of original bytes each, across SQLite, PostgreSQL, and MongoDB. Objects are deduplicated by content hash; allow for base64 overhead when sizing storage.

On Cloud Run or Vercel, configure an external MongoDB or PostgreSQL database using the existing `VISUALGUARD_DATABASE_URL`. The dashboard reads protected evidence through its authenticated API; it does not depend on the hosting filesystem to retain images. Local mode stores new evidence in `.visualguard/platform/metadata.sqlite` by default. Earlier F01 workspaces can also have legacy `objects/` files and must retain those until migrated/exported.

There is currently no S3, Google Cloud Storage, or Vercel Blob adapter. Database storage and native backups therefore need to include image bytes. Existing portable evidence exports also include image chunks. See the [standalone walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for hosting and backup procedures.

## Edit project name and ID

Open **People & integrations → Project access**, choose a project, and select **Edit project name & ID**. Maintainers and administrators can edit its display name and public ID. Names contain 1–120 trimmed characters; IDs contain 1–63 lowercase letters, numbers, or hyphens and must start with a letter or number.

For example, change `storefront` / “Storefront Web” to `storefront-web` / “Customer storefront”. Both commands below then bind to the same existing project:

```sh
npx visualguard test storefront-web --run-name "Release smoke"
npx visualguard test storefront --run-name "Release smoke"
```

Supply your existing application configuration or URL flags as in the first example. The new display name is also accepted as an exact, unique test selector. Existing upload tokens remain scoped to the same project. Saved-run imports, hosted publishing, project creation/reuse, history filters, and project API routes accept the active public aliases.

The editable ID is a **public ID**. The original `Project.id` remains the internal key for run history, memberships, upload state, immutable evidence, and stable links. `Project.publicId` is the current public ID, `Project.aliases` lists all committed reserved IDs, including the original key and current public ID, and `Project.version` is the profile version (default 0 before the first edit). This avoids moving or rewriting evidence and lets existing CLI integrations continue working. Historical IDs cannot be transferred to another project, including after deletion. Renaming is not a way to recycle an identity or reset account access.

Names and aliases are stored in the existing database's `vg_state` records under `project-profiles` and `project-ids`. No new database service or manual schema migration is required. Upgrade all dashboard servers and local writers before changing IDs; older writers do not understand alias reservations.

The API accepts `PATCH /api/projects/PROJECT_ID` with:

```json
{
  "name": "Customer storefront",
  "publicId": "storefront-web",
  "expectedVersion": 0
}
```

Use the current project version and the existing session action token. Missing permission returns 403, an invalid name/ID returns 400, and an occupied ID or stale profile version returns 409. Upload credentials cannot rename a project. Project deletion confirmations use the displayed current ID in the UI; the API also accepts its stable key. An attempted rename reserves its proposed ID before the profile update. If another edit wins or saving is interrupted, that reservation can remain attached to the same project without becoming an active alias. Refresh and retry the rename on that project; it cannot be claimed by another project. There is a limit of 1,000 committed IDs per project.

Portable evidence backups preserve current run labels, project names, the current public ID, and committed historical aliases. Destination names are not silently overwritten during a restore. If a destination has incompatible aliases or an ID collision, use a fresh workspace; a failed restore can leave partial metadata, as with existing evidence restores. Authentication state is still excluded from portable exports. Native database backups retain profile versions and reserved IDs as well.

### Manual acceptance

1. Start the source dashboard using `pnpm platform:dev`. For the new CLI flags, manually rebuild the JavaScript/UI distribution with `pnpm --filter visualguard build:dashboard`, or install a feature-enabled candidate package.
2. Create a disposable project, import a named run, then rename that run from its detail page. Confirm the sidebar, history search, heading, original number, comparison link, screenshots, and verdict are correct after refresh.
3. Edit the project's name and public ID in settings. Verify the sidebar and selectors update. Bind/import/publish with both the old ID and new public ID, and confirm no second project is created and every run remains in the same history.
4. Verify a previously issued project token still publishes to the new ID. Check that a Viewer/Reviewer cannot edit names, that upload tokens cannot edit names, and that missing action tokens are rejected.
5. Try an existing project's ID, a deleted project's ID, uppercase IDs, empty names, and overlength values. None should overwrite or move another project's evidence or access.
6. Open project settings in two browsers before saving either edit. After one save, the other must get a conflict. Refresh before retrying. Repeat with run names.
7. Export and restore into a fresh workspace. Confirm project names, active/historical IDs, current run labels, run links, and image bytes survive. Run labels and project aliases are mutable metadata; their versions may be initialized differently by a portable restore.
8. Delete the disposable project. Neither its original ID nor its aliases should be reusable for another project. Repeat the storage/rename/permission workflow with your disposable PostgreSQL and MongoDB configurations.

Focused regression cases are included for names, stale edits, alias collisions, deletion, CLI binding, permissions, and backup restore. The PostgreSQL/MongoDB suites remain conditional on their existing test database settings.

## Small dashboard improvements to consider next

These are suggestions, not additional implementations in this branch.

| Idea | Practical use |
| --- | --- |
| Pin projects and runs | Keep the current release or frequently reviewed apps at the top |
| Run notes and tags | Add “release candidate”, ticket numbers, owner, or investigation notes |
| Project description and repository link | Explain what an app covers and jump to its source |
| Reversible project archive | Remove inactive apps from daily views while retaining evidence |
| Saved filters | Return to “my app / staging / this branch / regressions” in one click |
| Copy evidence link and download image | Share or attach a specific reference/candidate/diff without hunting URLs |
| Remember table columns and page size | Let each reviewer keep the history view that suits their work |
| Copy a rerun command | Generate the existing CLI command from a run's recorded, non-secret settings |

Prioritize pins, notes/tags, and saved filters for daily flexibility. An external object-storage adapter is a separate, larger option if database image capacity becomes the constraint.
