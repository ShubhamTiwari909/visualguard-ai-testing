---
title: "Find what you need"
description: "A task map that links every VisualGuard goal to its command or dashboard screen and the page that explains it."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths: ["packages/visualguard/src/cli/program.ts", "packages/visualguard/src/cli/commands/dashboard.ts", "packages/visualguard/src/cli/shared.ts", "apps/platform/client/main.tsx", "packages/visualguard/src/sdk.ts"]
sidebar: {"order": 5}
---

Use this page when you know what you want to do but not where it lives. Find your goal in the left column. The middle column shows the command or dashboard screen. The right column links to the page that explains it step by step.

## Before you start

- Commands are shown in short form, such as `visualguard test`. In your app, run them as `npx --no-install visualguard test` (npm) or `pnpm exec visualguard test` (pnpm), from your app's root folder.
- Add `--help` to any command to see the options your installed release supports, for example `npx --no-install visualguard test --help`.
- Dashboard places are written as **sidebar item › button**. Some items only appear for maintainers or administrators.
- New to the words used here? See the [glossary](/concepts/glossary/).

## Run tests

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Set up VisualGuard in my app | `visualguard init` (add `--yes --production URL --staging URL --ai none` to skip questions) | [Install VisualGuard](/start/install/) |
| Check that Node.js, Playwright, the browser, the config and the URLs are ready | `visualguard doctor` | [Install VisualGuard](/start/install/) |
| Try VisualGuard on a site without writing a config | `visualguard https://example.com` | [Zero-config scans](/guides/zero-config-scans/) |
| Compare two sites without writing a config | `visualguard https://example.com https://staging.example.com` | [Zero-config scans](/guides/zero-config-scans/) |
| Compare production with staging using my config | `visualguard test` | [Run your first visual test](/start/quickstart/) |
| See which pages and screen sizes would be tested, without capturing | `visualguard test --list` | [Select routes](/guides/routes/) |
| Test only some pages | `visualguard test --route /pricing` or `--only "/blog/**"` | [Select routes](/guides/routes/) |
| Screenshot one marked section | Add `screenshot.selector: '[data-visualguard="checkout"]'` in the config, then run `visualguard test` | [Capture a single section](/guides/section-capture/) |
| Compare several sections on one page | Add named route entries with different `screenshot.selector` values | [Per-route section settings](/guides/section-capture/#4-choose-different-sections-per-route) |
| Test one screen size | `visualguard test --viewport mobile` | [Browsers and viewports](/guides/browsers-and-viewports/) |
| Use Firefox or WebKit instead of Chromium | `visualguard test --browser firefox` | [Browsers and viewports](/guides/browsers-and-viewports/) |
| Point a run at different URLs for one time | `visualguard test --production URL --staging URL` | [Configure your project](/guides/configuration/) |
| Also check accessibility or page speed | `visualguard test --a11y --perf` | [Accessibility and performance](/guides/accessibility-and-performance/) |
| Make screenshots repeatable (animations, clocks, dates) | `stabilize` settings in the config | [Make captures repeatable](/guides/stable-captures/) |
| Test pages behind a login | `visualguard auth staging`, then reuse the saved session | [Capture authenticated pages](/guides/application-auth/) |
| Re-test automatically while I edit code | `visualguard watch` | [Watch local development](/guides/watch/) |
| Check a page after a click or form step | `visualguard/playwright` test fixture | [Use inside Playwright tests](/guides/playwright/) |
| Run VisualGuard from my own script | `import { runVisualGuard } from "visualguard"`, then await the result | [SDK for scripts and CI](/guides/programmatic-api/) |
| Watch a live site for unexpected changes, such as nightly | `visualguard monitor` | [Monitor a site over time](/guides/monitoring/) |
| Start monitoring again from fresh snapshots | `visualguard monitor --reset` | [Monitor a site over time](/guides/monitoring/) |
| Save Playwright traces to debug a capture | `visualguard test --debug` | [Capture problems](/troubleshooting/capture/) |

## Understand results

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Open the report for the latest run | `visualguard report` | [Inspect and share reports](/guides/reports/) |
| Open an older run | `visualguard report --run RUN_ID` | [Inspect and share reports](/guides/reports/) |
| Write the HTML report without starting a server | `visualguard report --no-serve` | [Inspect and share reports](/guides/reports/) |
| Know what `pass`, `review`, `regression`, `accepted` and `error` mean | Report status filters | [Read result statuses](/concepts/results/) |
| Know why the command exited with 1, 2 or 3 | Exit code | [Exit codes](/reference/exit-codes/) |
| Choose which statuses fail the run | `visualguard test --fail-on review` | [Exit codes](/reference/exit-codes/) |
| Find the saved files for a run | `.visualguard/runs/RUN_ID/` | [Run artifacts](/reference/artifacts/) |
| Reduce noise from tiny pixel differences | `diff` settings in the config | [Tune differences and noise](/guides/diff-and-noise/) |
| Get machine-readable output | `visualguard test --json` or `--junit results.xml` (or `report.junit` in the config) | [Reporters and integrations](/guides/reporters/) |
| Send a summary to a webhook, such as a Slack workflow | `report.webhook` in the config | [Reporters and integrations](/guides/reporters/) |

## Accept and baseline

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Mark a change as intentional so it stops failing | `visualguard accept /pricing --note "New pricing copy"` | [Accept intentional changes](/guides/accepting-changes/) |
| Accept every `review` change in a run | `visualguard accept --all` | [Accept intentional changes](/guides/accepting-changes/) |
| Accept from the report | **Accept change** in the report opened by `visualguard report` | [Inspect and share reports](/guides/reports/) |
| Save reviewed screenshots as local baselines | `visualguard test --update-baselines` (with `mode: "baseline"`) | [Create local baselines](/guides/local-baselines/) |
| Compare my site against saved baselines | `visualguard test` with `mode: "baseline"` | [Create local baselines](/guides/local-baselines/) |
| Promote reviewed evidence to a team baseline | **Approved baselines › Promote as new version** (or **Create version 1**) | [Promote approved baselines](/dashboard/approved-baselines/) |
| Download an approved team baseline | `visualguard dashboard baseline pull SET --project ID --out DIR` | [Baseline command workflows](/reference/cli/baselines/) |

## AI

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Get plain-language explanations from Gemini | `ai: { provider: "gemini" }` and a `GEMINI_API_KEY` | [Add Gemini analysis](/guides/ai-gemini/) |
| Use a local model instead of a cloud service | `ai: { provider: "ollama", model: "..." }` | [Use a local Ollama model](/guides/ai-ollama/) |
| Run one test without AI | `visualguard test --no-ai` | [Add Gemini analysis](/guides/ai-gemini/) |
| Pick the provider or model for one run | `visualguard test --provider gemini --model MODEL_ID` | [Testing CLI options](/reference/cli/testing/) |
| Analyse a saved run again without capturing | `visualguard analyze --run RUN_ID --provider gemini` | [Control AI policy and cost](/guides/ai-policy-and-budgets/) |
| Ignore cached AI answers | `visualguard analyze --no-cache` | [Control AI policy and cost](/guides/ai-policy-and-budgets/) |
| Limit AI calls, tokens and time | `ai.maxCallsPerRun`, `ai.maxTokens`, `ai.timeoutMs` | [Control AI policy and cost](/guides/ai-policy-and-budgets/) |

## Fixes

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Get a proposed code fix for a regression | `visualguard fix` (asks before every change) | [Propose and verify a repair](/guides/fixes/) |
| Fix only some pages | `visualguard fix /checkout --viewport mobile` | [Propose and verify a repair](/guides/fixes/) |
| Also try fixes for `review` changes | `visualguard fix --include-review` | [Propose and verify a repair](/guides/fixes/) |
| Fix on a new branch without prompts | `visualguard fix --auto` | [Propose and verify a repair](/guides/fixes/) |
| Open a pull request with the verified fix | `visualguard fix --auto --pr` | [Propose and verify a repair](/guides/fixes/) |

## Automate & CI

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Run visual tests on every pull request | GitHub Action, or `visualguard test --ci` in any CI | [Run visual tests in CI](/ci/overview/) |
| Control comparisons and CI failure from JavaScript | `runVisualGuard({ failOn: 'review' })`, then set `process.exitCode = result.exitCode` | [SDK setup and CI workflow](/guides/programmatic-api/) |
| Create a GitHub workflow file | `visualguard init --workflow` | [Use the GitHub Action](/ci/github-actions/) |
| Create a scheduled monitoring workflow | `visualguard monitor --workflow "0 3 * * *"` | [Monitor a site over time](/guides/monitoring/) |
| Post or update a summary comment on the pull request | `visualguard comment --link REPORT_URL` (try `--dry-run` first) | [Use the GitHub Action](/ci/github-actions/) |
| Test the exact preview deployment of a pull request | `visualguard test PROJECT --dashboard URL --staging PREVIEW_URL --commit SHA --pr NUMBER` | [Test the preview revision](/ci/preview-deployments/) |
| Split a large suite across CI jobs | `visualguard test --shard 1/4 --run-group ID` | [Shard and merge](/ci/sharding/) |
| Combine shard results into one report | `visualguard merge DIR...` | [Shard and merge](/ci/sharding/) |
| Show a VisualGuard check on the GitHub pull request | `visualguard dashboard policy reconcile --project ID --pr NUMBER` | [GitHub checks](/ci/github-checks/) |
| Fail CI unless the team's visual policy is met | `visualguard dashboard policy assess --project ID --revision SHA --enforce` | [Evaluate a visual policy](/dashboard/visual-policies/) |

## Dashboard & team

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Start a dashboard on my computer | `visualguard dashboard --env-file .env.visualguard` | [Start a local dashboard](/dashboard/local/) |
| Use another port, data folder or SQLite file | `visualguard dashboard --port 4500 --data-dir DIR` or `--file FILE` | [Dashboard CLI options](/reference/cli/dashboard/) |
| Get a guided tour of the screens | **Run history**, **Review inbox**, **Approved baselines** and more | [Dashboard tour](/dashboard/tour/) |
| Create a project | `visualguard dashboard project create ID --name "Name"`, or **Create project** in the dashboard | [Projects, names and identities](/dashboard/projects/) |
| Save a run straight into a dashboard project | `visualguard test PROJECT --dashboard URL` | [Publish saved evidence](/dashboard/publishing/) |
| Import a saved run into the local database | `visualguard dashboard import .visualguard/runs/RUN_ID --project ID` | [Start a local dashboard](/dashboard/local/) |
| Publish a saved run to a hosted dashboard | `visualguard dashboard publish DIR --project ID --server URL` with `VISUALGUARD_UPLOAD_TOKEN` | [Publish saved evidence](/dashboard/publishing/) |
| Create an upload token for CI | **People & integrations › Create upload token** | [Publish saved evidence](/dashboard/publishing/) |
| Save which routes and viewports a project tests | Project page › **Save test configuration** | [Configure tests per project](/dashboard/project-configuration/) |
| Start a test from the dashboard | Project page › **Run test** | [Run tests from the dashboard](/dashboard/run-tests/) |
| Connect my own machine to run dashboard tests | Project page › **Create 30-day runner credential**, then `visualguard dashboard runner --project ID --server URL` | [Private runners](/dashboard/private-runners/) |
| Watch a requested test while it runs | Project page progress panel | [Execution progress](/dashboard/execution-progress/) |
| Compare screenshots for a run | **Run history** › a run › **Open comparison viewer** | [Review exact visual evidence](/dashboard/reviews/) |
| Approve or reject a visual change | **Review inbox** › a check › **Approve visual change** or **Request changes** | [Review exact visual evidence](/dashboard/reviews/) |
| Ask a teammate to review | **Review inbox** › **Assign a reviewer** | [Review exact visual evidence](/dashboard/reviews/) |
| Set the rules a release must meet | **Visual regression policy › Save new policy version** | [Evaluate a visual policy](/dashboard/visual-policies/) |
| Turn on login | `VISUALGUARD_AUTH_MODE=login` in the dashboard environment | [Enable dashboard login](/dashboard/login/) |
| Let people sign in with Google | Google OAuth settings | [Google sign-in](/dashboard/google-sign-in/) |
| Invite a teammate | **People & integrations › Create invitation** | [People and permissions](/dashboard/people-and-permissions/) |
| Change someone's project role | **People & integrations › Grant access** | [People and permissions](/dashboard/people-and-permissions/) |

## Deploy & operate

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| Decide where to host the dashboard | — | [Choose dashboard hosting](/deployment/overview/) |
| Generate a ready-to-deploy Cloud Run folder | `visualguard dashboard init --target cloud-run` | [Deploy to Cloud Run](/deployment/cloud-run/) |
| Generate a ready-to-deploy Vercel folder | `visualguard dashboard init --target vercel` | [Deploy to Vercel](/deployment/vercel/) |
| Copy the prebuilt dashboard UI for static hosting | `visualguard dashboard assets --out DIR` | [Dashboard CLI options](/reference/cli/dashboard/) |
| Use PostgreSQL or Cloud SQL | `VISUALGUARD_DATABASE_URL` | [Use PostgreSQL](/deployment/postgresql/), [Cloud SQL](/deployment/cloud-sql/) |
| Use MongoDB | `VISUALGUARD_DATABASE_URL` | [Use MongoDB](/deployment/mongodb/) |
| Back up dashboard evidence to a file | `visualguard dashboard export FILE` | [Store evidence and recover](/deployment/storage-and-backups/) |
| Restore a backup without overwriting evidence | `visualguard dashboard restore FILE` | [Store evidence and recover](/deployment/storage-and-backups/) |
| See the audit log or recover administrator access | **Audit & recovery** (administrators) | [Audit and recover access](/deployment/operations-and-recovery/) |
| Upgrade an existing install | — | [Upgrade an installation](/deployment/upgrades/) |

## Reference & help

| I want to… | Command or UI place | Read |
| --- | --- | --- |
| See every command at a glance | `visualguard --help` | [Command reference](/reference/cli/) |
| See every option of the testing commands | `visualguard COMMAND --help` | [Testing CLI options](/reference/cli/testing/) |
| See every option of the dashboard commands | `visualguard dashboard --help` | [Dashboard CLI options](/reference/cli/dashboard/) |
| Look up a config field | `visualguard.config.ts` | [Configuration fields](/reference/configuration/) |
| Look up an environment variable | `.env.local`, `.env.visualguard` or host settings | [Environment variables](/reference/environment/) |
| Check which Node, Playwright and browsers are covered | — | [Compatibility](/reference/compatibility/) |
| Check my installed version | `visualguard --version` and `npm ls visualguard --depth=0` | [Release availability](/releases/) |
| Get a quick answer to a common question | — | [Frequently asked questions](/concepts/faq/) |
| Fix an error | — | [Troubleshooting](/troubleshooting/) |

:::note
The **Run test** button uses dashboard-host capture when the installed dashboard supports it and the host can run Chromium. Otherwise connect a private runner. See [release availability](/releases/).
:::

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `command not found` or the wrong version runs | Use `npx --no-install visualguard` from your app's root so the locally installed package runs. See [installation problems](/troubleshooting/installation/). |
| An option from this page is rejected | Your installed release may be older. Run `visualguard COMMAND --help` and check [release availability](/releases/). |
| A dashboard button is missing | Your role may not allow it. Ask a maintainer or administrator. See [people and permissions](/dashboard/people-and-permissions/). |
| `dashboard` options are ignored | Put `--port`, `--data-dir`, `--file` and `--env-file` before any subcommand, such as `dashboard --env-file .env.visualguard import ...`. |

## Next steps

- [Run your first visual test](/start/quickstart/) if you have not yet.
- [Frequently asked questions](/concepts/faq/) for short answers.
- [Command reference](/reference/cli/) for the full list of options.
