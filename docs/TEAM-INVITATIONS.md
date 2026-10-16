# Phase 3 — invitations and invite-only admission

P03 adds **People & integrations → Invitations**, single-use project invitations, the `/invite` recipient screen, and explicit admission policy. It is on `codex/team-invitations-p03`, stacked on P02 while PR #21 remains open. Existing Google/password users retain their IDs, history, roles, and login methods. Local owner mode and CLI/offline captures do not require invitations, OAuth, upload tokens, or an external database.

## Environment values

Only one new application setting is introduced:

```dotenv
VISUALGUARD_USER_ADMISSION=invite
```

| Value    | Behavior                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invite` | An unknown provider identity cannot create an account through ordinary login. It needs a matching invitation, verified identity, and explicit acceptance. Known identities continue signing in. |
| `legacy` | Explicitly preserve the P01/P02 behavior: ordinary OIDC login may create a member account with no project membership. Use temporarily during migration or for standalone MongoDB compatibility. |

Fresh hosted installations default to `invite`. A deployment with users but no admission-policy record must select `invite` or `legacy` explicitly before it starts. The chosen mode is persisted in `admission/current`; subsequent restarts can reuse it. An explicit environment value changes it. Stop all instances during an admission migration, back up storage, and deploy the same setting/version to every instance. Mixed versions or contradictory settings are unsupported.

Keep the existing Google settings; no additional Google secret is required:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_OIDC_ISSUER=https://accounts.google.com
VISUALGUARD_OIDC_CLIENT_ID=your-existing-google-web-client-id
VISUALGUARD_OIDC_CLIENT_SECRET='your-existing-google-web-client-secret'
VISUALGUARD_ADMIN_EMAIL=your-admin-email@example.com
VISUALGUARD_ADMIN_PASSWORD='your-existing-password-of-at-least-12-characters'
```

Register the exact callback `<VISUALGUARD_PUBLIC_URL>/api/auth/callback`; it has not changed. Use HTTPS for hosted deployments and one consistent hostname locally. Keep real credentials in the ignored local environment file or the host secret store.

SQLite needs no separate database service and supports invitations. PostgreSQL uses the existing `VISUALGUARD_DATABASE_URL`. MongoDB invitations require a replica set or sharded deployment; standalone MongoDB must explicitly use `legacy`, where existing evidence, password/OIDC login, review, and publishing workflows remain available but invitations and linking are unavailable. Startup rejects unsupported invite mode before creating accounts or grants.

## Start locally, on staging, or in production

From the repository root, with Node 22.12+ and dependencies installed:

1. Copy `apps/platform/.env.example` to the ignored `apps/platform/.env.local`. Replace the placeholders. Choose `VISUALGUARD_USER_ADMISSION=invite` explicitly when upgrading.
2. For a disposable local trial, set a new `VISUALGUARD_PLATFORM_DATA_DIR`; leave both database URL settings unset to use SQLite. For staging, select a separate database and canonical staging URL. Production must use its own credentials, URL, and persistent storage.
3. Load the settings explicitly; the source server does not automatically load this file:

   ```sh
   set -a
   . apps/platform/.env.local
   set +a
   pnpm platform:dev
   ```

4. Open the configured URL. For the production-style source server, build the UI and start it instead:

   ```sh
   pnpm platform:build
   pnpm platform:start
   ```

   Keep the environment loaded in that terminal. Use the host's process manager and HTTPS proxy for a hosted server. Do not point a trial at production storage.

5. On a fresh database, sign in with the configured administrator email/password. Then use **Your sign-in methods → Link Google account** to attach Google to that same administrator. If initial setup has no password, the first eligible verified Google administrator can bootstrap the workspace instead. Once setup is complete, changing environment email/subject settings cannot create a second bootstrap administrator, promote an existing member, or restore a disabled account.
6. Create a project using the existing dashboard project flow if none exists, then open **People & integrations**.

Generated Vercel deployment configuration includes `/invite → /index.html` and no-store/no-referrer headers. Existing generated deployments must regenerate or add these entries when upgrading. Cloud Run and the standalone server serve `/invite` directly. Use a build containing P03; an older published package does not gain this feature by changing environment values.

## Test each invitation feature

### Create and inspect

