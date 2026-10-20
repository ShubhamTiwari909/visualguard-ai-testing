---
title: "Invite people and manage permissions"
description: "Create scoped invitations, understand project roles and manage accountable team identities."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/PRODUCT-FEATURES.md", "docs/LOCAL-SETUP.md"]
sidebar: {"order": 10}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

### Access choices

- **Local owner:** trusted access on the local computer, without a user account or login setup.
- **Password login:** individual accounts, sessions and password controls.
- **Google/OIDC login:** configured provider identity, with customer-owned credentials and exact callbacks.

Current team onboarding supports explicit Google linking to an existing account after ownership proof. It preserves account IDs/history and does not merge people merely because their emails match. Profile displays the signed-in user's name, email and workspace role.

Invite-only admission allows administrators to issue expiring project/role invitation links. A recipient verifies the intended identity and explicitly accepts; opening the link alone grants nothing. Links can be cancelled/replaced. The product currently provides copyable links, not automatic invitation emails.

### Roles

| Role                    | Main responsibility                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Viewer                  | Read evidence in assigned projects                                                     |
| Reviewer                | Participate in review and record visual decisions                                      |
| Maintainer              | Manage the project's access, upload credentials, references and policies, as permitted |
| Workspace administrator | Manage accounts and projects across this installation                                  |

Project permissions and workspace administrator status are separate. There is one workspace per installation, not a vendor-wide multi-tenant super-admin console.

Administrators can search/filter users, inspect details, manage roles, disable/restore accounts, reset existing password credentials and revoke sessions/upload credentials. Sensitive lifecycle actions require current proof and fresh account versions. The last active administrator is protected. Disabling a person retains attributable history; restoring them does not resurrect revoked credentials.

Upload tokens are separate, project-scoped publishing credentials. They cannot create projects, manage users or browse general dashboard history. In feature releases, they can retrieve their project's indexed approved references and perform scoped policy operations. Local-owner access and login-mode localhost are different: login-mode publishing still needs a token.

## Invite and verify a teammate

In **People & integrations**:

- Create password member accounts when appropriate, then assign project access.
- For Google onboarding, create an invitation for an email, project, role and expiry. Copy/share the one-time link privately; the dashboard does not send invitation emails.
- Open the link in a separate browser profile, verify the invited account, inspect the grant, and explicitly accept. Opening a link alone grants nothing. Existing accounts can prove ownership and accept without changing their account ID.
- Confirm Viewer can read assigned evidence, Reviewer can discuss/decide visual changes, and Maintainer can manage project access/tokens/baselines/policies. Workspace administrators manage the installation.
- Test cancel/replace/expiry, an incorrect recipient and an unrelated project. New identities cannot bypass invite-only admission.
- Search/filter users and inspect details. Admin promotion/demotion is a separate deliberate action. Disable/restore, password reset and session/upload revocation require current administrator proof and fresh record versions; the last active administrator is protected.

Do not describe these current-source controls as part of an older published npm version. Existing deployments must back up and explicitly choose `invite` or `legacy` when migrating from an unrecorded admission policy, with all writers upgraded consistently.

## Verify the setup

In separate browser profiles, verify Viewer read access, Reviewer decisions and Maintainer project controls. Test an expired/cancelled/wrong-recipient invitation; opening a link alone must not grant access.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/reviews/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
