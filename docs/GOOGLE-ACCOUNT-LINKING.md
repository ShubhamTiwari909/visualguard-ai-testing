# Phase 2 — identity continuity and explicit Google linking

**P03 upgrade:** follow [Invitations and admission](TEAM-INVITATIONS.md) for current setup and migration behavior. Fresh hosted installs now default to invite-only; existing installs must explicitly choose an admission policy. The descriptions below record the earlier phase boundary.

P02 adds a transactional identity repository and **People & integrations → Your sign-in methods → Link Google account**. It connects a fresh Google identity to the account you are already using, preserving that account's ID, roles, project memberships, and existing review authorship. It does not merge two existing accounts or implement invitations.

P02 is on `codex/team-onboarding-p02`, stacked on the P01 Google sign-in branch while PR #20 remains open. The [delivery plan](TEAM-ONBOARDING-PLAN.md#delivery-phases-agreed-on-16-october-2026) keeps invitations/admission in P03 and expanded workspace administration in P04.

## Environment and storage

**No new application environment variables or Google credentials are required.** Keep the [P01 configuration](GOOGLE-SIGN-IN.md): `VISUALGUARD_AUTH_MODE=login`, the exact `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_OIDC_ISSUER=https://accounts.google.com`, and the existing Google web client ID/secret. The callback stays `<VISUALGUARD_PUBLIC_URL>/api/auth/callback`.

| Backend                                | Google sign-in                     | Explicit linking                                            |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| SQLite                                 | Supported                          | Supported; no database service needed                       |
| PostgreSQL                             | Supported                          | Supported with the existing connection URL                  |
| MongoDB replica set/sharded deployment | Supported                          | Supported through multi-document transactions               |
| Standalone MongoDB                     | Existing sign-in remains supported | Unavailable; API rejects it before granting/changing access |

The account card detects transaction support and explains unavailable linking. MongoDB needs a replica set or sharded deployment for this multi-record operation; see [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/). Existing capture, publishing, history, review, password-login, and local-owner workflows remain usable on standalone MongoDB. Local owner mode does not expose account linking.

## Link a new Google identity

1. Start the P02 source dashboard with your existing Google configuration and database:

   ```sh
   pnpm platform:dev
   ```

   As in P01, explicitly load your local environment file in that terminal first. Add no real credentials to the repository.

2. Sign in to the account whose project access and history you want to keep. For a password account, use its existing email/password login.
3. Open **People & integrations** and find **Your sign-in methods**.
4. Enter your current password when requested, then choose **Link Google account**.
5. In Google account selection, choose a Google identity that has not already created or been linked to a different account on this dashboard.
6. Complete Google authorization. The browser returns to settings with a confirmation. Google now signs in to this same account; other sessions for the account are revoked.
7. In a separate private window, use **Sign in with Google**, then confirm the same projects, roles, and review history are available.

A password account must prove its current password even when it has an active session. An account without a password needs an OIDC-authenticated session created within the preceding five minutes; old sessions without authentication metadata require signing in again. The Google handoff is bound to the initiating account, exact browser session, and auth version, in addition to the existing ten-minute state/nonce/PKCE correlation. Logout, disabling the user, password/workspace-role changes, or switching browser accounts before callback prevents linking.

Only one Google identity per canonical account is supported in this phase. Unlinking, credential replacement, and account merge tools remain deferred. Failed/cancelled callbacks return to a safe retry screen without exposing provider codes or identity details.

## Existing-account conflicts

If the Google identity has already signed in as a separate P01 account, linking it to your password account returns a conflict. This includes an old Google account that has not yet migrated to the new mapping format. Disabling that account does not release its identity for reassignment.

Two accounts with equal email text remain distinct until an eligible identity is explicitly linked. Proof of an email match never combines memberships, promotes the target account, or transfers historical reviews. For an existing duplicate, continue using the intended account and ask an administrator to manage access; P02 provides no history-reassignment or account-merge endpoint.

Google bootstrap administrator eligibility is applied only when creating a new ordinary sign-in identity. Linking a Google identity whose email matches `VISUALGUARD_ADMIN_EMAIL` does not promote the account being linked. Existing disabled accounts and edited roles remain unchanged.

## Identity records and migration

P02 stores identity mappings in the existing database-backed versioned state store. It does not require new SQL tables or a scan that rewrites all users.

- `identity-schema/current`: version 1, initialized lazily and atomically. Unsupported future versions fail closed.
- `external-identities`: unique SHA-256 key over the issuer/subject tuple, a schema version, canonical user ID, provider, issuer/subject, and link time. This is internal authentication state, not a public user directory.
- `user-identities`: per-user index of mappings.
- `google-identities`: one Google identity owner index per canonical user.
- Existing `audit`: identity creation, legacy migration, and linking events with user/provider metadata; no passwords, provider tokens, or raw subject values in audit details.

On the next validated OIDC login, an existing legacy `oidc-...` ID is preserved and bound to its exact issuer/subject mapping. Password accounts retain their existing IDs. New external users on transaction-capable backends receive opaque `user-...` IDs. No review actor, membership, account name/email, historical timestamp, or existing role is rewritten during migration. There is no attempt to reverse hashed legacy IDs or guess identity from email.

Standalone MongoDB continues using legacy IDs for new ordinary sign-ins until transactional storage is available. Existing canonical mappings are honored when present, including mappings restored through native backups. This fallback never performs account linking or writes partial identity grants.

On SQLite/PostgreSQL, the transaction-scoped state adapter uses the existing database transaction boundary. On MongoDB, every operation carries the same session, with primary/snapshot/majority transaction settings and a bounded driver timeout. Account and initiating-session rows are written as guards, so a concurrent disable/logout conflicts instead of being accepted from a stale snapshot. Linking, indexes, auth-version rotation, and the link audit event commit together or all roll back. A fresh session cookie is issued only after this commit; if session issuance fails, sign in again with a retained method or the newly linked Google identity.