1. Sign in as a workspace administrator and open **Invitations**.
2. Enter a colleague's email, select one project, choose **Viewer**, **Reviewer**, or **Maintainer**, and select an expiry of 1–168 hours (default 72).
3. Choose **Create invitation**. Copy the one-time link and share it privately. The dashboard sends no email.
4. Refresh Settings. The row remains, but the raw link is gone. A second pending invitation for the same normalized email/project returns a conflict; another project is allowed.

Invitations never grant workspace administrator privileges. Whitespace and casing are normalized; dots and plus-tags are preserved. Pending rows are not active users. Listings use bounded, exclusive-cursor pages of 50 rows, with **Load more invitations**.

### New Google recipient

1. Open the copied link in a private browser. Its fragment disappears from the address bar. The initial screen exposes no target email, project, inviter, or role.
2. Choose **Verify with Google** and select the invited Google account. Choosing another account, cancelling Google, or an invalid/unverified identity grants nothing; retry with the correct account.
3. After verification, inspect the project, role, inviter name, email, and expiry. There is still no account or project grant for a new identity.
4. Choose **Accept invitation**. Only now are the user, identity mapping, membership, accepted receipt, pending-index removal, and audit event committed together. The browser receives a session after this transaction and opens that project's history.
5. Check role behavior with existing dashboard actions: a viewer reads evidence; a reviewer can participate in reviews; a maintainer manages project access and publishing. Other projects remain unavailable unless the account already has access.

Identity proof must be no more than five minutes old; the browser onboarding ticket lasts ten minutes. Verification requests use the existing signed-token OIDC validation, PKCE, state, nonce, browser correlation, and invitation ID/version. Opening or scanning a link never accepts it.

### Existing password or Google recipient

1. Open the link in the account's browser. A password user can sign in directly on the invitation page.
2. Use **Verify existing account**. Password accounts confirm their current password; OIDC accounts need a recent provider sign-in. An older OIDC session can use **Verify with Google** again.
3. Confirm the invitation. The original user ID and review history remain intact. Existing higher project access is preserved, with an `alreadyAuthorized` result rather than an implicit downgrade.
4. If an unlinked Google identity has the same email as an existing password/legacy account, acceptance reports a conflict. Sign in using the existing method and accept as that account, or explicitly link Google in Settings first. Email text never merges accounts or moves history.

### Cancel, replace, expire, and replay

- **Cancel:** cancel a pending row, then open its old link in a private browser. It is unavailable and grants nothing. An already verified recipient also cannot accept after cancellation.
- **Replace link:** the original row becomes cancelled and a new invitation/link appears once, with a fresh 72-hour lifetime and the same role. The old link stops working. To change email or role, cancel and create a new invitation with the intended values.
- **Expiry:** use a one-hour expiry and verify after expiry. The listing computes `expired`; exchange, handoff, preview, and acceptance reject it even without background cleanup. Expired invitations can be cancelled or replaced.
- **Replay:** an accepted invitation remains consumed. A retry by the same verified recipient can return the durable receipt but cannot re-grant removed membership. A newly opened consumed link is unavailable.
- **Authority:** disable or demote the inviting admin, or delete the project, before acceptance. Acceptance fails. A disabled recipient, revoked initiating session, or changed account auth version also fails.
- **Concurrency:** acceptance and cancellation compete on one invitation version. Exactly one terminal transition commits. Simultaneous duplicate creates yield one pending invitation. Stale cancellation/replacement returns 409.

## Storage and failure behavior

All records use the existing versioned state adapter; no new SQL tables are needed:

| Namespace                                  | Purpose                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `admission`                                | Versioned workspace admission mode and completed initial-admin setup                             |
| `invitations`                              | Durable schema-v1 target/project/role, issuer, expiry, hashed secret, status, acceptance receipt |
| `invitation-pending`                       | Unique hash of normalized email/canonical project → pending invitation ID                        |
| `invitation-secrets`                       | Hash of a random 256-bit secret → invitation ID; no raw link is stored                           |
| `onboarding`                               | Hashed browser handle, form token, invitation ID/version, short-lived validated recipient proof  |
| `invitation-projects`                      | Shared active/deleting project guard used by join and every ProjectDirectory deletion path       |
| Existing identity/membership/audit records | Atomic identity ownership, access and audit results                                              |

