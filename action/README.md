# VisualGuard GitHub Action

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
      - uses: <owner>/visualguard/action@v1
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

Outputs: `report-url` (the artifact) and `outcome`.

For preview deployments, trigger on `deployment_status` and pass
`staging-url: ${{ github.event.deployment_status.environment_url }}`.