The generic transaction boundary is the P03 foundation. Invitation records, pending-invite uniqueness, project-deletion guards, and workspace last-admin operations are not introduced early in P02; they stay with their respective feature phases.

## API boundary

| Route                                   | Result                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/auth/identities`              | Own account's `googleLinked`, `googleConfigured`, `linkingAvailable`, `requiresPassword`, and `reauthenticationRequired` flags                                                                |
| `POST /api/auth/identities/google/link` | Own authenticated browser account plus existing action token; optional `currentPassword` field, required for a password account; returns the authorization URL and browser correlation cookie |
| Existing Google callback                | Verifies Google identity and one-time correlation; verifies the initiating account/session/auth version again; commits linking and returns to `/settings?identity=linked`                     |

The POST body cannot select a target user. A different-origin request, missing action token, upload credential, local-owner credential, stale session, invalid password, or unsupported storage cannot begin an effective link. Metadata is `no-store` and exposes no provider subject, mapping key, session ID, client secret, or password hash. The existing session/host/origin/JSON limits still apply.

## Focused validation

On 16 October 2026, using Node 22.14, PostgreSQL 17.5, and MongoDB 8.3.4, the following six suites passed **138 tests**, with **3 intentionally skipped non-Mongo executions of the MongoDB-only snapshot race test**:

```sh
pnpm --filter @visualguard/platform exec vitest run \
  test/identity-storage.test.ts test/google-auth.test.ts \
  test/auth.test.ts test/oidc-cookies.test.ts \
  test/reviews.test.ts test/storage.test.ts
```

The run used disposable PostgreSQL, MongoDB replica-set, and standalone MongoDB instances, plus SQLite and the in-memory test adapter. Existing live adapter test variables remain `VISUALGUARD_TEST_DATABASE_URL` and `VISUALGUARD_TEST_MONGODB_URL` (use a replica-set URL for the transactional identity suite). The optional compatibility test adds `VISUALGUARD_TEST_MONGODB_STANDALONE_URL`; this is a test-only value, not a dashboard configuration requirement.

Coverage includes atomic rollback, CAS across transactions, concurrent sign-in uniqueness, conflicting link owners, legacy ID preservation, email collisions without merges, audit-failure rollback, stale/expired/revoked sessions, disabled accounts, two-account link races, MongoDB snapshot write-skew protection, and ordinary standalone MongoDB sign-in with linking rejected. OIDC tests use the real library with a simulated signed-token provider; they also exercise password proof, browser/session substitution, callback replay, API CSRF/origin/credential boundaries, and post-link session revocation.

The separate publishing and local-project command suites also passed **10 tests**, for **148 passing focused tests in total**. `pnpm platform:build` passed. No real Google browser authorization or production database migration was performed. During merge review, the same eight focused suites passed 148 tests with 3 intentional skips against the released dashboard baseline and live disposable adapters. The operator authorized lifting the check deferral for this cleanup; formatting, lint, CLI/report/platform type checks, and the dashboard build passed. CI now supplies both a writable single-member MongoDB replica set for transaction tests and a standalone instance for compatibility tests, using the test-only URLs above.

## Manual acceptance and recovery

1. Back up the operational database and configure Google as in P01. Keep a working recovery password administrator.
2. On a disposable database, use a password user with Reviewer access and at least one existing review comment/decision.
3. Link a Google identity that has never signed in to another account in that database. Verify Google sign-in returns to the same account and the review actor IDs/access remain unchanged.
4. Keep an old session open in another profile; its next authenticated request must fail after linking.
5. Try an incorrect current password, cancel Google authorization, reuse a callback, and sign out before callback; each attempt must leave identity ownership unchanged.
6. Sign in as a separate Google user first, then attempt to link that identity elsewhere. Expect a conflict and retain both accounts' separate histories and permissions.
7. Disable the target account during the handoff and retry. It must stay disabled and no link can grant access. Restore only through the existing administrator controls.
8. Restart the dashboard with the same database. Check linked Google login and legacy identity migration still resolve to the same user ID.
9. Repeat with your disposable PostgreSQL and MongoDB replica set. On standalone MongoDB, confirm the linking card reports linking unavailable and directs the user to their administrator while password/Google login and evidence/review workflows remain available.

Native database backups include identities and operational authentication state; portable evidence exports do not. Do not run older P01 binaries against a P02 database after creating canonical mappings: they do not understand linked identities and can create separate legacy accounts. Roll back through a compatible forward fix or a coordinated pre-upgrade database snapshot, preserving an operational recovery method. Do not remove identity records to free a Google account or rewrite historical actors manually.

The main-targeted CodeQL review identified a test-helper naming false positive:
`passwordAccount()` returns an account/session fixture, but its whole return value
was classified as a password, including the high-entropy session cookie. The
helper is now named `authenticatedAccount()`; cookie lookup still uses SHA-256
and actual passwords still use salted scrypt. No scanning rule is suppressed.

Additional review coverage exercises a generic issuer under `/realm/team`, an
actual password change during the link handoff, and failed ordinary sign-in versus
link attempts while already signed in. Failure redirects now use the stored OIDC
attempt intent. Together with the empty-query/fragment issuer checks, the three
authentication suites pass 56 tests; lint, format, type checks, and the dashboard
build pass.

The final review adds an explicit same-account session-substitution test: a
second successful login has the same user ID but a different session ID and
cannot finish a Google-link attempt started in the first session. This separately
protects exact-session binding from the different-account rejection test.
