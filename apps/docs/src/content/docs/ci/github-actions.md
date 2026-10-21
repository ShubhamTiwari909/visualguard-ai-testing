---
title: "Use the GitHub Action"
description: "Add VisualGuard to a GitHub workflow with one step that tests, uploads the report, comments on the PR and fails on regressions."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["action/README.md", "action/action.yml"]
sidebar: { "order": 2 }
---

The VisualGuard GitHub Action runs a visual comparison in one workflow step. It installs the browser, runs `visualguard test`, uploads the report as an artifact, writes the job summary, posts one PR comment and fails the job on regressions. Use it when your project already runs on GitHub Actions and you want the shortest workflow.

## Before you start

- Finish [the quickstart](/start/quickstart/). Commit `visualguard.config.ts` and your lockfile.
- Add `visualguard` and `playwright` as dev dependencies. The Action runs them from your project; it does not install them.
- Make both `baseURL` addresses reachable from a GitHub-hosted runner. If the app only runs locally, start it in an earlier step. Private networks may need a self-hosted runner.
- Read [Run visual tests in CI](/ci/overview/) for the general job order.

## 1. Add the workflow

Create `.github/workflows/visualguard.yml`. Your workflow installs dependencies first; the Action does the rest.

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

`pull-requests: write` lets the Action post its comment. Without it, the test still runs but the comment step only logs a warning.

:::caution
The Action's tag (`@v1`) is separate from the npm package version. Pin a release tag or a full commit SHA that contains the inputs you use. A full SHA is the safest choice for a security-sensitive repository.
:::

## 2. Push and watch the run

Open a pull request with the new workflow. You should see these steps in the job log:

1. **Cache Playwright browsers**: restores `~/.cache/ms-playwright`.
2. **Install configured browser**: runs `<exec> playwright install --with-deps <browser>`.
3. **Visual regression test**: runs `<exec> visualguard test --ci --fail-on <fail-on> --junit <junit-path> <args>`. This step may fail without stopping the job.
4. **Upload the report**: always uploads `<output-directory>/runs/` and the JUnit file.
5. **Comment on the pull request**: posts or updates one comment that links to the artifact. Skipped on `push` events.
6. **Fail on visual regressions**: fails the job with "VisualGuard found visual changes at or above '<fail-on>'" if the test step failed.

The job summary also shows a Markdown table of results. It needs no token.

## Inputs

All inputs are optional.

| Input               | What it does                                                                                                                                   | Default                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `working-directory` | Folder that contains `visualguard.config.ts`. All other paths are relative to it.                                                              | `.`                     |
| `browser`           | Browser to install and run: `chromium`, `firefox` or `webkit`. Overrides the config. Any other value stops the job with "Unsupported browser". | `chromium`              |
| `output-directory`  | Run output folder. Overrides `output.dir`, and is also used by the upload and comment steps.                                                   | `.visualguard`          |
| `artifact-name`     | Name of the uploaded artifact. Use a different name for each matrix or shard job.                                                              | `visualguard-report`    |
| `junit-path`        | Where the JUnit XML file is written. It is uploaded with the run.                                                                              | `visualguard-junit.xml` |
| `args`              | Extra `visualguard test` arguments, such as `--only /pricing` or `--no-ai`.                                                                    | empty                   |
| `fail-on`           | Which statuses fail the job: `regression`, `review` or `any`.                                                                                  | `regression`            |
| `staging-url`       | Candidate URL for this run, such as a preview deployment. Overrides `baseURL.staging`.                                                         | empty                   |
| `gemini-api-key`    | Gemini API key for AI explanations. Leave empty for heuristics only.                                                                           | empty                   |
| `comment`           | `"true"` posts or updates the PR comment; `"false"` skips it.                                                                                  | `true`                  |
| `github-token`      | Token for the PR comment. It needs `pull-requests: write`.                                                                                     | `${{ github.token }}`   |
| `exec`              | How to run your project's binaries: `npx`, `pnpm exec`, `yarn` or `bunx`.                                                                      | `npx`                   |

Set `browser`, `output-directory` and `junit-path` here instead of only in `args`. The Action uses these inputs for the browser install and the upload path, so values hidden in `args` would not match. Treat `args` as trusted workflow configuration; never build it from PR titles or other user text.

## Outputs

