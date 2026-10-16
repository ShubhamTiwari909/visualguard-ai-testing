# Standalone VisualGuard dashboard

A separate UI quality evidence app, also distributed through the `visualguard` package. It provides project/run history, filters, immutable screenshots and DOM evidence, and the existing comparison viewer.

Read the [complete walkthrough](../../docs/STANDALONE-DASHBOARD-WALKTHROUGH.md) for local use, installation in another project, team access, backups/database dumps, CI publishing, and Cloud Run/Vercel hosting. The implementation is a validated local release candidate; npm publication and live cloud deployment have not been performed.

The naming follow-up adds `test <project> --run-name "Release smoke"`, **Edit run name** on run detail, and **Edit project name & ID** in project settings. Public ID edits preserve existing links, upload tokens, and history. See the [naming guide](../../docs/DASHBOARD-NAMING.md) for setup, storage details, suggestions, and manual checks. These extensions have no executed local checks, builds, or tests.

Project/run deletion is now implemented as a follow-up extension, with typed confirmation, maintainer/admin permissions, and shared-artifact cleanup. Open a run to delete it, or use **People & integrations → Project access → Delete project**. See the [deletion guide and manual checklist](../../docs/DASHBOARD-DELETION.md). No build or checks were run for this extension, per the user's instruction.

You can also bind a run while executing tests: `npx visualguard test storefront`, or `npx visualguard test "Storefront Web"`. Use `--dashboard <origin>` or `VISUALGUARD_DASHBOARD_URL` with the applicable upload token for an existing server. See the [project binding guide](../../docs/DASHBOARD-TEST-BINDING.md). No build or checks were run for this follow-up either.

## Start from this repository

```sh
pnpm install
pnpm platform:dev
```

Open http://127.0.0.1:4400. The local default needs no database service or login setup. SQLite is stored in the calling project's `.visualguard/platform/metadata.sqlite`; new artifact objects are stored in that database too. Add `.visualguard/` to the consuming project's `.gitignore` before committing files: the dashboard command does not update `.gitignore`, and this directory can contain screenshots, DOM evidence, and authentication state. Old F01 filesystem objects remain readable.

For compiled workspace UI:

```sh
pnpm platform:build
pnpm platform:start
```

## Use the installed package

After installing a dashboard-enabled release or a local candidate tarball:

```sh
npx visualguard dashboard project create storefront --name "Storefront Web"
npx visualguard dashboard
npx visualguard dashboard import /absolute/path/to/run --project storefront
npx visualguard dashboard export evidence.vgbackup.gz
npx visualguard dashboard --data-dir ./review restore evidence.vgbackup.gz
npx visualguard dashboard --data-dir ./review
```

There is no repository source, Vite, React install, browser install, or AI key requirement in the consuming/hosting project. See the walkthrough's release-candidate section before using public npm commands.

The [CLI project creation guide](../../docs/DASHBOARD-CLI-PROJECTS.md) covers `project create`/`project add`, existing IDs, `--server`, and administrator login. This follow-up has no executed checks or regenerated distribution build.

## Shared hosting

Google sign-in is available as the first phase of team onboarding. See the [Google sign-in guide](../../docs/GOOGLE-SIGN-IN.md) for the required environment values, OAuth callback registration, recovery administrator, local setup, and phase boundaries. New Google members need administrator-assigned project access; invitations and explicit account linking follow later.

Configure four settings: `VISUALGUARD_DATABASE_URL`, `VISUALGUARD_PUBLIC_URL`, `VISUALGUARD_ADMIN_EMAIL`, and `VISUALGUARD_ADMIN_PASSWORD`. PostgreSQL and MongoDB are selected from the URL automatically. The hosted public origin enables login and project permissions. Use a host secret store for credentials.

```sh
npx visualguard dashboard init --target vercel --out visualguard-dashboard
# or --target cloud-run
```

Both hosts use database-backed metadata, artifacts, sessions, and upload progress; local ephemeral filesystem storage is not required. Full provider setup and canonical URL bootstrapping are in the walkthrough.

## Scope and boundaries

Implemented: F01 history/comparison; F02 password accounts, optional OIDC, project roles, session/password revocation, scoped upload credentials and auditing; F03 job-level visual decisions, assignments, deadlines, discussion and inbox; F06 chunked remote publishing; portable evidence backups; SQLite file inspection; database adapters; installed-package CLI/API; deployment scaffolds; confirmed project/run deletion.

Use **Team review** on a run to discuss or decide an individual check, and **Review inbox** to find assigned work. The [F03 guide](../../docs/COLLABORATIVE-REVIEW.md) includes setup, API details, boundaries, and a manual walkthrough. No checks, builds, or tests were run locally for this extension.

The comparison viewer remains read-only; review decisions live separately beside the immutable evidence. Region-level approval, approved-baseline promotion (F04), managed browser scheduling, release gates, and automatic artifact retention remain separate features.

## Validation

```sh
pnpm platform:test
pnpm --filter visualguard build:dashboard
pnpm platform:test:package
```

Set `VISUALGUARD_TEST_DATABASE_URL` and `VISUALGUARD_TEST_MONGODB_URL` to disposable databases to include live adapter tests. Other configurations skip those optional integration cases. Formatting, lint, and type checks remain deferred until after F36.

[Access/storage details](ACCESS-AND-STORAGE.md) · [Remote publishing](REMOTE-PUBLISHING.md) · [Growth roadmap](../../docs/ORGANIZATION-GROWTH-PLAN.md)
