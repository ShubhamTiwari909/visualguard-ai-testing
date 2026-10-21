---
title: "Run visual tests in CI"
description: "Choose a CI setup, run VisualGuard on every pull request and keep the screenshots when a comparison fails."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths: ["README.md", "packages/visualguard/src/setup/workflow-template.ts", "packages/visualguard/src/cli/commands/comment.ts", "packages/visualguard/src/cli/commands/monitor.ts", "action/action.yml", "packages/visualguard/src/sdk.ts"]
sidebar: {"order": 1}
---

This page shows how to run VisualGuard in continuous integration (CI), so every pull request is compared automatically. It covers four ways to set it up, the steps every CI job needs, and the files a job should keep.

## Before you start

- Finish [the quickstart](/start/quickstart/) so `visualguard.config.ts` works on your computer.
- Commit `visualguard.config.ts`, your lockfile, and VisualGuard and Playwright as dev dependencies.
- Make sure the CI machine can reach both URLs in `baseURL` (the reference and the candidate). If they only run on your laptop, the job must start them first.
- Read [statuses](/concepts/results/) and [exit codes](/reference/exit-codes/) so you know what makes a job fail.

## Choose a setup

| Setup | Best for | What you get |
| --- | --- | --- |
| `visualguard init --workflow` | A first GitHub workflow with no extra decisions | A ready `.github/workflows/visualguard.yml` that tests, uploads the report, comments on the PR and then fails on regressions. |
| [The GitHub Action](/ci/github-actions/) | GitHub workflows you want to keep short | One step that installs the browser, tests, uploads artifacts, comments and fails the job. Every input is an option. |
| Plain commands | Any CI system (GitLab, CircleCI, Jenkins, Buildkite) | The two commands below, plus your CI's own artifact upload. |
| [Node.js SDK](/guides/programmatic-api/) | Custom scripts, typed integration and CI logic | `runVisualGuard()` returns structured results, report paths and a policy verdict. Your script sets its exit status and your CI uploads evidence. |

The CLI setups run these two commands:

```bash
npx playwright install --with-deps chromium
npx --no-install visualguard test --ci --junit visualguard-junit.xml
```

`--ci` turns off prompts, colours and spinners. `--junit` writes a JUnit XML file that most CI systems can display as test results. `npx --no-install` makes sure the job runs the version in your lockfile, not a newer download.

### Run through the SDK

Install VisualGuard and Playwright in your app, commit the lockfile, and install
the browser on the CI worker. A script can use the same config:

```js
import { runVisualGuard } from 'visualguard';

const result = await runVisualGuard({
  failOn: 'review',
  reports: { githubSummary: Boolean(process.env.GITHUB_STEP_SUMMARY) },
});
console.log('Upload this whole directory:', result.runDir);
process.exitCode = result.exitCode;
```

The SDK writes HTML and JUnit by default and returns the manifest. It does not set
the process exit status itself. Use an artifact step with `if: always()` to retain
the run directory even when this script fails. Include hidden files when uploading
`.visualguard/`; screenshots and diffs must stay beside the HTML. Setup failures
reject the promise and may have no report to upload.

