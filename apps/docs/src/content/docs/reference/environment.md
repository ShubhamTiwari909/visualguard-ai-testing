---
title: "Environment variables"
description: "Every environment variable VisualGuard reads, grouped by purpose, with the process that reads it, its default, whether it is secret and what it does."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-27"
sourcePaths:
  [
    "packages/visualguard/src/config/load.ts",
    "packages/visualguard/src/config/resolve.ts",
    "packages/visualguard/src/ai/factory.ts",
    "packages/visualguard/src/core/run.ts",
    "packages/visualguard/src/core/runs.ts",
    "packages/visualguard/src/cli/shared.ts",
    "packages/visualguard/src/reporters/github-comment.ts",
    "apps/platform/server/config.ts",
    "apps/platform/server/object-storage.ts",
    "apps/platform/server/runtime.ts",
    "apps/platform/server/auth.ts",
    "apps/platform/server/built-in-runner.ts",
    "apps/platform/.env.example",
  ]
sidebar: { "order": 3 }
---

Environment variables let you change VisualGuard settings without editing the config file, and they are where secrets such as API keys and tokens belong. This page lists every variable VisualGuard reads, which process reads it, its default, whether it is secret, and what it does.

## Before you start

- Know which process you are configuring. A test run, the dashboard server and a private runner are separate processes. Each one only sees its own environment.
- Command-line options win over environment variables. Environment variables win over the config file. The config file wins over built-in defaults.

## Which process loads which file?

| Process                                                          | How it gets its settings                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visualguard test` and other capture commands                    | Load `.env`, then `.env.local`, from your app's root folder. `.env.local` wins over `.env`. Values already set in the shell or CI are never overwritten.                                                                              |
| `visualguard dashboard` and its subcommands                      | Pass `--env-file FILE` before the subcommand, for example `visualguard dashboard --env-file .env.visualguard publish ...`. Do not assume a subcommand reads your app's `.env.local`. Values already in the process win over the file. |
| Source dashboard (`pnpm platform:dev`) and source operator tools | Load the file into the same shell yourself, for example with `set -a; . apps/platform/.env.local; set +a`. The source server does not read `apps/platform/.env.local` on its own.                                                     |
| Hosted dashboard (Vercel, Cloud Run)                             | Set variables and secrets in the host's settings, then redeploy or restart. A file on your laptop does not configure the hosted service.                                                                                              |
| Private runner                                                   | Load its own private settings before `visualguard dashboard runner`, or use CI secrets. Keep app and AI credentials on the machine that captures.                                                                                     |

The **Secret** column marks values you must keep private. Never put secrets in a static website build or in variables with a public frontend prefix. After you change a value, restart the process that reads it.

## Capture and analysis

Read by `visualguard test`, `monitor`, `watch`, `analyze`, `fix` and the zero-config scan, on your computer or a CI machine.

| Variable                       | Read by                          | Default                                                                 | Secret          | Purpose                                                                                                                                                 |
| ------------------------------ | -------------------------------- | ----------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VISUALGUARD_PRODUCTION_URL`   | Capture commands                 | `baseURL.production` from config                                        | No              | Overrides the production (reference) base URL. `--production` wins.                                                                                     |
| `VISUALGUARD_STAGING_URL`      | Capture commands                 | `baseURL.staging` from config                                           | No              | Overrides the staging (candidate) base URL, for example a pull request preview. `--staging` wins.                                                       |
| `VISUALGUARD_BROWSER`          | Capture commands                 | `browser.name` from config, which defaults to `chromium`                | No              | `chromium`, `firefox` or `webkit`. The browser must be installed. Any other value fails with `VISUALGUARD_BROWSER must be chromium, firefox or webkit.` |
| `VISUALGUARD_OUTPUT_DIR`       | Capture, report and fix commands | `output.dir` from config, which defaults to `.visualguard`              | No              | Folder for run files. Use the same value for `report` and for CI artifact uploads.                                                                      |
| `VISUALGUARD_AI_PROVIDER`      | Capture commands                 | `ai.provider` from config, which defaults to `none`                     | No              | `gemini`, `ollama` or `none`. `--provider` wins.                                                                                                        |
| `GEMINI_API_KEY`               | Capture, `analyze`, `fix`        | Not set                                                                 | Yes             | Gemini API key. Without it, Gemini analysis is skipped and heuristics are used.                                                                         |
| `GOOGLE_API_KEY`               | Capture, `analyze`, `fix`        | Not set                                                                 | Yes             | Fallback Gemini key, used only when `GEMINI_API_KEY` is not set. Unrelated to dashboard Google sign-in.                                                 |
| `VISUALGUARD_GEMINI_BASE_URL`  | Capture, `analyze`, `fix`        | Gemini's own endpoint                                                   | No              | Sends Gemini requests to another compatible endpoint. Use only an endpoint you trust, because it receives your screenshots.                             |
| `OLLAMA_HOST`                  | Capture, `analyze`, `fix`        | `http://127.0.0.1:11434`                                                | No              | Address of your Ollama server. Install a model that can read images separately.                                                                         |
| `VISUALGUARD_WEBHOOK_URL`      | `test`, `monitor`                | `report.webhook` from config                                            | Treat as secret | Receives a run summary, for example in Slack. It does not host the report.                                                                              |
| `VISUALGUARD_RUN_GROUP`        | `test --shard`                   | `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT` in GitHub Actions; otherwise not set | No              | One shared name for all shards of one execution. Required for shards outside GitHub Actions. `--run-group` wins.                                        |
| `VISUALGUARD_UPDATE_BASELINES` | Playwright fixture               | Not set                                                                 | No              | Any non-empty value saves new baselines from `visualguard/playwright` tests. Do not set it in CI to hide failures.                                      |
| `VISUALGUARD_DEBUG`            | All CLI commands                 | Not set                                                                 | No              | Prints the full stack trace for unexpected errors. Check the output for private data before you share it.                                               |

