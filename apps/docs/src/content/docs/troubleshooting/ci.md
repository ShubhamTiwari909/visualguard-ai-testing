---
title: "CI, preview and sharding problems"
description: "Fix browser failures that only happen in CI, missing secrets and PR comments, stale preview revisions, lost artifacts and shard merge errors."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "action/README.md",
    "action/action.yml",
    "docs/RELIABILITY-CHANGES.md",
    "packages/visualguard/src/core/merge.ts",
    "packages/visualguard/src/core/run.ts",
    "packages/visualguard/src/reporters/github-comment.ts",
  ]
sidebar: { "order": 5 }
---

Use this page when VisualGuard passes on your computer but fails in continuous integration (CI), when a pull request comment or artifact is missing, or when sharded results will not merge. Each problem lists the likely cause, the exact fix and how to confirm it.

## Before you start

- Open the failing job log and download its artifact. The artifact holds the full run folder and report.
- Check which exit code the test step returned. Exit `1` with a report is often a real regression, not a CI problem. See [exit codes](/reference/exit-codes/).
- Save redacted logs and the full run folder when you investigate. Never paste secrets into issues.

## Browser fails only in CI

You see `Playwright's chromium browser is not installed.` or `Could not launch chromium: ...` in CI, but not locally.

- **Likely cause:** the CI image has a different Playwright version, no browser download, or missing system libraries.
- **Fix:** install locked dependencies, then the browser with its system libraries:

  ```bash
  npm ci
  npx playwright install --with-deps chromium
  ```

  The [VisualGuard GitHub Action](/ci/github-actions/) does this for you with its `browser` input.

- **Confirm:** rerun one route, for example with `args: --only /`, and check that the job captures it.

## Preview URL is not ready or is private

The screenshots show a 404, a "deployment building" page or a login wall.

- **Likely cause:** the job started before the preview deployment finished, or the preview needs access that the CI machine does not have.
- **Fix:** wait for the deployment event of the commit you are testing, then pass its URL with the `staging-url` input or `VISUALGUARD_STAGING_URL`. Give the CI machine the headers or saved session the preview needs.
- **Confirm:** open the staging screenshot in the report. It should show the real page for this commit. See [preview deployments](/ci/preview-deployments/).

## Pull request comment is missing

The log may show `VisualGuard could not comment on the pull request.`

- **Likely cause:** the token cannot write pull request comments, the workflow ran on a `push` event, or the pull request comes from a fork that does not receive write tokens.
- **Fix:** give the job `pull-requests: write` permission and pass `github-token`. The `comment` command reads `GITHUB_TOKEN`, then `GH_TOKEN`. For fork pull requests, rely on the job summary and artifact instead.
- **Confirm:** preview the comment without posting it:

  ```bash
  npx --no-install visualguard comment --dry-run
  ```

## Gemini or upload key is missing on fork pull requests

- **Likely cause:** CI systems usually hide repository secrets from fork pull requests.
- **Fix:** keep a path that works without secrets. VisualGuard falls back to heuristics when `GEMINI_API_KEY` is missing. Do not run untrusted fork code in a job that has secrets.
- **Confirm:** the fork job finishes and its output warns `AI off: GEMINI_API_KEY is not set; using heuristics only`.

## Artifacts disappear when the test fails

- **Likely cause:** the upload step runs only on success, or points to the wrong output folder.
- **Fix:** run the upload step with `if: always()` and upload the whole output folder and JUnit file. Keep the test step's failing exit code so the job still fails. The VisualGuard Action already uploads with `if: always()`.
- **Confirm:** a failing job still has an artifact with the run folder and `index.html`.

## A new commit shows evidence from an older commit

- **Likely cause:** the capture used an old preview URL, or the published revision is the temporary merge commit, not the pull request head.
- **Fix:** capture the preview built from the current head, and publish that exact commit with `--commit SHA`. Then reconcile the dashboard policy.
- **Confirm:** the dashboard run shows the same commit as the pull request head. See [GitHub checks](/ci/github-checks/).

## Shards fail to start or will not merge

| Message                                                                                                  | Likely cause and fix                                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Sharded runs require --run-group or VISUALGUARD_RUN_GROUP (automatic in GitHub Actions).`               | Outside GitHub Actions, give every shard of one execution the same `--run-group` value. |
| `--shard must look like 1/4 (got "...")`                                                                 | Use `INDEX/TOTAL`, such as `2/4`.                                                       |
| `Cannot merge incompatible runs (group, revision, configuration or shard count differs).`                | The inputs come from different executions. Download the shards of one execution only.   |
| `Cannot merge legacy runs without provenance; rerun the shards.`                                         | The shards came from an older version. Capture them again.                              |
| `Duplicate shard indices in merge inputs.` or `Duplicate job IDs in merge inputs.`                       | The same shard was downloaded twice. Remove the duplicate folder.                       |
| `Incomplete shard set or missing jobs; pass --allow-partial to produce an explicitly incomplete report.` | A shard failed or was not downloaded. Rerun it.                                         |

Example of a correct split outside GitHub Actions:

```bash
npx --no-install visualguard test --shard 1/2 --run-group build-123
npx --no-install visualguard test --shard 2/2 --run-group build-123
npx --no-install visualguard merge downloaded-artifacts
```

**Confirm:** `merge` prints `Merged N runs from ...` and exits with the visual result of the combined run. `--allow-partial` creates a report marked incomplete and always exits non-zero, so use it only for diagnosis. See [sharding](/ci/sharding/).

## Next steps

- [Set up the GitHub Action](/ci/github-actions/) with artifacts and comments.
- [Test preview deployments](/ci/preview-deployments/) with the right revision.
- [Split large runs into shards](/ci/sharding/) safely.
