# Phase 4 — workspace user administration

P04 adds a searchable administrator directory, account details, disable/restore, explicit Workspace Admin promotion/demotion, password reset, and session/upload revocation. It is on `codex/team-administration-p04`, stacked on the completed P03 branch `codex/team-invitations-p03` (PR #23). PR #24 tracks the earlier P03 snapshot and is not the Phase 4 base.

The deployment still has one workspace. Workspace Admin is the existing `admin` role and can manage every project; this phase adds no platform-wide super-admin, multi-tenant workspace, public registration, account merge or permanent deletion. Disable an account to remove a person while retaining their attributable history.

## Configuration and startup

**No new environment variables, Google secrets or callback URLs are required.** Retain [P03 configuration and startup](TEAM-INVITATIONS.md), including the chosen `VISUALGUARD_USER_ADMISSION=invite|legacy`, public URL, database and existing Google client configuration. From a terminal with those settings loaded:

```sh
pnpm platform:dev
```

For a production-style source server:

```sh
pnpm platform:build
pnpm platform:start
```

Use Node 22.12+. SQLite supports all administration features without an external database. PostgreSQL and transaction-capable MongoDB also support them. Standalone MongoDB in explicit `legacy` admission mode keeps existing sign-in, evidence/review and publishing workflows; the directory is readable, but new managed account creation and lifecycle changes report unavailable instead of partially updating accounts/credentials/audit. Local owner and offline CLI workflows remain unchanged; the hosted administration panel is hidden in local owner mode.

Back up storage, stop older dashboard instances and deploy P04 consistently across all instances before using these controls. Older instances do not participate in the shared administrator guard or issue version-bound upload credentials. Mixed-version administration cannot provide the new concurrency guarantees. Existing user IDs, external identity mappings, memberships and review events do not require a destructive rewrite.

## Directory and account details

1. Sign in as a workspace administrator and open **People & integrations → Workspace accounts**.
2. Search by name, email or canonical account ID. Filter workspace role and active/disabled status, then choose **Search**.
3. Use **Load more accounts** for additional results. Each page returns at most 50 accounts, with a maximum of 200 scanned records for a sparse filter. An empty page can still have a continuation button.
4. Choose **Manage [person]**. Details show sign-in methods, workspace role, enabled state and explicit project memberships. Membership details also paginate in pages of 50.
5. An administrator's implicit access to all projects is shown separately from explicit project memberships. Project roles remain viewer/reviewer/maintainer. The project-access account selector has its own name/email search so people beyond the first directory page can be selected.

Only administrators can read the workspace directory and other users' details. Project maintainers, reviewers and viewers cannot administer workspace accounts. Responses include a concurrency `version`, but omit password hashes, auth versions, provider subjects/identity keys, browser session IDs and credential secrets. Legacy identities without a migrated provider mapping are labeled company login (legacy), rather than inferring their provider from email.

## Test each lifecycle feature

All lifecycle actions show their effect and require an explicit confirmation checkbox. A password administrator must enter their **current administrator password**, not the target person's password. An administrator without a password needs an OIDC-authenticated session created within the last five minutes; sign out and sign in again if prompted. Passwords are cleared after actions and are never stored in browser storage or audit details.

### Create a member

Expand **Create a password member account**, enter name/email/initial password, and submit. The account starts as a member without project access. Share the password privately. Google users should join through invitations instead.

The create-account endpoint no longer directly grants administrator access. To make someone an administrator, create or invite the member, then use the separate promotion action below. Creation requires an active administrator session and action token; lifecycle changes additionally require recent authentication.

### Disable and restore

1. Manage a member and choose **Disable account**. Read the workspace-wide consequences, provide your proof, check confirmation and submit.
2. In that member's existing browser, refresh a protected page: access is denied. Their password/Google login cannot bypass the disabled flag. Their owned CI upload credentials also stop working across projects.
3. Inspect the account: memberships and historical review authors remain stored. New project grants to the disabled account are rejected.
4. Choose **Restore account** and confirm. The person can sign in again using retained methods and regains stored project memberships. Old browser sessions and upload credentials stay revoked; CI must obtain fresh credentials from an authorized session.

Disabling differs from removing a project membership: disabling blocks the entire workspace, while membership removal concerns one project. F03 review decisions become pending while their author lacks eligible access; restoration can make those stored decisions effective again. The UI states this consequence. Permanent invalidation/reapproval policies remain outside this phase.

### Promote and demote

1. Manage an existing member, choose **Promote to administrator**, and confirm with recent authentication. The person must sign in again and can then manage the workspace and access all projects.
2. From another administrator, choose **Demote to member**. The target's current sessions and upload credentials are revoked; after signing in again, only explicit project memberships apply.
3. Verify that your own account offers neither disable nor demote. The server enforces this even if a request is submitted manually.
4. With two administrators in separate browsers, try disabling or demoting one another concurrently. One action can win; the loser must refresh/sign in again. At least one active administrator remains.

An enabled administrator must remain. Disabling/demoting, restoring/promoting, initial administrator bootstrap, and invitation authority checks share a transactional workspace guard, preventing MongoDB snapshot write-skew and cross-instance eligibility races. Disabled administrators do not count as active. Environment bootstrap remains initial setup only; changing its email cannot create a replacement administrator after setup.

### Revoke sessions and upload credentials

Choose **Revoke sessions & upload credentials** and confirm. The account remains enabled, but all existing browser sessions and owned upload credentials are revoked. The person can sign in again and mint newly permitted credentials. You may revoke your own sessions deliberately; the browser then returns to sign-in.

Administrative role changes, disabling/restoring and password reset also rotate the target's auth version and revoke its sessions/upload credentials. New upload credentials carry their owner's auth version, so a credential minted concurrently with revocation cannot escape it. Legacy credentials without that field are removed in the transaction. Restoration never resurrects either type. Upload credentials remain unable to browse/administer the dashboard; member-owned publishing also rechecks current project-maintainer eligibility.

### Reset an existing password

Choose **Reset password** for a password account, enter your current administrator password (or use recent OIDC proof if your own account has no password), and enter the target's new 12–256 character password. Confirm, then verify that the old password and sessions fail and the new password works. Share the replacement privately; no email is sent.

This action cannot add a new password credential to a provider-only canonical account. Provider credential recovery remains with the identity provider; Google linking remains a distinct proof-of-both-accounts operation.

## API contract changes

| Route                                        | Contract                                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users?query=&role=&status=&after=` | Administrator directory; up to 50 safe users, optional next `after`, and `administrationAvailable`                                  |
| `GET /api/users/ID?after=`                   | Safe user/version/sign-in methods and up to 50 explicit memberships; cursor must belong to this account                             |
| `POST /api/users`                            | Member creation only; administrator session + action token; `role=admin` returns 400                                                |
| `PATCH /api/users/ID`                        | Required `expectedVersion`; `disabled`, `role`, or password reset; optional `currentPassword`, required for password administrators |
| `POST /api/users/ID/revoke-sessions`         | Required `expectedVersion`, administrator proof and action token; revokes browser sessions and owned upload credentials             |

Obtain the target's `version` from a fresh directory/detail response. A stale target returns 409; refresh details and explicitly retry rather than silently overwriting another administrator's action. Missing version/invalid schema returns 400; missing session 401; denied authority/origin/CSRF 403; stale authentication 401; unsupported transactional storage 503. Upload credentials cannot use these routes. Existing generic JSON size, host/origin and no-store controls apply.

For lifecycle requests, the HTTP layer validates the administrator's password or recent OIDC proof, then the transaction rechecks their enabled admin account, exact session, auth version and proof age. Actor account/session writes fence concurrent demotion, disable, logout and credential changes. The target version is checked before intentional actor guard writes, allowing safe self-session revocation without a false stale-version failure.

## Atomicity and storage

`administrator-guard/workspace` is a schema-v1 record in the existing state store. Unsupported versions fail closed. Administrator mutations touch this guard before account/session checks, target updates, credential removal and audit. Bootstrap and invitation transactions use the same ordering. SQL uses the existing transaction boundary; MongoDB uses a snapshot/majority transaction with writes to authority records, not just snapshot reads. Transient conflicts get a bounded retry; a stale requested target version still fails.

The target's role/disabled/password change, auth-version rotation, deletion of owned browser/upload credentials, and audit event commit together or all roll back. Audit captures actor/target IDs, before/after role and enabled state, a password-reset flag and revocation consequence; it never includes raw passwords, hashes or token values. Credentials are processed in bounded pages. Session rows arriving after a revocation snapshot still carry the older auth version and cannot authenticate.

Keep a tested password administrator and native database backups for recovery. This phase prevents ordinary loss of the last administrator, but does not ship emergency recovery commands, permanent account erasure, a new audit UI, automatic email delivery, or a full rolling-upgrade/recovery operator workflow. Those operational rollout items remain P05 where applicable.

## Focused validation

On 16 October 2026, Node 22.14, PostgreSQL 17.5 and MongoDB 8.3.4 were used for 12 targeted suites: **314 tests passed**, with **22 intentional backend-specific skips**. These cover the existing authentication, identities, invitations, reviews, publishing, project and host contracts as well as new administration tests. Mongo-only snapshot cases skip other adapters, PostgreSQL/MongoDB administration race cases skip other adapters; the in-memory evidence fake skips physical project deletion.

New coverage includes concurrent cross-demotion/disable, stale target versions, authority/session revocation after Mongo snapshot reads, rollback after credential deletion, paged credentials and directory filters, current-password/recent-OIDC proof, cross-project role isolation, provider-only reset rejection, in-flight token invalidation and F03 history/effective decisions after disable/restore. The dashboard UI build passes. Real-browser checks cover the management and confirmation screens. Live Google consent/browser testing still requires operator credentials from the preceding phases.

During merge cleanup, the operator authorized formatting, lint, and type checks. All passed, alongside the dashboard build and a fresh run of the same 314 tests with 22 intentional skips against the reviewed P01–P03/released dashboard baseline. P05 is the remaining operational rollout phase.
