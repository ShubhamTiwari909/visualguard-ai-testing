---
title: "Frequently asked questions"
description: "Short answers to the questions newcomers ask about AI, databases, the dashboard, baselines, exit codes, browsers, CI and Windows."
audience: "developer"
docType: "explanation"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/config/schema.ts",
    "packages/visualguard/src/core/status.ts",
    "packages/visualguard/src/cli/commands/auth.ts",
    "packages/visualguard/src/cli/commands/zero-config.ts",
    "apps/platform/server/built-in-runner.ts",
    "action/action.yml",
  ]
sidebar: { "order": 5 }
---

Quick answers to the questions people ask most when they start with VisualGuard. Each answer links to the page with the full details. If your question is about a specific task, try [Find what you need](/start/common-tasks/).

## Getting started

### Do I need AI to use VisualGuard?

No. The built-in analysis finds changed pixels, links them to page elements and can flag clear regressions on its own. AI (Gemini or Ollama) is optional and adds plain-language explanations. Set `ai: { provider: "none" }` or pass `--no-ai` to turn it off. See [how changes are judged](/concepts/how-it-works/).

### Do I need a database?

Not for testing. `visualguard test` saves results as files under `.visualguard/runs/`. The local dashboard uses a built-in SQLite file, so you still install nothing. Only a shared team dashboard needs PostgreSQL or MongoDB. See [choose your setup](/start/choose-setup/).

### Do I need the dashboard?

No. Local tests and the HTML report work on their own. Add the dashboard when you want run history, shared reviews, approved baselines or team access. See the [dashboard overview](/dashboard/overview/).

### Does it work with React, Vue, Next.js or plain HTML?

Yes. VisualGuard tests the rendered page in a real browser, not your source code. Any page a browser can open works, whatever framework built it. See [how VisualGuard works](/concepts/how-it-works/).

### Does my app have to run on the same machine?

No. The machine running VisualGuard only needs to reach both URLs over the network. You can compare a deployed production site with a local dev server, for example `https://shop.example.com` against `http://127.0.0.1:3000`. See [install VisualGuard](/start/install/).

### Does it work on Windows?