| Output       | What it contains                                |
| ------------ | ----------------------------------------------- |
| `report-url` | URL of the uploaded report artifact.            |
| `outcome`    | `success` or `failure` of the visual test step. |

Use them in later steps by giving the Action step an `id`:

```yaml
      - id: vg
        uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
      - if: always()
        run: echo "Report: ${{ steps.vg.outputs.report-url }} (${{ steps.vg.outputs.outcome }})"
```

The second step needs `if: always()`, because the Action fails the job when it finds regressions.

## 3. Choose AI explicitly

A key alone does not turn on AI if your config says `ai.provider: "none"`. Pick one of these setups:

| Goal                           | Config                  | Action inputs                                   |
| ------------------------------ | ----------------------- | ----------------------------------------------- |
| Deterministic, no AI           | Any                     | `args: --no-ai`, no key                         |
| Gemini explanations            | `ai.provider: "gemini"` | `gemini-api-key: ${{ secrets.GEMINI_API_KEY }}` |
| Gemini without changing config | Any                     | `gemini-api-key` plus `args: --provider gemini` |

Start with `--no-ai` for your first job. Add AI after the deterministic result looks right. See [Gemini setup](/guides/ai-gemini/).

## Example: pnpm in a monorepo, three browsers

This example tests the `apps/web` package in Chromium, Firefox and WebKit. Each matrix job uses its own artifact and JUnit names, so uploads do not overwrite each other.

```yaml
jobs:
  visualguard:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox, webkit]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
        with:
          working-directory: apps/web
          exec: pnpm exec
          browser: ${{ matrix.browser }}
          artifact-name: visualguard-${{ matrix.browser }}
          junit-path: visualguard-junit-${{ matrix.browser }}.xml
          args: --no-ai
```

All three jobs update the same PR comment, so the comment shows whichever job finished last. Set `comment: "false"` on all but one browser if that is confusing.

## Example: test each preview deployment

Trigger on `deployment_status` and pass the preview URL as `staging-url`:

```yaml
on:
  deployment_status:
jobs:
  visualguard:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      # checkout, setup-node and install as above
      - uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
        with:
          staging-url: ${{ github.event.deployment_status.environment_url }}
```

On this event the comment step finds the open PR that contains the deployed commit. Read [preview deployments](/ci/preview-deployments/) before relying on it.

## Forks, comments and artifacts

- Fork PRs may not get repository secrets, and their token may be read-only. Set `comment: "false"` for them, and run a comparison that needs no secrets.
- Do not switch to a privileged event like `pull_request_target` just to run untrusted PR code with secrets.
- A failed comment never fails the job. The step prints the warning "VisualGuard could not comment on the pull request." instead.
- The upload step runs even when the test failed. If no run was written (for example, the config failed to load), the upload is skipped quietly.

## Verify the Action

1. Push a PR with a visible change.
2. The job should fail at **Fail on visual regressions**.
3. Open the job summary and the PR comment. The comment should link to the artifact.
4. Download the artifact. It should contain `runs/<run>/index.html` and the JUnit file.
5. Confirm the report shows the browser and output folder you set in the inputs.

## Troubleshooting

| Problem                          | Fix                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `Unsupported browser`            | Set `browser` to `chromium`, `firefox` or `webkit`.                                         |
| `visualguard: not found`         | Install dependencies before the Action, and set `exec` to match your package manager.       |
| The artifact is empty            | Set `output-directory` to your real `output.dir`, relative to `working-directory`.          |
| No PR comment                    | Grant `pull-requests: write`. Check that `comment` is `"true"` and the event is not `push`. |
| Matrix jobs overwrite each other | Give each job a unique `artifact-name` and `junit-path`.                                    |
| AI never runs                    | Set `ai.provider: "gemini"` in config, or add `--provider gemini` to `args`.                |

See [CI troubleshooting](/troubleshooting/ci/) for more.

## Next steps

- [Use the Node.js SDK](/guides/programmatic-api/): run a custom script with structured results, JUnit and uploaded diff evidence.
- [Test preview deployments](/ci/preview-deployments/): compare each PR's real preview build.
- [Shard large suites](/ci/sharding/): split routes across jobs and merge the results.
- [Deliver GitHub checks](/ci/github-checks/): add a dashboard policy check to each PR.
