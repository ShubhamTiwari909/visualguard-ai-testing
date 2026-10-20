---
title: "Environment variables"
description: "Identify variable scope, defaults, secret handling and the file loader used by each VisualGuard process."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["packages/visualguard/src/config/load.ts", "packages/visualguard/src/config/resolve.ts", "apps/platform/server/config.ts", "apps/platform/server/auth.ts", "apps/platform/.env.example"]
sidebar: {"order": 3}
---

## Which process loads which file?

| Invocation | Environment-loading rule |
| --- | --- |
| `visualguard test` and capture configuration | Loads application-root `.env`, then `.env.local`. Later file values win, but preexisting process/CI values are never overwritten. CLI overrides win over variables, then config, then defaults. |
| Installed `visualguard dashboard` and subcommands | Use an explicit `--env-file FILE` where your guide specifies it; do not assume all subcommands automatically read application `.env.local`. Startup options go before a subcommand. |
| Source `pnpm platform:dev` / source operator tools | Source the intended file into that same shell/process explicitly; the source server does not automatically load `apps/platform/.env.local`. |
| Hosted dashboard | Configure the provider's server-side environment/secrets and restart/redeploy. A file on your laptop does not configure the service. |
| Private runner | Pass its private environment file before `runner` or use the CI secret environment. Keep application/AI credentials on the capture worker. |

Real passwords, API keys, cookies, token files and DB URIs are private. Do not put them in a static website build or public frontend-prefixed variables. The default column describes selection behavior; actual CLI/config overrides are explained in each guide.

## Capture and analysis

| Variable | Process | Default / fallback | Sensitive | Purpose |
| --- | --- | --- | --- | --- |
| `VISUALGUARD_BUILT_IN_RUNNER` | Dashboard | on, except on Vercel | No | `on`/`off`. Lets the dashboard run **Run test** itself with the signed-in user's authorization; off requires a private runner. Needs Chromium on the host. |
| `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY` | Dashboard | 1 | No | Maximum simultaneous built-in tests across projects. |
| `VISUALGUARD_PRODUCTION_URL` | Runner | config production URL | No | Overrides the reference base URL. |
| `VISUALGUARD_STAGING_URL` | Runner | config staging URL | No | Overrides the candidate base URL; use the actual ready preview. |
| `VISUALGUARD_BROWSER` | Runner | config; chromium default | No | chromium, firefox or webkit; browser binaries must be installed. |
| `VISUALGUARD_OUTPUT_DIR` | Runner | config; .visualguard default | No | Local evidence output directory; use the same value for reports and artifact uploads. |
| `VISUALGUARD_AI_PROVIDER` | Runner | config; none default | No | gemini, ollama or none; explicit CLI --provider wins. |
| `GEMINI_API_KEY` | Runner | unset | Yes | Gemini API key; takes precedence over GOOGLE_API_KEY. |
| `GOOGLE_API_KEY` | Runner | unset | Yes | Fallback Gemini credential, unrelated to dashboard OAuth. |
| `OLLAMA_HOST` | Runner | http://127.0.0.1:11434 | No | Reachable local vision-model service; install/select a compatible model separately. |
| `VISUALGUARD_GEMINI_BASE_URL` | Runner | provider endpoint | No | Provider endpoint override; use only a trusted compatible endpoint and verify evidence routing. |
| `VISUALGUARD_WEBHOOK_URL` | Runner | config webhook or unset | Treat as private | Summary receiver; does not host reports. |
| `VISUALGUARD_RUN_GROUP` | Runner/shards | GitHub run identity when available | No | Unique execution group shared by all shards of one run. |
| `VISUALGUARD_UPDATE_BASELINES` | Playwright fixture | unset | No | Explicit snapshot update control; do not enable as a blanket CI fix. |
| `VISUALGUARD_DEBUG` | Runner | unset | No | Additional capture diagnostics; inspect output before sharing. |

## Dashboard process and storage