The [complete SDK guide](/guides/programmatic-api/#7-configure-github-actions)
includes a runnable script, manual/pull-request workflow, environment variables,
baseline persistence and cancellation. SDK GitHub summaries are opt-in; the CLI
report settings and defaults described below apply to CLI workflows. SDK execution
does not automatically post PR comments or publish dashboard evidence.

## 1. Generate a GitHub workflow

`init` can write the workflow for you. It detects your package manager (npm, pnpm, Yarn or Bun) and uses its install and run commands.

```bash
npx --no-install visualguard init --workflow
```

You should see `Created .github/workflows/visualguard.yml`. If you run `init` without `--workflow`, it asks "Add a GitHub Actions workflow (PR comment, report artifact)?" instead. With `--yes`, an existing workflow file is kept unless you also pass `--force`.

The generated workflow does this, in order:

1. Runs on `pull_request` with `contents: read` and `pull-requests: write` permissions.
2. Checks out the code, sets up Node 22 and installs dependencies from the lockfile.
3. Caches and installs Playwright Chromium.
4. Runs `visualguard test --ci --junit visualguard-junit.xml` with `continue-on-error: true`, so later steps still run.
5. Uploads `.visualguard/runs/` as the `visualguard-report` artifact, even when the test failed.
6. Runs `visualguard comment --link <artifact URL>` to post or update one PR comment.
7. Fails the job with `exit 1` if the test step failed.

If you chose Gemini during `init`, the test step also reads `GEMINI_API_KEY` from your repository secrets. A commented `VISUALGUARD_STAGING_URL` line shows where to plug in a [preview URL](/ci/preview-deployments/).

:::note
The generated workflow uploads only `.visualguard/runs/`. Add `visualguard-junit.xml` to the upload `path` if you want the JUnit file inside the artifact too. The GitHub Action uploads both.
:::

## 2. Follow the required job order

Whatever CI you use, keep this order. It makes sure a failed comparison still leaves evidence behind.

1. **Check out the code you are testing.** Install from the committed lockfile and use Node 22.12 or newer.
2. **Install the browser.** Run `npx playwright install --with-deps <browser>` for the browser your config uses.
3. **Make the environments ready.** Start your servers, or wait until the deployed reference and candidate URLs serve the right build. An open port alone does not prove the right build is live.
4. **Pass secrets through CI secret storage.** This includes URLs that are not public, an upload token and AI keys. Never commit them.
5. **Run the test and remember its result.** Do not stop the job yet.
6. **Upload the whole run folder and the JUnit file**, even when the test failed. The run folder is `.visualguard/runs/` by default (the `output.dir` setting).
7. **Fail the job last**, using the test's saved result.

## 3. Read the results

A CI run can produce several outputs. Each one is separate, so one can fail while another works.

| Output | Where it appears | Needs |
| --- | --- | --- |
| Exit code | The job passes or fails. `0` means the run meets `--fail-on`; `1` means it does not; `2` is a usage error; `3` is an environment problem. | Nothing |
| Job summary | The GitHub run's summary page, written when `GITHUB_STEP_SUMMARY` is set (`report.githubSummary`, on by default). | Nothing; no token |
| Run artifact | Your CI's artifact storage. Contains `index.html`, screenshots, diffs and `manifest.json`. | An upload step |
| JUnit XML | Your CI's test view. Failing jobs follow `--fail-on`. | `--junit <path>` or `report.junit` |
| PR comment | One sticky comment on the pull request, updated on each run. | `visualguard comment` and a token with `pull-requests: write` |
| Webhook | A JSON summary POSTed to Slack, n8n, Zapier or similar. It includes a ready-to-post `text` field. | `report.webhook` or `VISUALGUARD_WEBHOOK_URL` |

`--fail-on` decides which statuses fail the run:

| Value | Fails on | Default |
| --- | --- | --- |
| `regression` | Regressions and errors | Yes |
| `review` | Reviews, regressions and errors | No |
| `any` | Currently the same statuses as `review` | No |

`report.publicURL` adds a link to the report in comments and summaries. It does not host the report for you; you must publish the files there yourself.

## 4. Post a pull request comment

`visualguard comment` posts one comment on the pull request and updates the same comment on later runs. It finds its own comment by a hidden marker, so a PR never collects duplicates. Run it after the upload step, so the comment can link to the artifact.

```bash
npx --no-install visualguard comment --link "$ARTIFACT_URL"
```

| Option | What it does | Default |
| --- | --- | --- |
| `--link <url>` | Link to the full report, such as the artifact URL | `report.publicURL` |
| `--run <id>` | Which run to describe: an ID, ID prefix or run number | The latest run |
| `--pr <number>` | Pull request number | Read from the GitHub event |
| `--repo <owner/name>` | Repository | `GITHUB_REPOSITORY` |
| `--dry-run` | Print the comment instead of posting it | Off |
| `-c, --config <path>` | Config file path | Auto-detected |

The command reads its token from `GITHUB_TOKEN` (or `GH_TOKEN`). The token needs `pull-requests: write`. For events without a PR, such as `push` or `deployment_status`, it looks up the open PR that contains the commit. If there is none, it prints "No pull request for this run; skipping the comment" and exits normally.

:::caution
Pull requests from forks get a read-only `GITHUB_TOKEN` and no repository secrets. Turn the comment off for fork PRs, or post it from a separate trusted `workflow_run` workflow. Do not switch to `pull_request_target` just to run untrusted PR code with secrets.
:::

## 5. Add a scheduled monitor (optional)

`visualguard monitor` compares a live site with its own previous capture, for example every night. It catches CMS edits and broken third-party scripts that no pull request caused. It can write its own workflow:

```bash
npx --no-install visualguard monitor --workflow "0 3 * * *"
```

You should see `Wrote .github/workflows/visualguard-monitor.yml`. The workflow runs on that cron schedule and on manual dispatch. It stores previous captures in the Actions cache and uploads the report as `visualguard-monitor-report`. Add the `VISUALGUARD_WEBHOOK_URL` secret to get a message when a run ends. See [monitoring](/guides/monitoring/) for details.

## Example: a GitLab job

This shows the same order on a CI system without the Action. It assumes the reference and candidate URLs are already deployed and stored as CI variables.

```yaml
visualguard:
  image: node:22
  script:
    - npm ci
    - npx playwright install --with-deps chromium
    - npx --no-install visualguard test --ci --junit visualguard-junit.xml
  variables:
    VISUALGUARD_PRODUCTION_URL: $REFERENCE_URL
    VISUALGUARD_STAGING_URL: $CANDIDATE_URL
  artifacts:
    when: always
    paths:
      - .visualguard/runs/
      - visualguard-junit.xml
    reports:
      junit: visualguard-junit.xml
```

`VISUALGUARD_PRODUCTION_URL` and `VISUALGUARD_STAGING_URL` override `baseURL.production` and `baseURL.staging`. If the test fails, the job fails, and `when: always` still uploads the artifacts.

## Verify your CI setup

1. Open a trial pull request that changes something visible on purpose, such as a button color.
2. The job should fail with the default `--fail-on regression`.
3. Download the artifact. Open `index.html` and confirm it shows the change.
4. Check the PR comment and the job summary.
5. Revert the change. The next run should pass.

If the trial passes when it should fail, check which routes ran, your masks, the URLs the job really used and `--fail-on`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Executable doesn't exist` or a missing browser | Add `npx playwright install --with-deps <browser>` before the test, for the same browser as your config. |
| The artifact is empty | Upload `.visualguard/runs/` (or your `output.dir`), and run the upload step even when the test failed. |
| `GITHUB_TOKEN is not set` | Pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the comment step. |
| Comment fails with HTTP 403 or 404 | Grant `pull-requests: write`. Fork PRs have a read-only token; skip the comment there. |
| The job passes but should fail | Check `--fail-on`, the route list and that the candidate URL really serves the new build. |
| Baseline-mode runs fail only in CI | Baselines saved on your laptop use different fonts and OS rendering. Save baselines on the same CI image, or see [stable captures](/guides/stable-captures/). |

See [CI troubleshooting](/troubleshooting/ci/) for more.

## Next steps

- [Use the GitHub Action](/ci/github-actions/): every input and output in one table.
- [Test preview deployments](/ci/preview-deployments/): point the candidate at each PR's preview URL.
- [Shard large suites](/ci/sharding/): split the work across several jobs and merge it.
- [Deliver GitHub checks](/ci/github-checks/): add a dashboard policy check to each PR.
