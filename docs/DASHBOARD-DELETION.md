# Delete dashboard projects and runs

This extension adds permanent deletion to the standalone dashboard. Project maintainers, workspace administrators, and the local workspace owner may delete evidence. Viewers, reviewers, and CI upload credentials may not. The API checks permissions and the action token independently of whether a button is visible.

## Delete one run

1. Open **Run history**, select the project, and open the run.
2. Select **Delete run** beside the comparison-viewer button.
3. Read the confirmation, type `DELETE`, then select **Permanently delete run**.

The run disappears from history, its project count updates, and its detail, manifest, and artifact URLs stop working. The project and other runs remain. Cancel and Escape dismiss the dialog before submission. The dialog cannot be dismissed while deletion is in progress.

The original `.visualguard/runs/...` output on the machine that ran the tests remains available. Importing or publishing that evidence again creates a new dashboard entry; completed upload-session state associated with the removed run is cleared so it does not return a stale run URL.

## Delete a project

1. Open **People & integrations**.
2. Under **Project access**, select the project.
3. Scroll to **Delete project** and select **Delete project**.
4. Review the number of stored runs, type the exact project ID, and select **Permanently delete project**.

This removes the project, all its runs, project memberships, project upload credentials, and associated upload sessions/files/chunks. Workspace accounts and deletion audit events remain. Other projects and their access remain.

If the run count changes after the confirmation was opened, the server rejects the request. Cancel, refresh the page, and review the new count before confirming again.

Deleted project IDs stay reserved in that database. A future project must use a new ID. This prevents old credentials or an in-flight upload/access change from inheriting a recreated project's identity. Restoring a backup containing a deleted project ID requires a fresh destination database/workspace; deleting a project is not an account reset or a reversible archive.

## Evidence cleanup and concurrency

Cleanup considers artifact references across **all** projects. Removing one run does not remove an image/DOM object that another run needs. Active upload file records also retain their evidence until that upload no longer needs it or expires. Existing F01 filesystem objects are supported in SQLite/PostgreSQL workspaces with their configured legacy `objects/` directory.

Deletion queues candidate hashes durably, then attempts a bounded batch of up to 1000 candidates. If cleanup is interrupted or an object is still in use, the successful deletion response displays a cleanup-pending notice. Subsequent deletions retry queued candidates. There is no background scheduler or automatic time-based run retention in this extension. Unrelated abandoned objects are not swept blindly.

SQLite uses its transaction serialization. PostgreSQL dashboard transactions share an advisory lock so run publication, object writes, and cleanup cannot remove committed evidence out from under each other. MongoDB uses atomic per-object publication references and generation-specific object chunks without requiring replica-set transactions. Older MongoDB objects remain readable. Conservative publication references left by an interrupted process can retain bytes rather than risk deleting evidence; investigate persistent cleanup queues before any manual database cleanup.

MongoDB project deletion blocks new publication while its steps complete. An interrupted project deletion can leave a project visible with fewer runs; an administrator can refresh and submit deletion again with the current count. A stale-count rejection before deletion starts removes that temporary block. Do not manually recreate a reserved project or remove its tombstone to bypass this behavior.

Deploy the same dashboard version to all writers before using deletion. An older running server/importer does not participate in the new publication/cleanup protections. This extension does not erase database-native backups, exported portable files, or evidence already downloaded by a browser.

## API contract

Both routes require a browser session (or the local workspace action token), the `x-visualguard-platform-token` header, and JSON content type:

| Request | JSON body |
| --- | --- |
| `DELETE /api/runs/RUN_UUID` | `{ "confirmation": "RUN_UUID" }` |
| `DELETE /api/projects/PROJECT_ID` | `{ "confirmation": "PROJECT_ID", "expectedRuns": 3 }` |

The browser asks users to type `DELETE` for a run, then submits that run's immutable UUID. Project requests submit the typed project ID and displayed run count. Incorrect confirmation returns 400; missing permission/action token returns 403; a missing entry returns 404; a changed project count returns 409.

A successful response contains `runs`, `artifactsDeleted`, and `cleanupPending`. Run counts describe removed entries; artifact counts describe cleanup work in that request, potentially including previously queued candidates. A `run.deleted` or `project.deleted` event records the actor and result when audit storage is available. An audit-write failure is logged without misreporting an already-completed deletion as failed.

## Manual walkthrough for this change

No build, format, lint, type-check, browser check, or test was run for this extension, as requested. Focused regression cases were added to the existing storage/access test files for later execution. The earlier walkthrough's validation record applies to the dashboard before this extension.

To inspect the changed source UI, start `pnpm platform:dev`. An already-built dashboard or installed tarball must be rebuilt/repacked by you before it contains these controls; this change does not regenerate distribution files.

Use disposable projects and follow this sequence:

1. Import the same run into two projects so they share screenshot bytes. Open both and confirm the evidence is present.
2. Open the first run's deletion dialog. Try a wrong confirmation, Cancel, and Escape; each should preserve the run.
3. Confirm deletion. Check the first project's count and the deleted run's old URL. Open the second project's run and images; they should remain available.
4. Import/publish the deleted run again into the surviving first project. It should create a new entry with a working URL.
5. Give a member viewer access, then reviewer access. Neither role should see deletion controls; a direct deletion API request should be denied. A maintainer should be able to delete.
6. Create a project upload token and a pending upload. Delete that project. Confirm it disappears, the old token is unusable, and another project's token still works.
7. Open a project deletion dialog, publish another run elsewhere in that same project, then submit the old confirmation. Expect a count conflict. Refresh and confirm the new total.
8. Delete an empty project. Attempt to create/import into its old ID; expect a conflict. A fresh ID should work.
9. Repeat with local SQLite, PostgreSQL, and MongoDB. Include a legacy F01 workspace if your organization still has one.
10. Export evidence before deletion and restore it into a new local workspace to check the independent recovery path.

See the [full standalone dashboard walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for setup, imports, package installation, database selection, backups, and hosting.