Yes. Chromium is part of the full test matrix on Windows, macOS and Linux. One-line commands work in PowerShell. Use WSL for examples with `export`, heredocs or `\` line continuations. See [requirements](/start/requirements/).

### Which browsers can I use?

Chromium (the default), Firefox and WebKit. Choose one with `browser.name` in the config or `--browser firefox` on the command line, and install it with `npx playwright install firefox`. Chromium has the widest test coverage. See [browsers and viewports](/guides/browsers-and-viewports/).

### Why do the CLI label and installed package version differ?

First use the locally installed command with `npx --no-install visualguard --version`, then run `npm ls visualguard --depth=0` to see the installed package version. A different binary on your PATH or a stale embedded build label can explain a mismatch. Include both values when reporting it. See [release availability](/releases/).

## Results

### Why did my test fail?

Check the exit code. `1` means a job has a failing status (by default `regression` or `error`) or a merged run is incomplete. `2` means a config or command mistake, and `3` means an environment problem such as a missing browser or unreachable URL. See [exit codes](/reference/exit-codes/).

### A job says `review`, but the run passed. Why?

By default only `regression` and `error` fail a run. `review` means "a person should look", so it does not fail unless you pass `--fail-on review`. See [read result statuses](/concepts/results/).

### Why do I see differences I did not make?

Usually the capture is not repeatable yet: animations, dates, ads or late-loading content change between runs. Make captures stable first, then tune thresholds. See [make captures repeatable](/guides/stable-captures/) and [tune differences and noise](/guides/diff-and-noise/).

### Where are results stored?

Each run is a folder under `.visualguard/runs/` with `manifest.json`, screenshots, diff images and `index.html`. The last 10 runs are kept by default (`output.keepRuns`). See [run artifacts](/reference/artifacts/).

### How do I share a report?

Share the whole run folder, because `index.html` links to the image files beside it. For ongoing sharing, publish runs to a dashboard. See [inspect and share reports](/guides/reports/) and [publishing](/dashboard/publishing/).

## Baselines and approvals

### What is the difference between a baseline, an accepted change and an approved baseline?

- A **local baseline** is a set of saved screenshots that a run compares against in `mode: "baseline"`. You update it on purpose with `visualguard test --update-baselines`. See [local baselines](/guides/local-baselines/).
- An **accepted change** is one specific difference you marked as intentional with `visualguard accept`. It is stored in `visualguard.accepted.json`, and matching jobs later show `accepted`. See [accepting changes](/guides/accepting-changes/).
- An **approved baseline** is a versioned, reviewed reference set in the dashboard. It changes only when someone promotes reviewed evidence. See [approved baselines](/dashboard/approved-baselines/).

### Does a passing run mean the change is approved?

No. A finished run only means the capture completed, and its status is the engine's verdict. Approval is a separate decision a person records, such as a dashboard review. See [completion is not approval](/concepts/results/).

## Pages and coverage

### Can it test pages behind a login?

Yes. Run `visualguard auth staging` to log in once in a browser window. VisualGuard saves the session and reuses it for captures. For logins inside a test flow, use the Playwright fixture. See [capture authenticated pages](/guides/application-auth/).

### Can I test only some pages?

Yes. List paths in `routes`, or filter one run with `--route /pricing` or `--only "/blog/**"`. Run `visualguard test --list` to see what will be tested. See [select routes](/guides/routes/).

### Can I check a page after a click or form step?

Yes, inside your own Playwright tests with the `visualguard/playwright` fixture. See [use inside Playwright tests](/guides/playwright/).

## AI, cost and data

### What data is sent to the AI provider, and what does it cost?

With AI on, VisualGuard sends prepared screenshots and page structure (DOM) context to the provider you chose. `visualguard fix` may also send source code excerpts, after you consent. Gemini usage is billed to your own Google account; limit it with `ai.maxCallsPerRun`, `ai.maxTokens` and caching. Ollama runs the model on a machine you control. See [control AI policy and cost](/guides/ai-policy-and-budgets/).

### Does VisualGuard send anything elsewhere?

Results stay on your machine unless you set up something that sends them: an AI provider, a dashboard you publish to, a `report.webhook`, or a pull request comment. See [reporters and integrations](/guides/reporters/).

### Will VisualGuard change my code?

Only if you run `visualguard fix`. It asks before every change. `fix --auto` works on a new branch in a separate Git worktree, unless you pass `--in-place`. See [propose and verify a repair](/guides/fixes/).

## CI and the dashboard

### Can I run it in CI?

Yes. Use the VisualGuard GitHub Action, or run `visualguard test --ci` in any CI system. Install the browser on the CI machine with `--with-deps` on Linux. See [run visual tests in CI](/ci/overview/).

### What does Run test in the dashboard need?

It depends on the installed dashboard and its host. If the project says **Runs on this dashboard**, it can capture using your sign-in and the host's Chromium. Use a private runner on Vercel, when host capture is unavailable, or when only your worker can reach the app. See [run tests from the dashboard](/dashboard/run-tests/) and [release availability](/releases/).

### Does hosting the dashboard run tests on a schedule?

No. Hosting the dashboard never creates a schedule. Use `visualguard monitor --workflow` or your own CI schedule. See [monitor a site over time](/guides/monitoring/).

### Does each team member need their own dashboard?

No. One hosted dashboard serves a whole team, with many projects and per-project roles. See [people and permissions](/dashboard/people-and-permissions/).

## Next steps

- [Find what you need](/start/common-tasks/): every task mapped to a command and page.
- [Glossary](/concepts/glossary/): definitions of every term.
- [Troubleshooting](/troubleshooting/): fixes by symptom.
