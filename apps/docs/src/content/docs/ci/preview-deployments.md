---
title: "Test preview deployments"
description: "Point the candidate at each pull request's preview URL, wait until it is ready and record the commit that was really tested."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["README.md", "packages/visualguard/src/config/resolve.ts", "packages/visualguard/src/cli/commands/test.ts", "action/action.yml"]
sidebar: {"order": 3}
---

Many hosts build a preview deployment for every pull request, such as `https://pr-123.preview.example.com`. This page shows how to compare that preview against production, wait until the preview is really ready, and label the result with the commit that was actually tested.

## Before you start

- Get one comparison working in CI first. See [Run visual tests in CI](/ci/overview/) or [the GitHub Action](/ci/github-actions/).
- Keep `baseURL.production` in `visualguard.config.ts` pointed at a stable reference. Only the candidate (`staging`) changes per PR.
- Know how your host reports a finished preview: a `deployment_status` event, a predictable URL, or a CLI command.
- To publish to a dashboard, create a [project](/dashboard/projects/) and an upload token first.

## 1. Pass the preview URL

VisualGuard picks the candidate URL in this order. The first one that is set wins.

| Source | Example | Use it when |
| --- | --- | --- |
| `--staging <url>` flag | `visualguard test --staging https://pr-123.preview.example.com` | You build the command yourself. |
| `VISUALGUARD_STAGING_URL` environment variable | `VISUALGUARD_STAGING_URL=https://pr-123.preview.example.com` | Your CI sets variables per job. |
| `baseURL.staging` in the config | `staging: "http://localhost:3000"` | Local runs. |

The reference works the same way with `--production` and `VISUALGUARD_PRODUCTION_URL`. With the GitHub Action, use its `staging-url` input; it sets `VISUALGUARD_STAGING_URL` for you.

## 2. Wait until the preview is ready

VisualGuard does not wait for a deployment. It captures whatever the URL returns. A preview that is still building, a login wall or an error page gives you misleading screenshots. Make the job wait first.

**Best: trigger on a success event.** On GitHub, many hosts (Vercel, Netlify and others) send `deployment_status` when a preview finishes:

```yaml
on:
  deployment_status:
jobs:
  visualguard:
    if: github.event.deployment_status.state == 'success'
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
          staging-url: ${{ github.event.deployment_status.environment_url }}
```

Check that the event comes from the repository and environment you expect before trusting it.

**Otherwise: poll with a time limit.** This loop waits up to five minutes for the preview to answer with a success status:

```bash
PREVIEW_URL="https://pr-${PR_NUMBER}.preview.example.com"
for attempt in $(seq 1 60); do
  if curl --fail --silent --output /dev/null "$PREVIEW_URL/"; then
    echo "Preview is ready"
    break
  fi
  if [ "$attempt" = 60 ]; then echo "Preview never became ready"; exit 1; fi
  sleep 5
done
```

You should see `Preview is ready` before the test step starts. A success status only proves that something answers. If your app shows its build commit (for example in a `/version` route or a meta tag), check that it matches the commit you expect, too.

:::caution
If the preview needs a login, VisualGuard captures the login page unless you set up [application authentication](/guides/application-auth/). Check the first report's screenshots before you trust the setup.
:::

## 3. Record the commit you really tested

On `pull_request` events, `actions/checkout` checks out a temporary merge commit by default. That commit is not the PR head and is not what most hosts deploy. For dashboard history and [GitHub checks](/ci/github-checks/), record the PR **head** commit:

```yaml
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
```

Then publish the run to a dashboard project with the real labels. Replace each uppercase value:

```bash
npx --no-install visualguard test storefront \
  --dashboard https://YOUR_DASHBOARD_HOST \
  --staging https://ACTUAL_PREVIEW_HOST \
  --commit CAPTURED_FULL_SHA --pr 123 --environment staging --no-ai
```

| Option | What it does | Default |
| --- | --- | --- |
| `[project]` | Dashboard project ID or exact unique name. Publishes the run when it finishes. | none |
| `--dashboard <url>` | Dashboard origin. Can also come from `VISUALGUARD_DASHBOARD_URL`. | Local dashboard storage |
| `--commit <sha>` | Source revision label. Use the full SHA of the code the preview was built from. | none |
| `--pr <number>` | Pull request number. | none |
| `--branch <name>` | Branch label. | none |
| `--environment <name>` | Environment label. | `staging` |
| `--deployment <id>` | Deployment label, such as your host's deployment ID. | none |

A hosted dashboard in login mode needs `VISUALGUARD_UPLOAD_TOKEN` in the job's secrets. This token can only publish evidence. Never give the CI job database or administrator credentials. Locally, `visualguard test` also loads ignored `.env` and `.env.local` files; in CI, set values in the job instead.

## Example: a predictable preview URL

Your host deploys every PR to `https://pr-<number>.preview.example.com`. This job waits for it, then compares and publishes:

```yaml
on:
  pull_request:
jobs:
  visualguard:
    runs-on: ubuntu-latest
    env:
      PREVIEW_URL: https://pr-${{ github.event.number }}.preview.example.com
      VISUALGUARD_UPLOAD_TOKEN: ${{ secrets.VISUALGUARD_UPLOAD_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Wait for the preview
        run: |
          for attempt in $(seq 1 60); do
            curl --fail --silent --output /dev/null "$PREVIEW_URL/" && exit 0
            sleep 5
          done
          exit 1
      - run: >
          npx --no-install visualguard test storefront --ci
          --dashboard https://visualguard.example.com
          --staging "$PREVIEW_URL"
          --commit ${{ github.event.pull_request.head.sha }}
          --pr ${{ github.event.number }} --no-ai
```

This job does not wait for the right build, only for any build. If the host may still serve the previous commit, add a commit check to the wait step.

## Verify the preview setup

1. Push a commit to a PR and let the job run.
2. Open the report. The candidate screenshots should show your new change, not the old build.
3. In the dashboard, open the run. Its commit should equal the PR head SHA, not a merge commit.
4. Push another commit. The new run should carry the new SHA.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Screenshots show the previous build | The preview was not ready. Wait for a success event, or check a build marker in the wait loop. |
| Screenshots show a login or error page | Turn off preview protection for CI, or configure [application authentication](/guides/application-auth/). |
| The run's commit is a merge commit | Check out `github.event.pull_request.head.sha` and pass it to `--commit`. |
| `Provide a project: visualguard test <PROJECT_ID> --dashboard <url>` | Put the project ID right after `test` when you use `--dashboard`. |
| Upload is rejected with 401 | Set `VISUALGUARD_UPLOAD_TOKEN` to a valid token for that project. |

See [CI troubleshooting](/troubleshooting/ci/) for more.

## Next steps

- [Deliver GitHub checks](/ci/github-checks/): turn the published evidence into a check on the PR head.
- [Publish to a dashboard](/dashboard/publishing/): learn more about upload tokens and labels.
- [Shard large suites](/ci/sharding/): split long preview runs across jobs.
