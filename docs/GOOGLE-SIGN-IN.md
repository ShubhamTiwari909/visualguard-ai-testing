# Google sign-in pilot — P01

**P03 upgrade:** follow [Invitations and admission](TEAM-INVITATIONS.md) for current setup and migration behavior. Fresh hosted installs now default to invite-only; existing installs must explicitly choose an admission policy. The descriptions below record the earlier phase boundary.

P01 adds a named Google sign-in entry point to the existing dashboard login, validates complete OIDC configuration before startup, verifies Google email and token signatures, and returns provider failures to a safe retry screen. It uses the existing database-backed accounts, sessions, revocation, project roles, and audit records.

This is the first phase of the [team onboarding plan](TEAM-ONBOARDING-PLAN.md#delivery-phases-agreed-on-16-october-2026). P02 now adds [explicit Google account linking](GOOGLE-ACCOUNT-LINKING.md) and identity continuity. Invitations, invitation-required admission, and expanded user administration remain later phases. An ordinary Google user initially has no project access; an administrator must grant it.

## 1. Values the operator supplies

| Variable | Required value / purpose |
| --- | --- |
| `VISUALGUARD_PUBLIC_URL` | Exact dashboard origin; local example `http://127.0.0.1:4400`; HTTPS for hosting |
| `VISUALGUARD_OIDC_CLIENT_ID` | Google OAuth **Web application** client ID |
| `VISUALGUARD_OIDC_CLIENT_SECRET` | That web client's server-side secret |
| `VISUALGUARD_ADMIN_EMAIL` | Verified Google email for the first Google administrator; also the password recovery administrator's email |
| `VISUALGUARD_ADMIN_PASSWORD` | Unique password, 12–256 characters, to bootstrap a recovery password account on a new database |

Set `VISUALGUARD_AUTH_MODE=login` and `VISUALGUARD_OIDC_ISSUER=https://accounts.google.com`. These two values do not come from Google credentials. `VISUALGUARD_OIDC_ADMIN_SUBJECTS` remains an optional explicit subject allowlist for existing company OIDC deployments; it is not required for this Google email bootstrap.

No new Google-specific credential names were added. A database service is optional: with `VISUALGUARD_DATABASE_URL` and `DATABASE_URL` unset, the dashboard uses SQLite. Use `VISUALGUARD_DATABASE_URL` only for an actual PostgreSQL or MongoDB connection. Ordinary Google sign-in remains supported on standalone MongoDB; the explicit linking feature introduced in P02 requires transactional storage (SQLite/PostgreSQL or a MongoDB replica set/sharded deployment).

Keep real values in an ignored local environment file or your host's secret store. Never commit the client secret or include it in screenshots, issue descriptions, or chat messages. The safe template is [apps/platform/.env.example](../apps/platform/.env.example).

## 2. Configure the Google web client

1. In Google Cloud / Google Auth Platform, select or create the project for your dashboard.
2. Configure the application's branding/consent screen and audience. For a testing application, add the Google accounts that will participate in the pilot; use the internal audience only when appropriate for your Google Workspace organization.
3. Create an OAuth client with application type **Web application**. Copy its client ID and client secret into your local environment settings.
4. Add the exact authorized redirect URI for local use:

   ```text
   http://127.0.0.1:4400/api/auth/callback
   ```

5. For a hosted dashboard, add its exact HTTPS callback, for example `https://your-dashboard.example.com/api/auth/callback`, and set `VISUALGUARD_PUBLIC_URL` to that origin.

This implementation exchanges authorization codes on the server and does not require a browser Google SDK or JavaScript-origin credential. Only basic identity scopes are requested. Google requires a registered redirect URI to match the request; its setup and claims contract are documented in the [Google OIDC guide](https://developers.google.com/identity/openid-connect/openid-connect).

Keep the scheme, host and port consistent when opening the dashboard. If you choose a supported `localhost` callback instead, change both the Google redirect registration and `VISUALGUARD_PUBLIC_URL`, then use that hostname throughout the session.

## 3. Run from this repository

Use Node 22.12+ and the installed repository dependencies. From the repository root:

```sh
cp apps/platform/.env.example apps/platform/.env.local
```

Edit `apps/platform/.env.local` and replace every credential/admin placeholder with your actual values. This file is ignored by Git. Keep optional database URLs commented out unless you have a real connection.

Load it explicitly in the terminal that will run the dashboard:

```sh
# Select local SQLite for the pilot; omit this line if you intend an external DB.
unset VISUALGUARD_DATABASE_URL DATABASE_URL VISUALGUARD_SQLITE_FILE

set -a
source apps/platform/.env.local
set +a

# Optional isolated data directory; reuse it for persistence testing.
export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/google-pilot"

pnpm platform:dev
```

`platform:dev` does not automatically read an environment file. Loading the file only in another terminal does not configure this process. The installed CLI's existing `dashboard --env-file PATH` option remains available when using a newly built candidate package; previously installed dashboard assets do not contain this phase's UI changes.

Open the configured origin and select **Sign in with Google**. Password login remains available for the recovery administrator. Do not use local-owner mode to test Google: local mode intentionally ignores OIDC configuration and preserves the offline workflow.

## 4. Exercise multiple users

1. In a fresh database, sign in with the verified account configured as `VISUALGUARD_ADMIN_EMAIL`. Confirm it can open People & integrations. A successful Google login is audited as provider `google`.
2. Import/publish evidence into a disposable project using the existing workflow.
3. In a separate browser profile/private window, sign in using a second Google account permitted by your Google application's audience. It initially sees no private projects.
4. As administrator, find that account under People & integrations and grant Viewer, Reviewer, or Maintainer on the test project.
5. Refresh the second browser and verify the expected project access. Viewer cannot comment/decide; Reviewer can use Team review; Maintainer retains the existing project administration rights.
6. Remove membership or disable the account and retry its requests/sign-in. Access must be denied. Prior comments and review attribution remain stored.
7. Restart the dashboard with the same database and verify identities/sessions persist. Repeated Google login reuses the existing issuer/subject identity and does not automatically restore disabled accounts or edited roles.
8. Cancel the Google consent/account-selection flow, or retry after an invalid/expired callback. The browser should return to the login screen with a generic retry message rather than displaying provider details.

P01 created separate password and Google accounts even with the same email. P02 preserves existing IDs and lazily maps legacy external identities on validated sign-in; new external users on transaction-capable databases use opaque IDs. The recovery password administrator and an already-created Google administrator can still be separate entries. Assign project access to the intended identity. Do not change the configured issuer's spelling/trailing slash for an existing database: it is part of legacy OIDC IDs and identity mappings. See the [P02 guide](GOOGLE-ACCOUNT-LINKING.md) to link a fresh Google identity to your current account; existing separate accounts cannot be merged through this flow.

This pilot allows an eligible Google account to create a signed-in member with zero project access. It is not invitation-only admission or automatic Workspace-domain provisioning. Google sign-in does not grant project access based on an email domain.

## 5. Configuration and failure behavior

- All three OIDC settings are required together in login mode. Partial configuration fails startup with missing variable names, without printing their values. All blank/unset settings leave company login disabled.
- Issuer URLs must use HTTPS and cannot contain credentials, queries, or fragments. Generic enterprise issuer paths remain supported.
- Google identity tokens must contain a subject and a verified, nonempty email. Signature/issuer/audience/expiry/nonce validation remains in the OIDC library, with Google signature checks explicitly enabled.
- Authorization uses code flow, PKCE S256, state and nonce. Correlation records expire after ten minutes and are consumed once. Server sessions retain the existing twelve-hour/revocation policy.
- Only `openid email profile` is requested. No Google Drive/Gmail scopes, refresh-token storage, or Google API integration is introduced.
- Auth/session responses use `Cache-Control: no-store`. Session metadata exposes only a provider label, not client credentials. Provider failures use a fixed same-origin retry location and do not return the raw error/code to the login screen.
- A discovery outage can be retried without restarting the dashboard. Generic company OIDC remains labeled Continue with company login and retains its existing verified-email/subject-allowlist administrator rules.

If you see `redirect_uri_mismatch`, compare your Google registration and dashboard origin exactly. If the account is not admitted by Google's testing/audience configuration, adjust the application's test-user/audience setup. If login works but the project is absent, grant project membership to that Google identity. Changing the bootstrap password variable does not reset an existing database account.

## 6. Validation and next phase

Focused tests use the real `openid-client` implementation with a simulated provider, RSA-signed tokens, discovery/token/JWKS responses, and no real Google credentials. They cover valid sessions; invalid signatures/issuer/audience/expiry/subject/nonce/state/email; callback replay/missing cookie/expiry; outage recovery; provider labels; generic OIDC; account separation; disabled-user/session revocation; and SQLite persistence across reopen.

Run:

```sh
pnpm --filter @visualguard/platform exec vitest run \
  test/google-auth.test.ts test/oidc-cookies.test.ts test/auth.test.ts
```

Validation on 16 October 2026 using Node 22.14: the three focused suites passed **45 tests**, including SQLite reopening and Google/generic OIDC cases, and `pnpm platform:build` passed. A real Google browser pilot requires operator credentials and consent/client setup; it has not been run. Live PostgreSQL/MongoDB identity flows and the full invitation release are not established by the simulated-provider tests. Formatting, lint, and type-check commands were not run and remain deferred under the repository instructions.

P02 implements the [transactional identity foundation and explicit linking](GOOGLE-ACCOUNT-LINKING.md). Next, P03 adds invitations and admission migration; P04 expands user administration; P05 completes operational rollout. Keep each requested feature's implementation, documentation and focused tests in its own commit.
