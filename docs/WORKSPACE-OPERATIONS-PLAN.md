# Workspace operations — P05 / T07

This feature completes the implementable operations work following Google sign-in, account linking, invitations, user administration, and personal profiles. It is separate from F04 approved baselines and F05 named journeys. Build from merged main on `codex/workspace-operations-p05`.

## One feature, three delivery parts

| Part | Scope | Acceptance |
| --- | --- | --- |
| P05-A: audit history | Administrator-only, paginated audit history with actor/action/date filters and safe event details | Members and upload credentials cannot read it; filters paginate through sparse matches without exposing credential material |
| P05-B: administrator recovery | An explicit host-side command to reset and restore an existing password administrator | Preview by stable account ID, version-bound confirmation, backup acknowledgement, private password file; account update, credential revocation and audit commit atomically |
| P05-C: rollout readiness | Read-only storage/identity/admission readiness, recovery and native-backup runbooks, focused persistence/restore checks | Report unsupported transactions, unknown identity schemas and missing password administrators; preserve local/offline workflows and existing identity/review records |

Keep this plan in a preceding documentation commit. Implement all three parts, their documentation, Changeset and focused tests in one subsequent feature commit. Do not run formatting, lint, or type checks; focused behavior tests and the dashboard UI build are allowed.

## Boundaries

- Reuse the existing session, audit records, state transactions and administrator write guard. No new Google credentials or application environment variables.
- Recovery runs only with direct access to the operational database on the dashboard host. Do not expose an unauthenticated HTTP recovery endpoint or change startup bootstrap semantics.
- Recover only an existing account that already has both administrator role and a password credential. Do not create users, merge identities, promote members, or add passwords to Google-only accounts.
- Recovery requires the exact previewed user ID and version, an explicit native-backup acknowledgement, a reason, and a replacement password read from a private file rather than process arguments. Retain memberships, identities and review authorship, revoke sessions/upload credentials, and record a secret-free recovery event.
- Bound audit and inventory scans. Return continuation information or explicit incompleteness instead of reporting truncated inventories as complete.
- Portable evidence exports are not authentication backups. Demonstrate a native SQLite snapshot restore separately and document PostgreSQL/MongoDB native backup requirements.
- Do not automatically reopen interrupted project-deletion guards, erase tombstones, downgrade identity schemas, publish npm packages, or change repository release permissions.
- Real Google consent/invitation testing still needs the operator's configured Google accounts. Release permission repair, live deployment, and Google sign-off remain explicit rollout gates; do not mark P05 operationally signed off merely because code tests pass.

## Verification

Focused tests cover audit authorization, secret redaction, filtering/cursors, bounded readiness inventories, recovery eligibility and stale previews, atomic rollback on audit failure, session/token revocation, concurrent administrator writes, and native SQLite restore preserving canonical users, identities and review attribution. Exercise the administrative UI on desktop/mobile and retain explicit limitations for live PostgreSQL/MongoDB or real Google checks that were not run.
