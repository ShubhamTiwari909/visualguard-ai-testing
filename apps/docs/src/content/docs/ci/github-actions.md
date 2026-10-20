---
title: "Use the GitHub Action"
description: "Install project dependencies and run a complete workflow with report artifacts and optional comments."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["action/README.md", "action/action.yml"]
sidebar: {"order": 2}
---

## Before you start

Install VisualGuard and Playwright in the application and commit its lockfile/config. Both config URLs must be reachable from a GitHub-hosted runner, or the workflow must start/await your application first. Private applications may need a self-hosted runner. The example below assumes reachable deployed URLs; it does not deploy your application.

## Add the workflow

Runs `visualguard test`, uploads the report as an artifact, posts (or updates) one comment on the
pull request, writes the job summary, and fails the job on regressions.

Your workflow installs dependencies first (VisualGuard and Playwright are dev dependencies of
your project):

```yaml
name: VisualGuard
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  visualguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
        with:
          gemini-api-key: ${{ secrets.GEMINI_API_KEY }} # optional
          # staging-url: ${{ vars.STAGING_URL }}
```

| Input               | Default               | Meaning                                           |
| ------------------- | --------------------- | ------------------------------------------------- |
| `working-directory` | `.`                   | Where `visualguard.config.ts` lives               |
| `args`              | ``                    | Extra `visualguard test` arguments                |
| `fail-on`           | `regression`          | `regression`, `review` or `any`                   |
| `staging-url`       | ``                    | Overrides `baseURL.staging` (preview deployments) |
| `gemini-api-key`    | ``                    | Enables AI analysis                               |
| `comment`           | `true`                | Post or update the PR comment                     |
| `github-token`      | `${{ github.token }}` | Token for the comment                             |
| `exec`              | `npx`                 | `npx`, `pnpm exec`, `yarn` or `bunx`              |

Additional inputs:

| Input              | Default                 | Meaning                                                                                              |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `browser`          | `chromium`              | Installs and selects this browser, overriding project configuration                                  |
| `output-directory` | `.visualguard`          | Run output relative to the working directory; overrides config and is also used for comments/uploads |
| `artifact-name`    | `visualguard-report`    | Use a distinct name for matrix/shard jobs                                                            |
| `junit-path`       | `visualguard-junit.xml` | JUnit output uploaded together with run artifacts                                                    |

Set these inputs when using a nondefault browser or artifact path. `args` is intended for trusted workflow configuration.

Outputs: `report-url` (the artifact) and `outcome`.

For preview deployments, trigger on `deployment_status` and pass
`staging-url: ${{ github.event.deployment_status.environment_url }}`.

## Make AI optional and explicit

A key alone does not override a config with `ai.provider: none`. For a Gemini-enabled job, select `ai.provider: gemini` in config or add the trusted `args: --provider gemini` alongside the optional key. For a deterministic first job, omit the key and use `args: --no-ai`. Keep argument input in trusted workflow configuration.

## Forks, comments and artifacts

Fork pull requests may not receive repository secrets and their token may not be allowed to comment. Use `comment: 'false'` in that context and a suitable no-secret comparison path. Do not switch to a privileged event merely to run untrusted PR code with secrets. The Action preserves artifacts and then propagates the visual-test failure. Set distinct artifact names for matrix/shard jobs.

## Verify

Open the job summary, downloaded report folder and JUnit file for a known failing comparison. Confirm the artifact browser/output settings match those actually used. Pin the Action to a trusted release tag or full commit containing the behavior you need; its tag is independent of the installed npm package version.

[Configure preview URLs](/ci/preview-deployments/) or [understand GitHub policy checks](/ci/github-checks/).
