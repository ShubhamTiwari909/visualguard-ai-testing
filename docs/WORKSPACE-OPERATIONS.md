# Workspace operations — audit, recovery and rollout

P05 combines audit history, host-side administrator recovery and rollout readiness. Its [plan](WORKSPACE-OPERATIONS-PLAN.md) precedes implementation. This is the final onboarding operations feature; F04 approved baselines and F05 named journeys follow separately. Real Google pilot acceptance and publishing/deployment sign-off are still operator tasks.

## Start and inspect

Use Node 22.12+ and this source checkout. Keep the [existing Google/invitation environment](TEAM-INVITATIONS.md); **no new application environment variables or Google secrets are required**. Load the ignored environment file explicitly from the repository root:

```sh
set -a
. apps/platform/.env.local
set +a
pnpm platform:dev
```

For a built source dashboard, use `pnpm platform:build`, then `pnpm platform:start`. SQLite supports every operation without PostgreSQL, MongoDB or an upload token. PostgreSQL and transactional MongoDB use the existing real database URL. Never export placeholder database URLs.

Sign in as an administrator, open **People & integrations**, then choose **Audit & recovery** at the top. The Workspace operations section contains:

- **Sign-in readiness:** transaction capability, admission policy, active administrators and active password administrators. An inventory scans at most 200 accounts and clearly reports incomplete counts. Duplicate normalized emails are reported without combining accounts or permissions. Unknown identity schemas require a compatible forward release, not a downgrade or record deletion.
- **Audit history:** recent account, identity, invitation, access and project activity. Filter by actor name/email, exact action and UTC dates. Load more activity uses an exclusive cursor; an empty filtered page can still have another page. Each request scans at most 200 records and returns at most 50 events. Existing audit records retain their 90-day expiry policy.

The view is available only to workspace administrators. Members, project maintainers and upload credentials cannot access its APIs. The response omits passwords, password hashes, raw tokens, provider subjects, session IDs and unexpected event fields. Existing event attribution is retained; a missing historical account is labeled Former account.

Readiness is an inventory, not production certification. Test the password administrator, native backups and live Google consent separately.

## Host-side inspection

The commands below run from the source checkout on the dashboard operator's host. They connect directly to the selected operational database; they do not log in through HTTP and do not create a bootstrap account. Use exactly the dashboard's absolute data directory/database settings. A wrong directory can select an empty workspace, so inspect status and the target before any recovery.

```sh
pnpm platform:operations status
pnpm platform:operations admins
pnpm platform:operations preview --user ACCOUNT_ID
```

`admins` lists only existing password administrators, including disabled ones, with stable IDs and record versions. If it returns `nextCursor`, repeat with `admins --after CURSOR`; an empty page can still have a cursor. `preview` is read-only and never returns a password hash. These source commands are not a claim that a newly published npm version contains recovery tooling.

## Recover an existing password administrator

Recovery is for loss of access to an existing password administrator, including a disabled administrator restored from an operational incident. It cannot create users, promote members, attach passwords to Google-only users or merge accounts. There is no HTTP recovery endpoint.

Password-file ownership and private permissions are verified on a POSIX host, including macOS/Linux. Run recovery on such an operator host connected to the same database; the command explicitly refuses Windows password-file recovery rather than claiming to validate Windows ACLs. Dashboard viewing and ordinary sign-in remain unaffected on Windows.

1. Stop all dashboard instances and other writers. Preserve the exact deployment configuration and take a **native operational database backup**, including authentication state, before proceeding. Portable evidence exports omit accounts, identities, sessions, memberships, invitations and audit records; they cannot recover administration.

2. Run `admins`, identify the intended existing password administrator by ID/email, then run `preview --user ACCOUNT_ID`. Record the returned `expectedVersion`. Do not select an account by email alone when multiple accounts share it.

3. Create a temporary password file privately, using your editor rather than a password in shell arguments/history:

   ```sh
   umask 077
   mkdir -p "$HOME/.visualguard-recovery"
   nano "$HOME/.visualguard-recovery/password"
   chmod 600 "$HOME/.visualguard-recovery/password"
   ```

   Put one new 12–256 character password in the file. The command rejects symlinks, non-regular files, files over 1024 bytes, non-owned files, broad permissions, invalid UTF-8 and additional lines. Keep the file outside the repository and away from CI artifacts.

4. Substitute the exact account ID and preview version in this command. Put no credentials in the reason; the reason is retained in audit history.

   ```sh
   pnpm platform:operations recover \
     --user ACCOUNT_ID \
     --version PREVIEW_VERSION \
     --confirm ACCOUNT_ID \
     --backup-confirmed \
     --reason "Restore access after an administrator incident" \
     --password-file "$HOME/.visualguard-recovery/password"
   ```

5. If the account changed after preview, recovery fails without partial changes. Inspect and preview again; do not retry with an invented version. SQLite, PostgreSQL or a MongoDB replica set/sharded deployment is required. Standalone MongoDB inspection remains available, but recovery fails before saving account changes.

6. Restart the compatible dashboard with the same data directory/database. Sign in using the account's retained email and replacement password. Changing `VISUALGUARD_ADMIN_PASSWORD` alone never resets an existing account; update any private operator CLI credentials separately if you use them for authenticated project creation.