| Variable | Process | Default / fallback | Sensitive | Purpose |
| --- | --- | --- | --- | --- |
| `VISUALGUARD_DATABASE_URL` | Dashboard/host tools | DATABASE_URL fallback | Yes | PostgreSQL or MongoDB URI. An explicit empty value selects SQLite instead of an unrelated DATABASE_URL. |
| `DATABASE_URL` | Dashboard fallback | unset | Yes | Generic fallback only when the VisualGuard-specific setting is absent; avoid inheriting an application database accidentally. |
| `VISUALGUARD_PLATFORM_DATA_DIR` | Dashboard/host tools | .visualguard/platform under calling project | No | Absolute directory recommended for repeatable source/operator setup; not a remote object bucket. |
| `VISUALGUARD_SQLITE_FILE` | Dashboard/host tools | metadata.sqlite inside data directory | No | Explicit local SQLite path; dashboard --file requires an existing file and no external DB URL. |
| `VISUALGUARD_PLATFORM_PORT` | Dashboard | PORT or 4400 | No | Listener port when no explicit --port is supplied. |
| `PORT` | Dashboard fallback | 4400 | No | Host-provided listener port; Cloud Run scaffold uses its container port. |
| `VISUALGUARD_HOST` | Dashboard | loopback, or 0.0.0.0 for hosted/public URL | No | Public binding requires login mode and appropriate origin settings. |
| `VISUALGUARD_AUTH_MODE` | Dashboard | local, or login when hosted/public URL | No | Set local for a trusted loopback trial; login for shared access. |
| `VISUALGUARD_PUBLIC_URL` | Dashboard | local runtime URL when appropriate | No | Exact canonical HTTPS origin for shared hosting; no path/query. Local trial must use the exact loopback origin. |
| `VISUALGUARD_USER_ADMISSION` | Dashboard | invite for fresh hosted team setup | No | invite or legacy; upgraded existing-user installations must explicitly choose where required. |
| `VISUALGUARD_ADMIN_EMAIL` | Dashboard | unset | Private identity | Initial administrator email/provider-bootstrap match as implemented; not a publication token. |
| `VISUALGUARD_ADMIN_PASSWORD` | Dashboard | unset | Yes | Initial password bootstrap (12–256 characters). Changing it does not overwrite a persisted account. |

## Google and GitHub server integration

| Variable | Process | Default / fallback | Sensitive | Purpose |
| --- | --- | --- | --- | --- |
| `VISUALGUARD_OIDC_ISSUER` | Dashboard | unset | No | https://accounts.google.com for Google; issuer/client ID/secret must be supplied together. |
| `VISUALGUARD_OIDC_CLIENT_ID` | Dashboard | unset | No | Google Web OAuth client, with exact canonical /api/auth/callback registered. |
| `VISUALGUARD_OIDC_CLIENT_SECRET` | Dashboard | unset | Yes | Server-side OAuth client secret; never expose through frontend prefixes. |
| `VISUALGUARD_OIDC_ADMIN_SUBJECTS` | Dashboard | unset | Private identity | Comma-separated provider subjects for supported initial bootstrap; not an ongoing role-management command. |
| `VISUALGUARD_GITHUB_TOKEN` | Dashboard | unset | Yes | Supported server-side Checks write / PR read credential; deployment owns expiry and renewal. |
| `VISUALGUARD_GITHUB_REPOSITORIES` | Dashboard | unset | No | Internal immutable project-key to owner/repository mappings, separated by commas. |
| `VISUALGUARD_GITHUB_WEBHOOK_SECRET` | Dashboard | unset | Yes | Secret for verifying original signed Pull requests webhook bytes. |

## Publishing and private workers

| Variable | Process | Default / fallback | Sensitive | Purpose |
| --- | --- | --- | --- | --- |
| `VISUALGUARD_DASHBOARD_URL` | Capture/publish worker | explicit --dashboard/--server or unset | No | Canonical reachable dashboard origin. Setting this does not start a dashboard process. |
| `VISUALGUARD_UPLOAD_TOKEN` | Capture/publish worker | unset | Yes | Project-scoped upload credential; no account administration or queue-claim authority. |
| `VISUALGUARD_RUNNER_TOKEN` | Private runner | unset | Yes | Separate project-scoped expiring runner credential, not an upload-only token. |

## CI integration and host context

| Variable | Process | Default / fallback | Sensitive | Purpose |
| --- | --- | --- | --- | --- |
| `CI` | CLI | CI-provider environment | No | Noninteractive environment hint; use explicit --ci for predictable automation. |
| `GITHUB_TOKEN` | Comment command | unset | Yes | PR comment authorization; distinct from the dashboard server Check Runs token. |
| `GITHUB_REPOSITORY` | CLI/CI | unset | No | owner/repository identity for comments and CI metadata. |
| `GITHUB_SHA` | CLI/CI | unset | No | CI revision hint; do not assume a temporary merge SHA is the actually deployed PR head. |
| `GITHUB_EVENT_PATH` | CLI/CI | unset | No | GitHub event metadata file supplied by Actions. |
| `GITHUB_RUN_NUMBER` | CLI/CI | unset | No | CI run label; not a source revision. |
| `GITHUB_STEP_SUMMARY` | CLI/CI | unset | No | Summary output file supplied by Actions. |
| `GITHUB_API_URL` | Comment integration | GitHub public API | No | API base for the supported GitHub environment. |
| `VERCEL` | Dashboard host | unset | No | Host context enabling hosted-mode defaults; use persistent external DB. |
| `K_SERVICE` | Dashboard host | unset | No | Cloud Run service context enabling hosted-mode defaults; use persistent external DB. |

## Verify changes

Restart the process that owns the setting, run health/doctor as appropriate and inspect actual selected behavior. Unset stale exported values if the intended file is being ignored. Use [dashboard setup](/dashboard/local/), [AI setup](/guides/ai-gemini/) or [private runners](/dashboard/private-runners/) for complete file and command sequences.
