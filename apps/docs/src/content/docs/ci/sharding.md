---
title: "Shard and merge runs"
description: "Split a large comparison across several CI jobs, then merge the parts into one complete report and exit code."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "README.md",
    "packages/visualguard/src/cli/commands/merge.ts",
    "packages/visualguard/src/core/merge.ts",
    "packages/visualguard/src/core/run.ts",
  ]
sidebar: { "order": 4 }
---

Sharding splits one comparison into parts that run in parallel on different CI jobs. Each part is called a shard. When all shards finish, `visualguard merge` combines them into one run, one report and one exit code. Use it when a single job takes too long.

## Before you start

- Get one unsharded CI job working first. See [Run visual tests in CI](/ci/overview/).
- Every shard must use the same config, the same source commit and the same browser. Only the shard number changes.
- Your CI must be able to pass files from the shard jobs to a final merge job (on GitHub, `upload-artifact` and `download-artifact`).

## How work is split

VisualGuard plans every job (one route at one viewport) first. It sorts the jobs by ID and deals them out in turn, like cards: with `--shard 1/3`, shard 1 gets jobs 1, 4, 7 and so on. Every shard plans the same full list, so each shard knows which jobs it owns and which jobs the whole run should have.

Each shard also records a **run group**: one ID shared by all shards of the same execution. Merge uses it to refuse parts from different executions.

| Where the run group comes from | Value                                  |
| ------------------------------ | -------------------------------------- |
| `--run-group <id>`             | Your value                             |
| `VISUALGUARD_RUN_GROUP`        | Your value                             |
| GitHub Actions (automatic)     | `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>` |

Outside GitHub Actions, a sharded run without a group stops with "Sharded runs require --run-group or VISUALGUARD_RUN_GROUP (automatic in GitHub Actions)."

## 1. Run each shard

Run the same command on every worker, changing only the shard number. Use one unique group value per execution, such as your CI's pipeline ID.

```bash
npx --no-install visualguard test --ci --shard 1/2 --run-group ci-execution-123
npx --no-install visualguard test --ci --shard 2/2 --run-group ci-execution-123
```

`--shard <i/n>` means "run part i of n". Each shard writes a normal run folder under `.visualguard/runs/`. Upload that folder from every shard, even when the shard failed.

## 2. Collect the shard folders

Download every shard's run folder into one local folder, for example `downloaded-shards/`. Merge reads local folders only; it cannot fetch a remote artifact URL.

## 3. Merge

```bash
npx --no-install visualguard merge downloaded-shards --ci --junit merged-junit.xml
```

You can pass run folders, `.visualguard` folders, or a folder of downloaded artifacts. Merge finds the runs inside. It writes a new combined run with its own report under your output folder, and returns one exit code.

| Option                | What it does                                                                     | Default       |
| --------------------- | -------------------------------------------------------------------------------- | ------------- |
| `<paths...>`          | Run folders, `.visualguard` folders, or a folder of downloaded CI artifacts      | Required      |
| `--fail-on <level>`   | `regression`, `review` or `any`                                                  | `regression`  |
| `--allow-partial`     | Make an incomplete report when shards or jobs are missing. Still exits non-zero. | Off           |
| `--junit <path>`      | Write a JUnit XML file for the merged run                                        | none          |
| `--json`              | Print the merged manifest JSON to stdout                                         | Off           |
| `--ci`                | No colours                                                                       | Off           |
| `-c, --config <path>` | Config file path                                                                 | Auto-detected |

## What merge refuses

Merge checks that the shards belong together before it trusts them.

| Merge stops when                                     | Error message starts with                     |
| ---------------------------------------------------- | --------------------------------------------- |
| No runs are found                                    | `No runs found in ...`                        |
| Runs use different modes (compare and baseline)      | `Can't merge runs of different modes`         |
| A run was made by an old release without provenance  | `Cannot merge legacy runs without provenance` |
| Group, commit, config, browser or shard count differ | `Cannot merge incompatible runs`              |
| The same shard number appears twice                  | `Duplicate shard indices in merge inputs.`    |
| The same job appears twice                           | `Duplicate job IDs in merge inputs.`          |
| A job is not in the planned list                     | `Unexpected jobs in shard inputs.`            |
| A shard or job is missing                            | `Incomplete shard set or missing jobs`        |

For a legacy run, rerun the shards with the current release.

## Partial merges

`--allow-partial` turns a missing shard from an error into an incomplete report. The report shows an incomplete banner, and the command still exits with `1`. Use it to look at what did finish. Never use it to make a CI policy pass.

## Example: GitHub Actions with three shards

```yaml
jobs:
  shard:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx --no-install visualguard test --ci --shard ${{ matrix.shard }}/3
        continue-on-error: true
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visualguard-shard-${{ matrix.shard }}
          path: .visualguard/runs/

  merge:
    needs: shard
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: visualguard-shard-*
          path: downloaded-shards
      - run: npx --no-install visualguard merge downloaded-shards --ci --junit merged-junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: visualguard-merged
          path: |
            .visualguard/runs/
            merged-junit.xml
```

GitHub sets the run group automatically, so no `--run-group` is needed here. Each shard job uses its own artifact name. The merge job's exit code is the one that should gate your PR.

:::tip
If you use the GitHub Action for each shard, pass the shard through `args: --shard ${{ matrix.shard }}/3` and give each one its own `artifact-name`. Set `comment: "false"` on the shards and comment once after the merge.
:::

## Verify the merge

1. Run the full set and merge it. Open the merged report and check every route and viewport is there.
2. In a throwaway run, leave one shard out of `downloaded-shards`. Merge should fail with "Incomplete shard set or missing jobs".
3. Add `--allow-partial`. You should get a report with an incomplete banner and exit code `1`.

## Troubleshooting

| Problem                                                     | Fix                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Sharded runs require --run-group ...`                      | Pass `--run-group` or set `VISUALGUARD_RUN_GROUP` to the same value on every shard.                                           |
| `Cannot merge incompatible runs`                            | Shards ran with different commits, configs, browsers or groups. Rerun all shards from one commit.                             |
| `Incomplete shard set or missing jobs`                      | A shard failed to upload or download. Check every shard artifact exists, then merge again.                                    |
| `No runs found in ...`                                      | Point merge at the folder that holds the downloaded run folders.                                                              |
| `Cannot merge incompatible runs` after "Re-run failed jobs" | On GitHub, each attempt has its own run group, so old and new shards do not match. Re-run all jobs, not only the failed ones. |

See [CI troubleshooting](/troubleshooting/ci/) for more.

## Next steps

- [Read exit codes](/reference/exit-codes/): how merge results map to pass and fail.
- [Use the GitHub Action](/ci/github-actions/): set artifact names and comments per job.
- [Publish to a dashboard](/dashboard/publishing/): send the merged run to a project.
