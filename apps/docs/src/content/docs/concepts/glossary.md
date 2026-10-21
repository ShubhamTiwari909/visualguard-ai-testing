---
title: "Glossary"
description: "Plain-language definitions of the terms used across VisualGuard testing, review, dashboard and operations pages."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/PRODUCT-FEATURES.md",
    "packages/visualguard/src/config/schema.ts",
    "packages/visualguard/src/core/types.ts",
    "apps/platform/server/auth.ts",
    "apps/platform/server/built-in-runner.ts",
  ]
sidebar: { "order": 4 }
---

This page defines the words used across these docs. Terms are grouped by topic, so related ideas sit together. Each page links here the first time it uses a term you might not know.

## Testing basics

| Term                 | Meaning                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Reference            | The appearance you expect. In the config it is `baseURL.production`, but it does not have to be a public production site.                 |
| Candidate            | The version you are checking. In the config it is `baseURL.staging`, but it can be a local dev server or a preview deployment.            |
| Production / staging | The config names for the reference and candidate sites. They are labels, not requirements.                                                |
| Route                | A path in your app, such as `/checkout`. One route can map to different paths on each site, such as `/pricing` and `/plans`.              |
| Viewport             | A named screen size and device settings, such as `desktop` at 1280 × 800. Each route is captured once per viewport.                       |
| Job (or check)       | One route at one viewport, or one checkpoint inside a Playwright test. Each job gets one status.                                          |
| Run                  | One execution of VisualGuard and all the evidence it saved. Each run has an ID and a run number.                                          |
| Run folder           | Where a run is saved: `.visualguard/runs/RUN_ID/`.                                                                                        |
| Manifest             | `manifest.json` in the run folder. The structured record of settings, job results and file links.                                         |
| Report               | The HTML page (`index.html`) that shows a run's screenshots, diffs and findings. Open it with `visualguard report`.                       |
| Comparison mode      | How the reference is chosen: two live sites (`compare`) or saved files (`baseline`). See [comparison modes](/concepts/comparison-modes/). |
| Zero-config scan     | Running `visualguard URL` without a config file. One URL compares with its own previous scan; two URLs compare the two sites.             |
| Monitoring           | Comparing a live site with its own previous capture over time, with `visualguard monitor`.                                                |
| Stabilisation        | Settings that make captures repeatable, such as turning off animations and freezing the clock.                                            |
| Storage state        | A saved browser login (cookies and storage) that VisualGuard reuses to capture logged-in pages. Created with `visualguard auth`.          |
| Fixture              | The `visualguard/playwright` helper that runs checks inside your own Playwright tests.                                                    |

## Results and analysis

| Term                   | Meaning                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                 | The verdict for a job: `pass`, `accepted`, `review`, `regression` or `error`. See [result statuses](/concepts/results/).                                      |
| Diff                   | An image that highlights the pixels that differ between reference and candidate.                                                                              |
| Region                 | One changed area of the page, with a crop of each side.                                                                                                       |
| Finding                | A described change or problem, such as a style change on a button or a missing element.                                                                       |
| Independent check      | A check that does not depend on the screenshot difference, such as broken images, accessibility (`--a11y`) or performance (`--perf`).                         |
| Deterministic analysis | The built-in analysis. Same inputs, same result. Needs no AI.                                                                                                 |
| Noise                  | A difference that does not matter, such as anti-aliasing. Thresholds, masks and AI can classify it.                                                           |
| AI provider            | The optional model that explains changes: Gemini (cloud) or Ollama (local). `none` turns AI off.                                                              |
| Advisory mode          | `ai.advisory: true`. AI explanations are attached, but AI never changes a status. Off by default.                                                             |
| Fail-on policy         | Which statuses make the command fail, set with `--fail-on`. The default is `regression`.                                                                      |
| Exit code              | The number the command returns: `0` OK, `1` failed or incomplete, `2` config or usage error, `3` environment error. See [exit codes](/reference/exit-codes/). |
| Fix proposal           | A code change suggested and visually checked by `visualguard fix`. It asks before applying anything.                                                          |