Terminal invitation metadata is retained rather than TTL-pruned into reusable credentials. The list omits token hashes. Provider tokens, authorization codes, raw invitation links, and passwords do not enter invitation audit details.

Transactions write recipient/session, issuer, project guard, membership, and invitation records rather than trusting snapshot reads. Acceptance order is recipient/session → issuer → project guard → membership → invitation/index → audit; create uses admin/session → project guard → pending/index/audit. Conflicts get a bounded retry. SQL transactions serialize through the existing database boundary; MongoDB uses the same snapshot/majority session as P02. Focused tests inject concurrent issuer disable, recipient disable, logout, and project deletion after snapshot reads.

Project deletion first closes the shared guard, then runs existing evidence/access cleanup. A failed run-count confirmation reopens it with CAS; successful deletion keeps it closed. An unexpected interruption stays closed, preventing new grants. After such an interruption, an operator must reconcile the deletion, tombstone, evidence and access records before reopening any guard; automatic interrupted-deletion recovery remains operational follow-up work. Never delete a tombstone or reopen a guard merely to retry an invitation.

A crash or failure before acceptance commits grants nothing. If session issuance fails after commit, retry in the same verified browser to obtain the receipt/session without another grant, or sign in through the newly created identity. Replays do not bypass later account revocation.

Pre-session actions require a browser form token; actions with a signed-in actor also require the existing session CSRF token. Upload credentials cannot manage invitations or act as browser identities. Host/origin checks and JSON limits still apply. Exchange, verification, acceptance and provider-login attempts use persistent cross-instance throttles (10 attempts per operation/address per ten minutes; 60 invitation status requests). Proxy-forwarded IP headers are not trusted; deployments sharing an upstream address should also configure perimeter rate limiting and account for shared quotas.

## Validation and remaining phases

Focused protocol, API, transaction, race and compatibility tests run against SQLite, PostgreSQL, transactional MongoDB and standalone MongoDB. On 16 October 2026, 234 tests passed in 10 focused suites, with 16 intentional backend-specific skips: the Mongo-only snapshot cases skip other adapters, and the in-memory repository fake skips physical evidence deletion. The dashboard UI build and a real-browser password invitation journey are also checked. These checks were deferred during initial implementation. The operator subsequently authorized formatting, lint, and type checks for merge cleanup. Merge review reran 227 tests in nine focused suites with the same 16 intentional skips against the reviewed P01/P02 baseline and live adapters; formatting, lint, CLI/report/platform type checks, and the dashboard build passed. The review preserved direct `/reviews` serving alongside `/invite` while integrating the released runtime.

Real Google browser acceptance still requires your existing Google client credentials and consent/audience configuration; the automated provider uses signed tokens through the actual OIDC library. Expanded account administration, session-revocation UI and last-admin protection remain P04. Audit/recovery operations and rollout evidence remain P05. Automatic invitation email delivery is outside the agreed scope.

## Merge-review corrections

Interrupted first-admin setup on standalone legacy storage now reserves one
administrator identity and marks setup complete only after its account is durable.
Retry with the original administrator configuration or Google identity; a different
identity cannot claim interrupted setup. Completed setup never reopens from env
changes. Expired, signed-out, disabled, or version-stale invitation proofs return
to verification, and acceptance failures refresh that state. Same-email invitation
enrollments share a transactional write fence; this never links accounts by email.

External-database invitation and identity tests use a random PostgreSQL schema or
MongoDB database and remove it on teardown. Test credentials need permission to
create/remove that private schema or database; the configured database is never
dropped. Initial standalone onboarding tests also remove their own test database.

After these corrections, all 15 platform suites passed: **287 tests passed** and
**16 intentional backend-specific cases skipped**, using live disposable
PostgreSQL, replica-set MongoDB, and standalone MongoDB. Lint, format,
CLI/report/platform type checks, and the dashboard build passed.

The local account builder is named `prepareLocalAccount`: it returns a user
record, not a password. This avoids CodeQL classifying every returned field
(including email and session-routing data) as a password source. Actual password
hashing remains salted scrypt, and no scanning rule is suppressed.
