---
title: "How VisualGuard works"
description: "Understand how VisualGuard captures pages, compares them, saves evidence and shares it through the optional dashboard."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/PRODUCT-FEATURES.md",
    "packages/visualguard/src/core/status.ts",
    "apps/platform/server/built-in-runner.ts",
  ]
sidebar: { "order": 1 }
---

This page explains what happens when you run VisualGuard, from opening a page to making a release decision. Read it once before you rely on results. It makes every other page easier to follow.

## Before you start

- You do not need anything installed to read this page.
- To see each step for real, run [your first visual test](/start/quickstart/) alongside it.
- Unfamiliar words are defined in the [glossary](/concepts/glossary/).

## The short version

VisualGuard opens your pages in a real browser, takes screenshots and records the page structure (the DOM). It compares them with a **reference**: the appearance you expect. It then tells you what changed, which page elements changed, and whether that should fail your build.

VisualGuard tests any page a browser can open. React, Next.js, Vue and plain HTML sites all work, because VisualGuard looks at the rendered page, not your source code.

## The workflow, step by step

1. **Capture.** A browser opens the reference and the **candidate** (the version you are checking). It uses the same screen size, locale, time zone and colour scheme each time, so screenshots are repeatable.
2. **Compare.** VisualGuard finds the changed pixels. It links each changed area to the page elements under it and labels the change, such as a style, text, layout or missing element change. It also runs independent checks, such as broken images, overlapping controls or (when enabled) accessibility.
3. **Inspect.** Each comparison gets a status: `pass`, `review`, `regression`, `accepted` or `error`. You read the evidence in a local HTML report or in the dashboard.
4. **Decide.** You fix a real regression, [accept an intentional change](/guides/accepting-changes/) locally, or record a [team review](/dashboard/reviews/) in the dashboard.
5. **Reuse.** Approved results can become the reference for later runs, as [local baselines](/guides/local-baselines/) or [approved team baselines](/dashboard/approved-baselines/).
6. **Repeat.** Run the same check on your laptop, [in CI](/ci/overview/) on every pull request, or [on a schedule](/guides/monitoring/).

![Application versions are captured by your browser worker, saved locally and optionally published to a shared dashboard with persistent storage.](/diagrams/execution.svg)

## Where the reference comes from

| Reference                                | When to use it                                              | Read                                               |
| ---------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Another running site, such as production | You can run both versions at once                           | [Comparison modes](/concepts/comparison-modes/)    |
| Saved local baselines                    | There is no stable second site, such as a component gallery | [Create local baselines](/guides/local-baselines/) |
| An earlier scan of the same site         | Quick exploration or monitoring a live site                 | [Monitor a site](/guides/monitoring/)              |
| A state reached inside a Playwright test | The page needs clicks or a login first                      | [Use inside Playwright tests](/guides/playwright/) |

## How changes are judged

VisualGuard's built-in analysis is **deterministic**: the same inputs give the same result, with no AI involved. It can mark some changes as regressions on its own, such as a removed control, new overlaps, clipped text, low contrast, broken images or overflow. Most other visible changes get `review`, which means a person should look.

AI is optional. If you turn on Gemini or Ollama, the model looks at uncertain changes and explains them in plain language. It can mark a change as noise, but it cannot turn a deterministic regression into a pass. See [Add Gemini analysis](/guides/ai-gemini/).

The final status decides the exit code. By default, `regression` and `error` fail the run (exit code `1`), and `review` does not. See [read result statuses](/concepts/results/) and [exit codes](/reference/exit-codes/).

## Where things run and where results go

| Part                                             | Where it runs                                       | What it stores                                                                |
| ------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| The browser capture (`visualguard test`)         | Your computer or a CI worker                        | A run folder under `.visualguard/runs/`                                       |
| The local report (`visualguard report`)          | Your computer                                       | Reads the run folder; serves it on a local port                               |
| The optional dashboard (`visualguard dashboard`) | Your computer or a host you choose                  | Run history, projects, reviews and baselines in SQLite, PostgreSQL or MongoDB |
| A dashboard-requested test (**Run test**)        | The dashboard host, or a private runner you connect | The run, saved into the dashboard project                                     |

Local results are just files. You can open, copy or import them later. The dashboard is a separate server that you start or host yourself. Hosting it never creates a schedule or runs tests on its own.

### Who runs the browser for Run test

When someone presses **Run test** in the dashboard:

- If a [private runner](/dashboard/private-runners/) is connected for that project, it takes the job first.
- Otherwise, when built-in capture is supported and enabled, the dashboard host captures the test itself, authorised by the signed-in user. The host needs Chromium. This built-in runner is off by default on Vercel, because serverless functions cannot keep a browser running. Other serverless hosts need a private runner for the same reason.
- If the installed dashboard does not offer built-in capture, **Run test** needs a connected private runner.

See [release availability](/releases/).

## Who uses VisualGuard

| Reader                        | Typical use                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------- |
| Developer                     | Check a branch or local change before opening a pull request                  |
| QA engineer                   | Compare important screens across releases and investigate differences         |
| Designer or reviewer          | Inspect screenshots and approve the intended appearance                       |
| Team lead or maintainer       | Manage shared references and review rules                                     |
| Platform engineer or operator | Host the dashboard, manage access, keep evidence safe and recover the install |

## Example: one pull request from start to finish

A developer changes the checkout button style. CI runs `visualguard test` against the preview deployment. The `/checkout` job gets `review` because the button's colour changed. The developer opens the report, sees that only the button changed, and asks the designer to look. The designer approves the change in the dashboard's **Review inbox**. A maintainer then promotes the reviewed run as the new approved baseline, so later runs compare against the new design.

## Key words

- A **run** is one execution of VisualGuard and everything it saved.
- A **job** (or check) is one page at one screen size, or one checkpoint in a Playwright test.
- A **baseline** is a saved expected appearance.
- A **project** groups one app's dashboard history and access rules.
- A **revision** is the source commit the captured app was built from.

See the full [glossary](/concepts/glossary/).

## Troubleshooting

| Problem                                            | Fix                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every run shows small differences you did not make | Captures are not repeatable yet. See [make captures repeatable](/guides/stable-captures/).                                                           |
| A run passed but you expected a change             | Check that both URLs point to the versions you meant. Run `visualguard test --list`.                                                                 |
| The dashboard shows no runs                        | Tests run outside the dashboard. Publish with `visualguard test PROJECT --dashboard URL`, or import a run. See [publishing](/dashboard/publishing/). |
| **Run test** has no available capturer             | Enable supported dashboard-host capture or connect a [private runner](/dashboard/private-runners/).                                                  |

More help: [troubleshooting](/troubleshooting/).

## Next steps

- [Choose a comparison mode](/concepts/comparison-modes/): pick the right kind of reference.
- [Read result statuses](/concepts/results/): what each status means and what fails a build.
- [Run your first visual test](/start/quickstart/): see the workflow on a demo.