## References and approvals

| Term                      | Meaning                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline                  | Any saved expected appearance used as a reference.                                                                                                                    |
| Local baseline            | Screenshots plus metadata saved on disk in `baseline.dir` (default `visualguard/baselines`). Updated only with `visualguard test --update-baselines`.                 |
| Accepted change           | A change you marked as intentional with `visualguard accept`. Stored in `visualguard.accepted.json`; commit this file. Matching later jobs get the `accepted` status. |
| Approved baseline set     | A named group of team references in the dashboard, such as `main`.                                                                                                    |
| Approved baseline version | One immutable version of a set. A new version is created by promoting reviewed evidence.                                                                              |
| Promote                   | Turn reviewed run evidence into a new approved baseline version in the dashboard.                                                                                     |
| Review                    | A person's decision about exact evidence in the dashboard, such as **Approve visual change** or **Request changes**. It does not rewrite the original status.         |
| Visual policy             | A project rule that says what evidence, reviews and baselines a revision needs before it counts as satisfied.                                                         |

## CI and scale

| Term           | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Shard          | One slice of a run's jobs, such as `--shard 1/4`, so large suites can run in parallel.            |
| Run group      | A shared ID (`--run-group`) that ties all shards of one execution together.                       |
| Merge          | Combining shard results into one run and report with `visualguard merge`.                         |
| Incomplete run | A merged run with missing shards or jobs. It always fails.                                        |
| Revision       | The source commit the captured app was built from. It must match the preview you actually tested. |
| GitHub check   | A pass or fail result the dashboard posts on a pull request commit, based on the visual policy.   |

## Dashboard and team

| Term                     | Meaning                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                | The optional web app that stores run history, projects, reviews and baselines. Start it with `visualguard dashboard`.                                                                                                                                   |
| Workspace                | One dashboard install and everything in it. One team usually needs one workspace.                                                                                                                                                                       |
| Local mode               | `VISUALGUARD_AUTH_MODE=local`. The dashboard trusts this computer's user and accepts no public connections. No login.                                                                                                                                   |
| Login mode               | `VISUALGUARD_AUTH_MODE=login`. People sign in with a password or a configured provider such as Google.                                                                                                                                                  |
| Administrator            | A workspace account that can manage people, settings and recovery. Other accounts are members.                                                                                                                                                          |
| Project role             | A member's access to one project: viewer, reviewer or maintainer.                                                                                                                                                                                       |
| Project                  | A dashboard group for one app: its history, access, settings and credentials.                                                                                                                                                                           |
| Public project ID        | The readable project ID used in commands, such as `storefront`. Renaming can keep old IDs as aliases.                                                                                                                                                   |
| Internal project key     | The permanent storage identity behind a project. It never changes when the project is renamed.                                                                                                                                                          |
| Upload token             | A project credential that lets CI publish runs. It is not an administrator login.                                                                                                                                                                       |
| Saved test configuration | The routes, viewports and settings a project uses when someone presses **Run test**.                                                                                                                                                                    |
| Execution request        | A request, usually from **Run test**, to run one version of a project's saved test configuration.                                                                                                                                                       |
| Private runner           | A machine you connect with `visualguard dashboard runner` to run dashboard-requested tests.                                                                                                                                                             |
| Runner credential        | A separate project credential that lets a private runner take requested tests. Not needed when the dashboard host runs the test itself.                                                                                                                 |
| Built-in runner          | The dashboard host capturing a requested test itself, authorised by the signed-in user. Controlled by `VISUALGUARD_BUILT_IN_RUNNER`; on by default except on Vercel. Check the project's status for **Runs on this dashboard** to confirm availability. |

## Next steps

- [How VisualGuard works](/concepts/how-it-works/): see how these pieces fit together.
- [Frequently asked questions](/concepts/faq/): short answers to common questions.
- [Run your first visual test](/start/quickstart/): meet most of these terms in practice.
