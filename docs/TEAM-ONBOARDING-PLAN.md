# Google sign-in, invitations, and user administration

**Status:** phased implementation starting 16 October 2026; see the delivery phases below for the current boundary. The original planning commit contained no onboarding implementation.
**Prepared:** 15 October 2026.
**Roadmap:** an extension of [F02 identity and permissions](ORGANIZATION-GROWTH-PLAN.md#62-f02--identity-permissions-and-accountable-actors), integrated with [F03 collaborative review](COLLABORATIVE-REVIEW.md).
**Implementation branches:** `codex/team-onboarding` for P01; P02 is stacked on it as `codex/team-onboarding-p02` while PR #20 remains open. P03 is stacked on P02 as `codex/team-invitations-p03` while PR #21 remains open. P04 is stacked on completed P03 as `codex/team-administration-p04`. P01 began from updated `main` after PR #13 merged. Keep implementation, documentation, and focused tests together for each feature commit. The original plan and phased delivery update precede implementation commits.

The operator explicitly authorized formatting, lint, and type checks for the 16 October PR review/merge cleanup. Each reviewed phase records its updated validation in its feature guide; live Google authorization remains an operator pilot.

## Delivery phases agreed on 16 October 2026

The user requested Google sign-in first, on a separate branch from merged `main`. Deliver a small Google pilot using the existing single-record identity/session flow before the transactional invitation work. This does not complete the full T03 admission-policy milestone or change its dependencies.

| Phase            | Scope                                                                                                                                                                   | Boundary / completion evidence                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01, implemented | Google sign-in, complete configuration validation, a named login entry point, safe retry after provider errors, exact callback setup, and focused protocol/access tests | Retain current project-role assignment. New Google members have no project access. Real Google pilot needs operator credentials.                                                                          |
| P02, implemented | Transactional identity foundation and explicit linking (identity boundary of T01/T02)                                                                                   | Preserve legacy actors and IDs; SQLite/PostgreSQL/MongoDB replica-set rollback/uniqueness races tested. Existing account ownership cannot be merged by email. Invitation-specific guards remain P03 work. |
| P03, implemented | Invitation management and recipient acceptance (remaining T03/T04/T05)                                                                                                  | Add invite-only admission with migration controls; implement copyable single-use links and atomic membership grants.                                                                                      |
| P04, implemented | Workspace user administration (T06)                                                                                                                                     | User lifecycle, role management, revocation, and last-admin protection with focused tests.                                                                                                                |
| P05, code implemented; rollout sign-off pending | Operational rollout (T07)                                                                                                                          | Audit UI, host-side recovery, bounded readiness inventory and native-backup/runbooks. Real Google pilot, live deployment and release permission sign-off remain operator gates.                             |

P01 is an administrator-managed pilot: it retains the existing ability to create a signed-in member with zero project access. It is not the invitation-only release described below. Keep local/offline access unchanged and preserve generic company OIDC behavior. Use the existing `VISUALGUARD_OIDC_*` names rather than introducing duplicate Google credential variables.

P01 implementation and setup: [Google sign-in guide](GOOGLE-SIGN-IN.md). On 16 October 2026, 45 focused authentication tests and the dashboard UI build passed. Operator-supplied Google credentials are still required for the live browser pilot. Formatting, lint, and type checks were deferred during initial implementation.

P02 setup, migration and validation: [Google account linking](GOOGLE-ACCOUNT-LINKING.md). On 16 October 2026, 138 focused tests passed against SQLite, PostgreSQL, a MongoDB replica set and standalone compatibility; three non-Mongo executions of the MongoDB-only snapshot test were intentionally skipped. The UI build passed. New external users on transaction-capable stores use opaque canonical IDs; password and legacy actor IDs remain unchanged. This phase adds no application environment variables and does not implement invitations, pending-invite indexes, project-deletion guards, or workspace last-admin administration ahead of their phases.

P03 setup, migration, manual checks, storage and limitations: [Invitations and admission](TEAM-INVITATIONS.md). On 16 October 2026, 234 focused tests passed across SQLite, PostgreSQL, a MongoDB replica set and standalone compatibility, with 16 intentional backend-specific skips (Mongo-only snapshot scenarios and the in-memory fake's evidence-deletion scenario). The UI build passed. Real-browser invitation creation, fragment removal, existing-password verification and acceptance were checked against a disposable local workspace. Only `VISUALGUARD_USER_ADMISSION=invite|legacy` is new; use the existing Google client credentials. Live Google browser acceptance still needs operator credentials. Expanded admin/last-admin controls remain P04; formatting, lint and type checks were deferred during initial implementation.

P04 setup, manual checks, API changes and storage guarantees: [User administration](USER-ADMINISTRATION.md). The searchable directory, role changes, disable/restore, password reset, session/upload revocation and shared last-admin guard are implemented together. The focused live-adapter run passed 314 tests with 22 expected backend-specific skips; the UI build passed. No new application environment variables are required. Operational recovery/audit rollout remains P05. Formatting, lint and CLI/platform type checks passed during the authorized merge cleanup, together with a fresh 314-test live-adapter run and the UI build.

P05 implementation is now grouped as one **Workspace operations** feature: audit history (P05-A), host-side administrator recovery (P05-B), and rollout readiness/runbooks (P05-C). See [the implementation plan](WORKSPACE-OPERATIONS-PLAN.md). Real Google pilot evidence, live deployment and release permissions remain operator sign-off gates rather than implied automated-test results.

## 1. Intended outcome and release boundary

An administrator can invite a colleague to a project with a specific role. The colleague follows the link, proves their identity with Google, accepts the invitation, and sees only permitted projects. Administrators can inspect membership, change roles, disable users, and revoke sessions. Existing review authorship remains intact when access changes.

The first release serves one workspace per deployment. The existing Workspace Admin fulfills the requested super-admin responsibility within that workspace. A platform operator controlling multiple independent customer organizations requires a separate tenancy design and is outside this release.

PR #13 remains the F03 review feature. Its feedback fixes and this planning document can land independently of onboarding implementation. Do not add Google login, invitations, or schema changes to that PR as part of implementing this plan.

### Included in the first release

- Google as the first fully documented and manually validated OIDC provider, using the existing server-side authentication library.
- Invitation-required admission for new hosted workspaces, with explicit migration for existing OIDC deployments.
- Administrator-created invitations bound to one email, one project, and one project role.
- Copyable links, expiration, cancellation, replacement links, and a list of pending/accepted/cancelled/expired invitations.
- Explicit identity linking for existing accounts, preserving user IDs and review attribution.
- User directory, project access management, disabling/restoring accounts, and session revocation.
- Audit records, storage contracts, negative permission tests, and local/team walkthroughs.

### Deferred

Automatic invitation emails, login-by-email magic links, public registration, domain-wide automatic admission, multiple workspaces, a platform-wide super-admin role, SCIM, SAML, bulk provisioning, approval quorums, baseline promotion, release gates, and permanent account erasure. An invitation is an onboarding authorization, not a passwordless login credential.

## 2. Existing implementation to extend

| Area                                   | Current behavior                                                                                      | Planned change                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server/auth.ts`                       | Password accounts; generic OIDC; sessions; account disabling; account-wide `authVersion`; role checks | Separate external identities from canonical users, add admission rules and explicit account linking                  |
| `AuthService.beginOidc` / `finishOidc` | Authorization-code exchange, PKCE, state, nonce; automatic OIDC account creation                      | Retain protocol checks; bind onboarding intent to the login attempt; stop uninvited auto-creation in invitation mode |
| Users                                  | Password IDs derive from email; OIDC IDs derive from configured issuer and subject                    | Preserve all existing IDs; use opaque IDs for new users and identity mappings for future sign-ins                    |
| Memberships                            | `userId:projectId`, with Viewer/Reviewer/Maintainer roles                                             | Keep project role semantics and add transactional invitation acceptance                                              |
| `client/settings.tsx`                  | People, project access, password-account creation, upload credentials                                 | Add Invitations and improve user lifecycle controls                                                                  |
| `server/http.ts`                       | Session, host/origin checks, action-token checks, account and membership APIs                         | Reuse these controls for onboarding routes and admin mutations                                                       |
| `server/reviews.ts`                    | Current reviewer eligibility, persisted actors, decisions, assignments                                | Reuse current eligibility rules and preserve historical authorship                                                   |
| Storage                                | SQLite/PostgreSQL SQL adapters and MongoDB; versioned single-record state operations                  | Add atomic operations for identity linking, invite acceptance, and administrator lifecycle                           |

Current OIDC sign-in can create a user without project access. It is not invitation-only onboarding. Password and OIDC identities with the same email currently produce different user IDs; do not merge these accounts implicitly.

The CLI, offline capture, local report, local dashboard owner, and project-scoped CI uploads remain supported. Existing upload tokens never become login, invitation, or user-administration credentials.

## 3. Roles and authority

| Capability                                             | Workspace Admin                                           | Project Maintainer               | Reviewer          | Viewer            |
| ------------------------------------------------------ | --------------------------------------------------------- | -------------------------------- | ----------------- | ----------------- |
| Read project evidence and review history               | All projects                                              | Assigned projects                | Assigned projects | Assigned projects |
| Comment, assign checks, decide/withdraw visual changes | Yes                                                       | Yes                              | Yes               | No                |
| Manage existing memberships and upload credentials     | All projects                                              | Own projects, per existing rules | No                | No                |
| Create/cancel onboarding invitations                   | Yes                                                       | Deferred                         | No                | No                |
| List all workspace users and invitations               | Yes                                                       | No                               | No                | No                |
| Disable users or revoke their sessions                 | Yes                                                       | No                               | No                | No                |
| Grant/revoke Workspace Admin                           | Yes, with recent authentication and last-admin protection | No                               | No                | No                |
| Link a Google identity                                 | Own account only, with recent authentication              | Own account                      | Own account       | Own account       |

Project roles remain cumulative. Workspace Admin is the existing `admin` role, not a new database role named `super_admin`. Project Maintainer does not gain authority over workspace accounts or Google configuration.

Ordinary invitations create member accounts with a project role; they cannot grant Workspace Admin. Promote an accepted member through a separate audited admin action. Preserve the existing self-disable/self-demotion guard and also prevent concurrent operations from removing the final active administrator.

## 4. User journeys

### A. Invite a new Google user

1. Admin selects a project, chooses Invite user, enters an email and project role, and sees the expiry.
2. Server validates authority, email, role, project existence, and duplicate pending invitations.
3. Admin receives a copyable link once and shares it through their existing communication channel. No email is sent by this release.
4. Recipient opens the invitation page, sees a sign-in prompt, and chooses Continue with Google.
5. Callback validates identity and the server-side onboarding attempt. A verified email must match the invitation target.
6. Recipient sees the workspace/project, role, and expiry, then explicitly accepts.
7. Acceptance atomically binds the identity, creates/reuses the canonical user, grants membership, records acceptance and audit, and commits.
8. A normal session is issued after commit and the browser opens the permitted project's history.

A copied or forwarded invitation link alone cannot sign in or grant access. The wrong Google account gets an account-switch path without consuming the invitation.

### B. Invite an existing account

An existing user signs in to their existing account and accepts after recent authentication. Adding Google to an existing password account is a distinct Link Google action requiring proof of both identities. Matching email text alone must not merge accounts, assign an existing user's historical decisions, or transfer credentials.

If a verified Google email matches a legacy account but no identity link exists, explain that the user must sign in using the existing method and link Google. If they cannot, an administrator can revoke access and issue a new membership for a separately verified account; historical actors remain separate. Automatic history reassignment is out of scope.

Acceptance must not downgrade an existing higher project role. Return an explicit already-authorized result; an administrator can make an intentional downgrade separately. Disabled accounts remain disabled until an administrator restores them.

### C. Existing member signs in

An already-linked Google identity opens its canonical account. It needs no new invitation. Every request still checks the current user state and project membership; a valid Google identity does not override local revocation. Changing the account's email does not change its canonical user ID.

### D. Remove or restore a colleague

Removing project access denies that project's evidence and mutations on subsequent requests. Disabling a workspace account denies password/OIDC login, invalidates active sessions and owner-bound upload credentials, and makes the person ineligible for new assignments. Preserve comments, decisions, audit entries, and actor IDs.

An existing assignment remains visibly unavailable. F03 decisions retain their current semantics: while their author lacks reviewer access, the effective decision is pending; restoration can make the historical decision effective again. Show this consequence in admin UI. Permanent invalidation and reapproval policies belong to later policy work.

## 5. Google authentication contract

Use the existing `openid-client` server flow. Retain code exchange, PKCE, state, nonce, and library validation of signed claims. The external identity key is the validated issuer plus `sub`, not email. Require verified email when matching an invitation. If a future Workspace-domain restriction is enabled, validate `hd`; email suffix matching is insufficient. Google documents these identity distinctions in its [OIDC guide](https://developers.google.com/identity/openid-connect/openid-connect).

Keep callback URLs exact and redirects constrained to the configured application origin. Bind sign-in and linking attempts to the initiating browser, intended operation, invitation identifier/version when applicable, and a short expiry. Reject replayed attempts. The existing use of state/PKCE and restricted redirect handling should be maintained against [OAuth security best current practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html).

Product decisions for this release:

- Request only `openid email profile`; do not request Drive, Gmail, offline access, or refresh tokens.
- Keep the client secret on the server and omit provider tokens/codes from logs, API responses, and database audit payloads.
- Use one canonical configured Google issuer and the library's validated issuer handling. Do not turn aliases into different identities or weaken issuer validation manually.
- Google configuration uses the existing `VISUALGUARD_OIDC_ISSUER`, `VISUALGUARD_OIDC_CLIENT_ID`, and `VISUALGUARD_OIDC_CLIENT_SECRET` settings.
- Proposed new setting: `VISUALGUARD_USER_ADMISSION=invite|legacy`. Validate it at startup; final naming is part of implementation documentation.
- New hosted installations default to invitation admission. Existing installations must explicitly choose a migration path before upgrading; do not silently lock out existing users or preserve open registration by accident.
- Existing admin bootstrap remains available for recovery. Once a user exists, ordinary provider callbacks cannot promote, restore, or re-enable them from environment settings.
- Login UI shows a clear Google entry point only when fully configured and reports setup errors without exposing credentials. Password login remains available for existing users and the recovery admin.

### Deployment setup to document

Create a Google OAuth web client and consent configuration appropriate to the deployment. Register the exact callback `<VISUALGUARD_PUBLIC_URL>/api/auth/callback`, store credentials in the host's secret mechanism, and configure the intended audience/test users before the pilot. Verify the active Google configuration screens during implementation; provider setup can change.

For local manual tests, consistently use `http://127.0.0.1:4400` and its exact registered callback. Hosted environments use HTTPS. Confirm Google accepts the chosen local URI during setup; use a supported localhost URI consistently if required. Never mix `localhost` and `127.0.0.1` in one authentication session.

## 6. Invitation contract

| Property             | Proposed behavior                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Scope                | One deployment/workspace, target email, project ID, and project role                                                         |
| Default lifetime     | 72 hours; admin-selectable up to 7 days; server time is authoritative                                                        |
| Secret               | At least 256 random bits; only its hash is persisted                                                                         |
| Presentation         | Raw link returned once; listings never return or reconstruct it                                                              |
| Reissue              | Cancel old pending invitation and generate a new secret/record; no reusable old link                                         |
| Duplicate            | One pending invitation per normalized email/project; create races return 409 or the existing non-secret metadata             |
| Role update          | Cancel/reissue, or a separate existing-member role operation; never mutate a recipient's already-viewed invitation silently  |
| Consumption          | Explicit authenticated POST; opening a URL or an email scanner's GET cannot consume it                                       |
| Expiry               | Enforced on every preview/login handoff/acceptance; independent of background pruning                                        |
| Acceptance authority | Recheck inviter is an active admin, project exists, invitation is pending/current, recipient matches, and account is enabled |
| Revocation           | Cancellation, project deletion, or inviter losing admin eligibility prevents later acceptance                                |
| Existing access      | Do not downgrade it or restore previously disabled access through an invitation                                              |

Normalize surrounding whitespace and email casing consistently with existing accounts. Do not strip dots, plus-tags, or rewrite provider-specific aliases. Email renames require a new invitation; do not broaden the accepted identity set.

Suggested link: `/invite#token=<secret>`. The browser exchanges the fragment secret through a same-origin POST, clears it from history immediately, and keeps only a short-lived opaque onboarding cookie. Do not place the secret into analytics, referrers, error reporting, or third-party page resources. Responses use `Cache-Control: no-store`; the invitation page uses `Referrer-Policy: no-referrer`.

Before login, expose only a generic sign-in prompt. After matching the authenticated recipient, disclose project/role/inviter metadata. Generate a browser-bound form/action token for pre-session onboarding requests; authenticated acceptance also uses the existing session action-token checks. Limit preview, exchange, login, and acceptance attempts with persistent cross-instance throttling.

Cancellation and acceptance race on the same versioned invitation: exactly one terminal transition wins. An accepted invitation remains consumed forever, even if the user later loses membership. Replaying its link cannot restore access. A retry of an already committed acceptance by the same recipient may return the existing receipt without granting or restoring anything.

## 7. Data model and atomic storage operations

Names below describe planned logical records, not changes already implemented.

| Record                   | Key fields / invariants                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical user           | Stable `id`, name, email, `admin` or `member`, disabled flag, auth version, created/updated times; existing IDs remain valid                                                          |
| External identity        | Unique provider/validated issuer/subject key, canonical user ID, link time; one external identity maps to exactly one user                                                            |
| Invitation               | ID, token hash, normalized target email, project, role, creator ID, created/expiry times, `pending`, `accepted`, or `cancelled`, version, accepted user/time or cancellation metadata |
| Pending-invitation index | Unique normalized email/project key, pending invitation ID/version; transactional update with create/cancel/accept/reissue                                                            |
| Onboarding attempt       | Hashed browser handle, invitation ID/version, operation (`join` or `link`), OIDC correlation, expiry, optional validated candidate identity                                           |
| Membership               | Existing `userId:projectId` key; role, update/version metadata sufficient for conflict checking                                                                                       |
| Admin guard              | One workspace guard/version touched by promotions, demotions, disabling admins, admin bootstrap, and invite acceptance authority checks                                               |
| Audit/outbox             | Operation ID, actor/target IDs, project/invitation IDs, before/after role or state, server timestamp; no secret payloads                                                              |

An expiry is a computed presentation state for pending invitations. Keep terminal invitation metadata for audit; do not use TTL deletion as the authorization decision or delete the only evidence of consumption. Define eventual cleanup separately from access enforcement.

### Required repository operations

Introduce a small onboarding/identity repository rather than chaining unrelated `StateStore.create/replace` calls from HTTP handlers:

- `createInvitation`, `cancelInvitation`, and `replaceInvitation` maintain pending uniqueness atomically.
- `acceptInvitation` validates current authority and account/project state; claims identity uniqueness; creates/reuses the user; updates membership; marks invitation accepted; removes its pending index; records audit/outbox in one transaction.
- `linkIdentity` binds one identity to one existing user after recent proof of both accounts, with a uniqueness conflict instead of an implicit merge.
- `changeAdministrator` serializes last-active-admin checks with the resulting user update and session invalidation version.
- Administrative project deletion participates in the same project guard as acceptance so a concurrent join cannot create orphan membership.

Issue a normal login session only after acceptance commits. A crash before commit grants nothing; a crash after commit can safely retry using the durable acceptance receipt. Retry transient transaction conflicts with a small bound; do not blindly replay an expired or cancelled request.

SQLite and PostgreSQL already expose SQL transactions internally; extend a transaction-scoped repository to cover all affected records. MongoDB onboarding transactions require a replica set or sharded deployment. This requirement follows [MongoDB's transaction documentation](https://www.mongodb.com/docs/manual/core/transactions/). Prove the exact cross-instance conflict/uniqueness behavior with live adapter tests before implementing public onboarding endpoints.

**Compatibility decision:** transactional onboarding on MongoDB requires a transaction-capable deployment, including a local single-node replica set for testing. Existing standalone MongoDB evidence/review workflows remain supported with onboarding disabled. Detect capabilities and explain the requirement before enabling invitations; never report success after partially writing identity or access records. Supporting invitations on standalone MongoDB would need a separately designed recoverable protocol and is deferred.

Reads used for transactional acceptance must be protected against concurrent disable/demotion/deletion, including MongoDB write-skew. Touch the relevant user/project/admin guard records within the transaction so concurrent authority changes conflict; a snapshot read alone is insufficient. Document a consistent lock/update order and test both race winners.

## 8. Proposed routes and UI

Keep the existing account and membership routes; extend their contract rather than creating a second user directory.

| Request                                                | Permission / result                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/invitations?project=...&state=...&after=...` | Admin; bounded cursor page of safe invitation metadata                                                      |
| `POST /api/invitations`                                | Admin + action token; email/project/role/expiry; returns metadata and one-time raw link                     |
| `POST /api/invitations/ID/cancel`                      | Admin + action token + expected version; 409 on concurrent transition                                       |
| `POST /api/invitations/ID/replace`                     | Admin + action token + expected version; old invitation cancelled, new link returned once                   |
| `POST /api/onboarding/exchange`                        | Same-origin browser proof + secret; establishes bounded onboarding attempt; grants no project access        |
| Existing OIDC login/callback                           | Carries server-bound join/link intent, validates identity, then returns to the matching confirmation page   |
| `POST /api/onboarding/accept`                          | Matching authenticated identity/onboarding proof + action token; consumes one current invitation atomically |
| `POST /api/auth/identities/google/link`                | Existing account + recent reauthentication + action token; begins explicit Google linking                   |
| Existing `PATCH /api/users/ID`                         | Admin + action token + expected version; role/disabled updates with last-admin and concurrency checks       |
| `POST /api/users/ID/revoke-sessions`                   | Admin + action token + recent authentication; increment auth version, audit, expire affected sessions       |

Use 400 for invalid schema; 401 for missing/expired authentication; 403 for denied roles or browser proof; 409 for concurrent/stale state; 410 for authenticated expired/cancelled invitations; 429 for throttling. Unauthenticated invalid-secret responses must not reveal whether a target account/project exists. Read-only endpoints cannot consume invitations or change membership.

### People & integrations

- Users tab: search/filter and cursor pagination; safe name/email, login methods, enabled state, workspace role, and project memberships; hide secrets/provider subjects.
- Invitations tab: target email, project, role, inviter, expiry, current state, cancellation/replacement controls; pending rows are not active users.
- Project access: preserve existing role editor, show effective cumulative access, and distinguish removal from disabling the account across the workspace.
- User details: disable/restore, revoke sessions, and explicit admin promotion/demotion with consequences and confirmation.
- Account settings: show linked Google identity and existing password method. Unlinking and changing primary credentials are deferred until recovery behavior is designed.
- Invite page: loading/sign-in/account mismatch/confirmation/success/expired/cancelled/error states; preserve context through sign-in without carrying arbitrary return URLs.

Use ordinary product language and accessible controls. Never display token hashes, auth versions, or raw provider claims in normal user flows.

## 9. Migration, rollout, and recovery

1. Merge and validate PR #13. Start the implementation branch from the resulting mainline.
2. Back up the operational database, including accounts and review history. Portable evidence exports do not contain these records.
3. Add versioned onboarding/identity storage and indexes; migration must be idempotent, resumable, and safe across concurrent server startup.
4. Preserve every existing user ID, membership, session policy, review actor ID, and upload credential binding. Do not infer issuer/subject by reversing hashed OIDC IDs.
5. For legacy OIDC users, the next validated login can compute the existing legacy ID and transactionally attach the external identity mapping to that exact account. Unknown issuer/ID combinations require explicit recovery; never guess by email.
6. Detect legacy password/OIDC accounts sharing email and report them to an admin. Do not auto-merge histories or grant their combined permissions.
7. Existing installations inventory linked users and admission mode before switching to invitation-only. Unknown identities cannot become admins merely by matching a configured bootstrap email after setup.
8. Keep a tested local password recovery admin. Never allow the final active admin to be disabled, demoted, or made unable to authenticate by configuration changes.
9. Pilot with one project and two invited users. Enable Google/admission controls only after storage, browser, and permission acceptance criteria pass.
10. Rollback disables new onboarding actions while keeping durable consumed invitations and identity mappings. Never delete accepted-token records or reactivate old links. If older binaries cannot interpret linked canonical users, restore a coordinated database snapshot or use a forward compatibility release; do not blindly downgrade production.

Membership changes must take effect on subsequent authorized requests without waiting for a session's nominal lifetime. Disabling increments account auth version and denies owned upload credentials; integration tests must verify both paths. Audit reasons distinguish project removal, account disabling, session revocation, and admin role changes.

Document secret rotation, provider outage behavior, bootstrap recovery, native backup/restore, invitation cancellation, and Google client replacement. A provider outage must not admit an unverified user; existing valid sessions follow their current expiry/revocation rules.

## 10. Implementation sequence

Each row is its own feature commit with its documentation and focused tests. Keep the plan as the preceding documentation commit. UI and API for a row should be usable together; do not enable an unfinished admission mode.

| Step | Deliverable                                                                                    | Acceptance evidence                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| T01  | Transactional onboarding repository, guards, versioned records, migration/capability detection | Atomic success/rollback, identity and pending-invite uniqueness, race tests on all supported onboarding backends    |
| T02  | Canonical identity mappings, legacy-ID continuity, explicit Google linking                     | Existing authorship unchanged; no email-only merge; concurrent link creates one binding                             |
| T03  | Google provider setup and admission policy behind disabled-by-default rollout controls         | Mock-provider validation and real Google loopback pilot; unknown identities denied in invitation mode               |
| T04  | Administrator invite creation/list/cancel/replace and copy-link UI                             | Expiry/role validation, one-time secret visibility, paginated listings, duplicates/cancellation races               |
| T05  | Recipient exchange/login/confirmation/atomic acceptance journey                                | Correct account joins; wrong/replayed/expired/revoked links grant nothing; crash/retry tests                        |
| T06  | User directory, role changes, disable/restore and session revocation controls                  | Cross-project permissions, concurrent last-admin protection, session/upload revocation, F03 eligibility integration |
| T07  | Audit presentation, recovery/runbooks, compatibility controls and release walkthrough          | Native restore exercise, legacy migration pilot, local/offline smoke, deployment documentation                      |

T01-T03 remain inert for invitations until T04/T05 complete. Google linking can be piloted for existing accounts before enabling invitation admission. T06 may ship independently after T01/T02, but the release is not complete until the recipient journey and recovery work pass.

Estimate after T01's storage proof: roughly 3-5 engineer-weeks for implementation and focused integration validation, assuming an available Google client and transaction-capable databases. This is an estimate, not a delivery commitment; a tenancy expansion or email service would change scope.

## 11. Focused automated validation

Use a local fake OIDC issuer for deterministic tests and real Google only for a small manual pilot. Do not make every regression depend on external accounts.

| Boundary          | Required cases                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OIDC              | Invalid issuer/audience/signature/expiry, missing subject, nonce/state/PKCE failure, callback replay, provider error, wrong browser, arbitrary return URL rejected                                                              |
| Invitations       | Empty/malformed payloads, target mismatch, unverified email, normalized case, aliases not rewritten, expiry boundary, one-time use, duplicate pending create, cancellation/replacement races                                    |
| Acceptance        | Two browsers accepting once, same identity joining different projects, one identity linking to two users, rollback at every write, retry after successful commit, simultaneous project deletion/admin removal/account disabling |
| Existing accounts | Password-to-Google linking requires both proofs; disabled user not restored; existing higher membership not downgraded; email collision does not merge histories                                                                |
| Administration    | Viewer/Reviewer/Maintainer cannot manage workspace users/invites, outsider cannot enumerate projects, CI tokens denied, two admins concurrently demoting/disabling each other preserve an active admin                          |
| Sessions          | Logout and explicit revocation, disabled user denied on next request, role changes reflected without relogin, owner-bound upload credentials denied after disabling, linking rotates affected session context                   |
| F03               | Revoked decision author becomes effectively pending, unavailable assignee stays visible, restoring role keeps documented semantics, canonical IDs preserve comments and decisions                                               |
| Storage           | Same contract on SQLite/PostgreSQL/Mongo replica set; page beyond 100 users/invites; persistence after reopening; cross-instance conflicting writes; Mongo standalone capability message                                        |
| Privacy           | No raw invitation/client/provider/session secrets in lists/audit/errors/logs; pre-login page does not disclose project/email; no referrer token leak                                                                            |
| Compatibility     | Offline CLI captures, local owner dashboard, existing password login, scoped CI upload, evidence-only export, native operational restore                                                                                        |

Run only suites relevant to each feature while implementing. Formatting, lint, and type-check commands remain deferred until after F36 unless the user changes that instruction. Feature-specific builds and focused behavior/browser tests may be used. Record actual commands/results and explicitly identify skipped live adapters and untested provider setup.

## 12. Manual release acceptance

1. Start production/staging fixtures and a disposable dashboard in login mode; import/publish a run and verify F03 still works.
2. Configure a Google web client for the exact loopback callback. Confirm existing Google-linked members can sign in and a stranger cannot join without an invitation.
3. Invite one Viewer and one Reviewer. Copy links; confirm nothing was emailed automatically.
4. Open an invite in a private browser using the wrong Google account: no access, no consumption, and an account-switch option.
5. Sign in as the correct recipient and accept: only the invited project and cumulative role permissions appear.
6. Open the accepted link again; it cannot create another account or restore removed membership.
7. Cancel a pending invitation, replace another, and let a short-lived test invitation expire; verify every old link is unusable.
8. Accept concurrently in two browser profiles; exactly one grant/receipt exists and no duplicate canonical user is created.
9. Invite an existing password user, explicitly link Google, then sign in with either method; actor IDs and existing history remain unchanged.
10. As Viewer, read evidence but attempt review/admin mutations; verify denial. As Reviewer, comment and decide but fail user-admin operations.
11. Disable the reviewer while their browser is open; next request fails, owned upload credential stops working, assignment becomes unavailable, and review history remains.
12. Restore the reviewer and verify the displayed historical decision behavior is explained correctly.
13. With two administrators, attempt conflicting demotion/disable operations; at least one active admin remains. Test documented recovery using the retained password administrator.
14. Restart two dashboard instances against the same database, test invitation/identity conflicts across instances, and reopen to verify persistence.
15. Repeat atomic acceptance/revocation tests with disposable PostgreSQL and MongoDB replica-set databases. Confirm standalone MongoDB onboarding is rejected before partial writes.
16. Restore a database-native backup and verify users, links, terminal invitation states, audit records, and reviews. Confirm portable evidence restore does not restore organizational access.

## 13. Decisions to revisit before implementation

These are recommended defaults for planning, not reasons to block PR #13:

- **Workspace scope:** single workspace; existing admin is sufficient. Revisit platform super-admin only with a separate organization-isolation proposal.
- **Invite authority:** admins only initially. Maintainer invitations can follow with explicitly bounded delegation.
- **Delivery:** copied links initially. Add an email provider as a separate feature with delivery state and cancellation semantics.
- **Lifetime:** 72-hour default and 7-day maximum; shorten for a pilot if operational needs require it.
- **Account removal:** disable/remove access; preserve historical authorship. Permanent erasure and retention need a separate design.
- **Google audience:** choose the organization's permitted Google accounts during provider setup; no automatic email-domain admission.
- **Mongo topology:** require transactions for onboarding. Supporting standalone MongoDB invitations needs its own correctness proof.
- **Existing duplicate accounts:** explicit linking/recovery only; no automatic merge tool in this release.

## 14. Definition of done

An invited colleague can join with Google, see only authorized projects, and participate according to role. Admins can control admission, revoke access, and recover administration. Expired/reused links, competing requests, disabled accounts, and project deletion cannot create unintended access. Identity continuity and F03 attribution survive migration. SQLite, PostgreSQL, and transaction-capable MongoDB pass the same acceptance contract, with unsupported configurations explained before enabling onboarding. Documentation includes local setup, hosted setup, backup/recovery, limitations, and actual validation results.

P01/P02/P03/P04 implementation and focused validation are recorded in the delivery-phase update above. P05 code and its operator procedures are documented in [Workspace operations](WORKSPACE-OPERATIONS.md). The real Google browser pilot, deployment/release sign-off and any unrecorded live-provider/native-restore acceptance checks remain outstanding. Automatic email delivery remains outside scope.
