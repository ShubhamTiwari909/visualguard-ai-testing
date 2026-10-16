# Shared access and storage foundations

The standalone release supports one workspace with project-level access. F02 adds password accounts, optional OpenID Connect company login, project roles, account disabling/session revocation, scoped expiring upload credentials, and an audit trail. Remote publishing is implemented separately under F06.

Session and OIDC correlation cookies contain opaque SHA-256 handles derived from 256-bit random values, rather than the raw random secret output. The database indexes a second hash of each handle, so stored lookup keys cannot be replayed as browser cookies. Passwords, provider client credentials, and PKCE verifiers are not placed in these cookies. Existing HttpOnly, SameSite, HTTPS Secure, expiry, CSRF, and one-time OIDC callback checks remain in force. Regression coverage for handle persistence and callback replay is included; it was not executed locally for this PR fix, per the user's instruction.

## Minimal configuration

Local use needs no database or login configuration. New local evidence is stored in `.visualguard/platform/metadata.sqlite` beneath the caller's project (or `VISUALGUARD_PLATFORM_DATA_DIR`). Existing F01 filesystem objects remain readable from that directory's `objects/` fallback.

For a shared instance, configure:

```dotenv
VISUALGUARD_DATABASE_URL=postgresql://user:password@host/visualguard
VISUALGUARD_PUBLIC_URL=https://dashboard.example.com
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
```

`mongodb://` and `mongodb+srv://` URLs select MongoDB automatically. Include the database name. `DATABASE_URL` remains a compatible fallback. The public URL enables login mode automatically; local access cannot be bound to an external origin without authentication.

The administrator is created once. Changing a bootstrap environment password does not silently overwrite an existing account. Account updates revoke existing sessions; disabling an upload credential's owner also invalidates the credential. Keep the admin bootstrap values in your deployment's secret settings, not in Git.

## Access model

- Workspace administrators create projects/accounts and manage access.
- Project viewers read assigned project history and evidence.
- Reviewers retain viewer read access and can comment, assign checks to eligible reviewers, and record or withdraw job-level visual decisions. See the [F03 review guide](../../docs/COLLABORATIVE-REVIEW.md) for evidence binding and scope.
- Project maintainers manage their project's membership and upload tokens.
- New company-login users have no project access until assigned, unless explicitly configured as the workspace administrator.
- Upload tokens are scoped to one project, expire in 1–90 days, are shown only once, and cannot browse project lists, run history, artifacts, or approve changes. The publishing-project lookup reveals only their own project's ID/name to support `visualguard test <project>`.

Use **People & integrations** to create accounts, assign project roles, disable accounts, and create/revoke upload tokens. Initial account passwords must be shared privately; the dashboard does not send emails. Login sessions are persisted with a 12-hour lifetime. Cross-origin mutations are rejected; browser mutations also require the session action token.

## Optional company login

For Google sign-in, follow the [Google setup and local pilot guide](../../docs/GOOGLE-SIGN-IN.md). Use the existing OIDC variable names with issuer `https://accounts.google.com`; the login screen shows Sign in with Google only with complete configuration. Project access is granted through [single-use project invitations](../../docs/TEAM-INVITATIONS.md) or explicit administrator assignment. New hosted installations default to invite-only admission.

P02 implements [explicit Google linking](../../docs/GOOGLE-ACCOUNT-LINKING.md) with transactional identity ownership, legacy-ID migration, current-account proof, and session revocation. The same Google settings apply. No identity is reassigned from another existing account or merged by email. SQLite/PostgreSQL support the transaction boundary; MongoDB linking requires a replica set or sharded deployment. Existing standalone MongoDB sign-in/evidence/review workflows remain supported. [P03 invitations and admission controls](../../docs/TEAM-INVITATIONS.md) are implemented; broader workspace user administration follows in P04.

Set `VISUALGUARD_OIDC_ISSUER`, `VISUALGUARD_OIDC_CLIENT_ID`, and `VISUALGUARD_OIDC_CLIENT_SECRET`, then register `<PUBLIC_URL>/api/auth/callback` with the provider. The client uses authorization-code flow, PKCE, state, and nonce verification. Password login can remain available for the bootstrap administrator.

An OIDC administrator is selected either by the configured `VISUALGUARD_ADMIN_EMAIL` **when the ID token marks that email as verified**, or by an explicit comma-separated `VISUALGUARD_OIDC_ADMIN_SUBJECTS` allowlist. Providers that omit verified-email claims should use the subject allowlist. Other identities must be assigned project access after their first successful sign-in. Existing disabled/edited accounts are not silently re-enabled by login.

## Database portability

PostgreSQL, MongoDB, and SQLite use the same platform envelope. New screenshots and DOM artifacts are stored in immutable, checksummed 1 MiB database chunks. Authentication and upload state also live in the selected database, so multiple application instances share revocation and progress.

A **new** database dump includes the new artifact objects. Raw database dumps also contain account/session information; portable evidence-only export is a separate release capability. Earlier F01 runs may still refer to `objects/` files: retain those alongside an old database until exported/migrated.

MongoDB stores each run envelope as one atomic document and rejects envelopes above 12 MiB to leave room below its BSON document limit. Artifact bytes are chunked separately and do not count toward the run envelope. MongoDB standalone instances are supported; run publication does not require a replica-set transaction. All backends publish metadata only after the referenced evidence is available.

The current release keeps screenshot bytes in the database for minimal hosting setup. Plan database capacity accordingly; an external object-storage adapter can be added later without changing engine manifests.

## Validation

The storage contract suite always exercises SQLite. PostgreSQL cases run only when `VISUALGUARD_TEST_DATABASE_URL` is set, and MongoDB cases run only when `VISUALGUARD_TEST_MONGODB_URL` is set; otherwise those backend suites are skipped. Use disposable databases. These suites cover racing inserts, scoped repository filters, atomic state updates, multi-chunk artifact round trips, and deletion. Login, HTTP project-access permissions, and session/password/token revocation are covered separately against SQLite; they do not establish live PostgreSQL/MongoDB authentication coverage. Formatting, lint, and type checks remain deferred under the user's F01–F36 instruction.