## Dashboard server and storage

Read by `visualguard dashboard`, the hosted dashboard, and dashboard subcommands that use the local database.

| Variable                           | Read by                         | Default                                                                                                     | Secret  | Purpose                                                                                                                                                                                                                                                      |
| ---------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VISUALGUARD_DATABASE_URL`         | Dashboard and local subcommands | `DATABASE_URL`, then local SQLite                                                                           | Yes     | PostgreSQL (`postgresql://`, `postgres://`) or MongoDB (`mongodb://`, `mongodb+srv://`) URL. Set it to an empty value to force SQLite even when `DATABASE_URL` exists.                                                                                       |
| `DATABASE_URL`                     | Dashboard and local subcommands | Not set                                                                                                     | Yes     | Generic fallback, used only when `VISUALGUARD_DATABASE_URL` is absent. Avoid picking up another app's database by accident.                                                                                                                                  |
| `VISUALGUARD_PLATFORM_DATA_DIR`    | Dashboard and local subcommands | The folder of `VISUALGUARD_SQLITE_FILE` if set; otherwise `.visualguard/platform` under the starting folder | No      | Local data folder. Use an absolute path for repeatable setups. `--data-dir` sets it too. It is not a cloud bucket.                                                                                                                                           |
| `VISUALGUARD_SQLITE_FILE`          | Dashboard and local subcommands | `metadata.sqlite` in the data folder                                                                        | No      | Exact SQLite file. `dashboard --file` needs an existing file and no external database URL.                                                                                                                                                                   |
| `VISUALGUARD_ARTIFACT_STORAGE_URL` | Dashboard and local subcommands | Not set: screenshots stay in the database                                                                   | No      | Stores new screenshot bytes in `s3://BUCKET/PREFIX`, `gs://BUCKET/PREFIX` or `azure://CONTAINER/PREFIX`. Needs the provider SDK installed. Never put keys in it. See [object storage](/deployment/storage-and-backups/#store-screenshots-in-object-storage). |
| `AZURE_STORAGE_CONNECTION_STRING`  | Dashboard and local subcommands | Not set                                                                                                     | Yes     | Required with an `azure://` storage URL.                                                                                                                                                                                                                     |
| `INIT_CWD`                         | Dashboard                       | Set by npm and pnpm scripts                                                                                 | No      | The folder the package manager was started from. Used as the base for the default data folder.                                                                                                                                                               |
| `VISUALGUARD_PLATFORM_PORT`        | Dashboard                       | `PORT`, then `4400`                                                                                         | No      | Listening port when `--port` is not given.                                                                                                                                                                                                                   |
| `PORT`                             | Dashboard                       | `4400`                                                                                                      | No      | Port provided by the host. Cloud Run sets it; the generated Cloud Run image uses `8080`.                                                                                                                                                                     |
| `VISUALGUARD_HOST`                 | Dashboard                       | `127.0.0.1`; `0.0.0.0` on Cloud Run or when `VISUALGUARD_PUBLIC_URL` is set                                 | No      | Listening address. Listening on a public address requires login mode.                                                                                                                                                                                        |
| `VISUALGUARD_AUTH_MODE`            | Dashboard                       | `local`; `login` when `VISUALGUARD_PUBLIC_URL` is set, or on Vercel or Cloud Run                            | No      | `local` for a trusted trial on your own computer, `login` for shared access.                                                                                                                                                                                 |
| `VISUALGUARD_PUBLIC_URL`           | Dashboard                       | Not set; a local dashboard uses its own `http://HOST:PORT`                                                  | No      | The exact public origin, with no path or query, for example `https://visualguard.example.com`. Hosted login requires it.                                                                                                                                     |
| `VISUALGUARD_USER_ADMISSION`       | Dashboard                       | `invite` for a new installation; the stored choice afterwards                                               | No      | `invite` (new users need an invitation) or `legacy`. Upgrades with existing users and no stored choice must set it, or start-up stops.                                                                                                                       |
| `VISUALGUARD_ADMIN_EMAIL`          | Dashboard                       | Not set                                                                                                     | Private | Email of the first administrator. Also lets a matching verified Google login become the first administrator when no password is set.                                                                                                                         |
| `VISUALGUARD_ADMIN_PASSWORD`       | Dashboard                       | Not set                                                                                                     | Yes     | Password for the first administrator, 12 to 256 characters. Changing it later does not change an existing account.                                                                                                                                           |

### Run test on the dashboard host

:::note[Availability]
These variables configure dashboards that support built-in capture. If your installed dashboard does not offer it, upgrade or connect a private runner. Confirm availability in the project's execution status.
:::

| Variable                                  | Read by   | Default              | Secret | Purpose                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | --------- | -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VISUALGUARD_BUILT_IN_RUNNER`             | Dashboard | On, except on Vercel | No     | `on` lets the dashboard capture **Run test** itself, using the signed-in user's login, when no private runner is connected. `off`, `0`, `false` or `no` turns it off, so a private runner is required. The host needs Chromium (the generated Cloud Run image includes it). |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` | Dashboard | `1`                  | No     | Most built-in tests that can run at the same time across all projects in one dashboard process. Each server replica has its own limit. Extra requests see `The dashboard is running another test; try again shortly`.                                                       |

## Google sign-in and GitHub checks

Read by the dashboard server only. Keep them server-side.

| Variable                            | Read by   | Default | Secret  | Purpose                                                                                                                   |
| ----------------------------------- | --------- | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `VISUALGUARD_OIDC_ISSUER`           | Dashboard | Not set | No      | `https://accounts.google.com` for Google. Set issuer, client ID and client secret together.                               |
| `VISUALGUARD_OIDC_CLIENT_ID`        | Dashboard | Not set | No      | Google web OAuth client ID. Register `PUBLIC_URL/api/auth/callback` as its callback.                                      |
| `VISUALGUARD_OIDC_CLIENT_SECRET`    | Dashboard | Not set | Yes     | Google OAuth client secret. Never expose it to the browser.                                                               |
| `VISUALGUARD_OIDC_ADMIN_SUBJECTS`   | Dashboard | Not set | Private | Comma-separated Google account IDs (subjects) allowed to become the first administrator. Not a way to manage roles later. |
| `VISUALGUARD_GITHUB_TOKEN`          | Dashboard | Not set | Yes     | Token with Checks write and Pull requests read access, used to publish GitHub checks. Your deployment renews it.          |
| `VISUALGUARD_GITHUB_REPOSITORIES`   | Dashboard | Not set | No      | Comma-separated `projectId=owner/repo` pairs, for example `storefront=your-org/your-repo`. Use internal project IDs.      |
| `VISUALGUARD_GITHUB_WEBHOOK_SECRET` | Dashboard | Not set | Yes     | Secret that verifies signed GitHub pull request webhooks.                                                                 |

## Publishing and private runners

Read by test machines and runners that talk to a dashboard.

| Variable                    | Read by                                                                             | Default                                   | Secret | Purpose                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `VISUALGUARD_DASHBOARD_URL` | `test PROJECT`, `dashboard project create`, `baseline pull`, `policy` commands      | Not set; `--dashboard` or `--server` wins | No     | Dashboard origin to use when no flag is given. Setting it does not start a dashboard.                                                   |
| `VISUALGUARD_UPLOAD_TOKEN`  | `test PROJECT --dashboard`, `dashboard publish`, `baseline pull`, `policy` commands | Not set                                   | Yes    | Project upload token. It can publish runs but cannot manage accounts or claim tests. Not needed for a loopback dashboard in local mode. |
| `VISUALGUARD_RUNNER_TOKEN`  | `dashboard runner`                                                                  | Not set                                   | Yes    | Project runner credential. Separate from the upload token; an upload token does not work here.                                          |

## CI and hosting context

These are usually set by your CI system or host. You rarely set them yourself.

| Variable                              | Read by          | Default                  | Secret | Purpose                                                                                                   |
| ------------------------------------- | ---------------- | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| `CI`                                  | CLI              | Set by most CI systems   | No     | Turns off prompts and colours. Values `false` and `0` count as not CI. Use `--ci` for predictable output. |
| `GITHUB_TOKEN`                        | `comment`        | Not set                  | Yes    | Authorizes the pull request comment. Different from `VISUALGUARD_GITHUB_TOKEN`.                           |
| `GH_TOKEN`                            | `comment`        | Not set                  | Yes    | Fallback when `GITHUB_TOKEN` is not set.                                                                  |
| `GITHUB_REPOSITORY`                   | `comment`        | Set by GitHub Actions    | No     | `owner/repo` for the comment. `--repo` wins.                                                              |
| `GITHUB_EVENT_PATH`                   | `comment`        | Set by GitHub Actions    | No     | Event file used to find the pull request number. `--pr` wins.                                             |
| `GITHUB_SHA`                          | `comment`        | Set by GitHub Actions    | No     | Commit shown in the comment. It can be a temporary merge commit, not the pull request head.               |
| `GITHUB_API_URL`                      | `comment`        | `https://api.github.com` | No     | GitHub API address, for GitHub Enterprise.                                                                |
| `GITHUB_STEP_SUMMARY`                 | `test`           | Set by GitHub Actions    | No     | File that receives a Markdown job summary when `report.githubSummary` is on.                              |
| `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT` | `test --shard`   | Set by GitHub Actions    | No     | Build the default run group for shards.                                                                   |
| `GITHUB_RUN_NUMBER`                   | Capture commands | Set by GitHub Actions    | No     | Used as the run number in the run folder name. It is a CI counter, not a commit.                          |
| `CI_PIPELINE_IID`                     | Capture commands | Set by GitLab CI         | No     | Run number fallback when `GITHUB_RUN_NUMBER` is not set.                                                  |
| `VERCEL`                              | Dashboard        | Set by Vercel            | No     | Switches on hosted defaults: login mode, a required external database, and no built-in runner.            |
| `K_SERVICE`                           | Dashboard        | Set by Cloud Run         | No     | Switches on hosted defaults: login mode, listening on `0.0.0.0` and a required external database.         |

## Example: a CI job with a preview URL

```bash
export VISUALGUARD_STAGING_URL="https://pr-42.preview.example.com"
export GEMINI_API_KEY="..."   # from CI secrets
npx --no-install visualguard test --ci --junit reports/visualguard.xml
```

You should see the run compare production with the preview URL, with AI explanations for changed pages.

## Verify your settings

1. Restart the process that reads the variable.
2. For capture settings, run `npx --no-install visualguard doctor` and `npx --no-install visualguard test --list`. You should see the URLs, browser and AI provider you expect.
3. For the dashboard, open `/api/health` and check the projects and sign-in mode in the UI.
4. If a value seems ignored, look for an older exported value in your shell with `env | grep VISUALGUARD` (do not paste the output anywhere, it may contain secrets) and unset it.

## Troubleshooting

| Problem                                                                     | Fix                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| A `.env.local` value is ignored                                             | The shell or CI already sets that variable, and existing values win. Unset it. |
| The dashboard ignores `.env.local`                                          | The dashboard does not read it. Use `--env-file`.                              |
| `VISUALGUARD_AI_PROVIDER must be gemini, ollama or none`                    | Fix or unset the variable.                                                     |
| `Cloud Run and Vercel require VISUALGUARD_DATABASE_URL for persistent data` | Set an external database URL.                                                  |
| `Hosted login requires VISUALGUARD_PUBLIC_URL`                              | Set the exact public origin.                                                   |

More help: [dashboard problems](/troubleshooting/dashboard/).

## Next steps

- [Set up the local dashboard](/dashboard/local/) with a settings file.
- [Set up Gemini](/guides/ai-gemini/) and keep the key out of your repository.
- [Run private runners](/dashboard/private-runners/) with their own credential.