7. Verify that old sessions and upload credentials fail, while retained Google linking, project memberships and historical review authorship still refer to the same account. Create fresh CI upload credentials through normal authorized controls. Remove the temporary password file after verifying access.

8. Inspect the **Administrator recovered** audit event. It records the target, host-operator origin, reason, backup acknowledgement and revocation consequences. It does not impersonate a browser administrator or retain the replacement password.

The administrator write guard, target-version check, account enable/password/auth-version update, credential revocation and audit insert share one transaction. A failed audit write rolls everything back. Recovery deliberately does not issue a browser session; the recovered person must sign in normally.

If the workspace has only Google administrators with no password credential, restore provider access or an appropriate native backup. Do not add password hashes, delete identity mappings, change historical actors or reopen admission bootstrap manually.

## Native backup and restore exercise

For **SQLite**, stop every writer and copy the entire configured data directory to a new protected backup destination outside that directory. Include the operational SQLite database and any legacy object files. If `VISUALGUARD_SQLITE_FILE` is outside the data directory, include that exact database location too. Do not copy only a live main database file while WAL writers are active.

Restore the snapshot into a **different disposable directory**, point a separate test dashboard at that directory, and keep the original deployment stopped or isolated. Verify canonical account IDs, Google mappings, memberships, accepted/cancelled invitation state, audit events and review authorship before trusting the backup. Do not test a restore by overwriting the live database. A pre-incident snapshot also restores its historical credential state: revoke affected sessions/upload credentials and cancel affected pending invitations before reconnecting the restored deployment.

For **PostgreSQL/MongoDB**, use a native, consistent database backup/restore procedure for the actual deployment, including all VisualGuard operational collections/tables. Restore into a separate database for the same acceptance exercise. An evidence export alone is insufficient. Retain deployment secrets separately through the operator's secret store; never include them in portable evidence or public bug reports.

## Compatibility and rollout gates

1. Inventory accounts, password administrators, admission mode, shared-email conflicts and transactional storage. Resolve ambiguity through proved account ownership and explicit linking; never merge by email.
2. Stop older dashboard instances before deploying onboarding/administration code consistently. Existing user IDs, memberships, review actors and consumed invitation receipts are retained. There is no destructive P05 data migration; the operations feature reads the existing versioned state store and adds normal recovery audit events.
3. Run the focused operations/auth/administration/review checks and a native restore exercise against a disposable workspace. Keep actual test results separate from checks deferred by AGENTS.md.
4. Pilot Google with a real configured web client, one project, two invited accounts and separate browser profiles. Verify wrong-account denial, explicit acceptance, expiry/cancel/replace/replay, linking continuity, Viewer/Reviewer boundaries, disable/restore and revocation. Mock-provider tests do not replace this step.
5. Rotate a Google client secret by updating the server secret configuration and restarting compatible instances. Test sign-in and invitation acceptance again; interrupted authorization attempts may need a fresh start. Provider/client replacement needs its own ownership/issuer/subject compatibility pilot. Never clear mappings to force a new Google identity onto an account.
6. During provider outages, retain ordinary password-administrator access and existing valid-session policy. Do not switch to open admission or bypass provider verification to restore access.
7. Keep unexpected project-deletion interruptions closed. Reconcile the project tombstone, evidence and access records before any operator repair; P05 recovery does not reopen guards or erase tombstones.
8. Use compatible forward fixes or a coordinated native restore rather than starting older binaries against canonical linked identities. Cancel/revoke credentials and invitations affected by rollback before reconnecting traffic.
9. Complete the live Google pilot, deployment sign-off and repository release-permission repair before calling onboarding operationally signed off or publishing its pending Changesets. This feature does not alter GitHub protections, create a release, send invitation emails or deploy a live server.

## Validation

Focused tests cover memory/SQLite audit scans, actor/date filters, redaction, HTTP authorization, unsupported capabilities/schemas, stale recovery previews, atomic audit failure, paged credential revocation, real password login/session invalidation, CLI/private-file constraints, competing recoveries and closed native SQLite restore. PostgreSQL/MongoDB recovery contracts run only when their existing test database variables are supplied; skipped live suites are not evidence of a live-adapter pass.

```sh
pnpm --filter @visualguard/platform exec vitest run \
  test/operations.test.ts test/operations-http.test.ts \
  test/operations-storage.test.ts test/operations-command.test.ts \
  test/auth.test.ts test/administration.test.ts test/reviews.test.ts
```

Formatting, lint and type checks remain deferred under the current repository instructions. Live Google pilot, real deployment, and native PostgreSQL/MongoDB restore drills remain operator sign-off gates unless separately recorded as completed.

Local validation on 16 October 2026: the seven focused suites above passed **69 tests**, with **6 explicitly skipped PostgreSQL/MongoDB recovery executions** because no live test database URLs were supplied. The dashboard UI build passed. Browser checks covered administrator navigation, actor/action filters, a 375 px viewport without horizontal overflow, and no observed browser errors. These results cover the implemented memory/SQLite paths, not a live Google pilot or an external database restore drill.
