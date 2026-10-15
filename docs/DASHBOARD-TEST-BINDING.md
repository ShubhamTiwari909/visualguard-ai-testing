# Assign a dashboard project when running VisualGuard tests

Run the configured visual comparison and save its evidence to a dashboard project in one command:

```sh
npx visualguard test storefront
```

`storefront` is the project ID. You can also use an exact display name, quoted when it contains spaces:

```sh
npx visualguard test "Storefront Web"
```

IDs take precedence over display names. If more than one permitted project has the same display name, use its ID. Names are case-sensitive. Binding applies to this invocation; it does not rewrite your application's VisualGuard configuration or remember a default project for later plain `test` commands.

## Local setup: no extra configuration

From the same application directory:

```sh
npx visualguard test storefront --no-ai
npx visualguard dashboard
```

The command resolves the project before launching capture, runs the existing engine, then imports the exact newly saved run into local dashboard storage. No running dashboard server is required during the test. Open the dashboard afterward, or refresh an already-open one.

The default database remains `.visualguard/platform/metadata.sqlite` in the calling project. A missing valid project ID is created automatically using that ID as its initial display name. An unknown display name containing spaces is rejected; create that named project in the dashboard first. Ambiguous display names and reserved deleted IDs are rejected before capture.

The usual `VISUALGUARD_PLATFORM_DATA_DIR`, `VISUALGUARD_SQLITE_FILE`, and database URL settings select a different local database or PostgreSQL/MongoDB database. Use the same settings when starting the dashboard. A dashboard started from another folder uses a different local workspace unless you point both commands at the same database/data directory.

## Connect to an already-running dashboard

Use this when the dashboard runs in another local directory or on another computer:

```sh
npx visualguard test storefront --dashboard http://127.0.0.1:4400
```

For a loopback dashboard in its default local mode, no upload token is required. The project must already exist on that server. A local server configured for login still requires a project upload token.

For a hosted dashboard:

1. Create/select the project in **People & integrations**.
2. Create a project upload token and store it as `VISUALGUARD_UPLOAD_TOKEN` in your environment or CI secret settings.
3. Run:

```sh
npx visualguard test storefront --dashboard https://dashboard.example.com
```

Remote dashboards require HTTPS. The command resolves only a project the credential can publish to. It cannot create a remote project, browse other projects, or grant access. Hosted project creation remains an administrator action.

Both the installed CLI and dashboard server must contain this feature. The CLI uses the server's scoped publishing-project lookup before capture; an older server must be upgraded first.

## Configure a hosted destination once

In your application folder's ignored `.env.local`, set:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://dashboard.example.com
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

Then your normal command is:

```sh
npx visualguard test storefront
```

The test command already loads `.env` and `.env.local`. Existing process environment values take precedence over those files. An explicit `--dashboard` overrides `VISUALGUARD_DASHBOARD_URL`. Keep real upload tokens out of command-line arguments, committed files, and logs. CI can set the same two variables through its environment/secret settings.

Different hosted projects need the applicable project upload token. For a second project, select its token in that invocation's environment/CI job; one project token cannot publish to an unrelated project.

## Add labels or keep existing engine flags

```sh
npx visualguard test storefront \
  --environment preview \
  --branch feature/header \
  --commit abc123 \
  --pr 42 \
  --deployment preview-42 \
  --route /checkout \
  --viewport mobile \
  --no-ai
```

| Option | Behavior |
| --- | --- |
| Optional positional project | Enables automatic import/publishing |
| `--dashboard <origin>` | Uses the running server instead of direct local storage |
| `--environment` | Dashboard label; defaults to `staging` |
| `--branch`, `--commit`, `--pr`, `--deployment` | Optional dashboard labels |
| `--output-dir`, route/viewport/browser/AI flags | Existing engine behavior; publishing uses the actual returned run directory |
| `--list` | Lists the test plan only; does not create a project, capture, or publish |
| `--json` | Keeps manifest JSON on stdout; dashboard progress/errors go to stderr |

The project argument changes evidence storage, not the application's URLs, routes, baseline directory, or capture settings. An absent commit label still falls back to the engine's source revision. Individual shard uploads retain their incomplete status; merge all shards and publish the merged run when complete execution coverage is required.

## Failures, exit codes, and retrying saved evidence

Plain `npx visualguard test` keeps its existing offline behavior, even if a dashboard URL is configured. `--dashboard` supplied explicitly requires a positional project.

Preflight rejects invalid metadata, inaccessible projects, missing credentials, and unreachable dashboards before starting capture. With no server URL, explicitly binding a valid new ID creates a local project before capture; a capture failure can therefore leave an empty project.

Finalized runs are published even if they contain regressions, errors, or incomplete coverage. Their engine verdict remains unchanged. Publishing happens after the existing engine/reporters finish; an exception that prevents the engine from returning a saved run is reported through the existing capture/error handling.

If publishing fails after capture, the command prints the saved run directory and preserves the local files. A passing test with failed publishing exits with code **3**. An already-failing test keeps code **1**. Configuration errors use code **2**. The command never reports success when requested publishing fails.

Retry the saved evidence without recapturing, using the same labels:

```sh
# Local database, using the same database/data-directory settings:
npx visualguard dashboard import /absolute/path/to/saved-run \
  --project storefront --environment preview --branch feature/header

# Running/hosted dashboard, with its upload token in the environment:
npx visualguard dashboard publish /absolute/path/to/saved-run \
  --server https://dashboard.example.com \
  --project storefront --environment preview --branch feature/header
```

Include any original commit/PR/deployment labels too. Repeating a complete test command captures a new engine run; retry the saved directory when you want to resume that original run's upload. Imports and publishing keep the existing immutable-evidence and checksum rules.

## Manual acceptance checklist

No formatting, lint, type checks, builds, browser checks, or tests were run for this change, as requested. Regression cases have been prepared for later execution.

Use the source CLI or rebuild/repack the package yourself before trying these commands; an earlier installed package/tarball does not gain this feature automatically. For example, from this repository, the JavaScript/UI-only package build is `pnpm --filter visualguard build:dashboard`. This document does not claim that command was run.

1. Run a plain test. Confirm it creates no dashboard project or automatic upload.
2. Run `test storefront`. Start the dashboard from the same directory and confirm the run appears under that project.
3. Create a project named `Storefront Web`; use its quoted display name, then its ID. Confirm both target the same project.
4. Create duplicate display names locally. Confirm name lookup rejects ambiguity before capture; selecting an ID works.
5. Use an already-running local dashboard through `--dashboard`. Confirm it uses that server's existing project, not a new workspace in the caller's folder.
6. Set the two hosted environment settings and run the short command. Confirm the shared URL, image bytes, and labels are correct. Try a different project with the same token; expect rejection before capture.
7. Run against a UI with a known regression. Confirm the run is published and the command still exits nonzero.
8. Interrupt access to the dashboard after preflight but before upload. Confirm the local evidence remains, publishing fails visibly, and a passing test returns code 3. Retry the saved directory once connectivity returns.
9. Use `--list` with a new project ID. Confirm it creates no project and opens no browser.
10. Use `--json` and redirect stdout to a file. Confirm it contains the manifest and the dashboard messages appear on stderr.
11. Repeat with PostgreSQL and MongoDB using the dashboard's existing database configuration.

See the [standalone walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for installation, hosting, backups, and separate-project setup.
