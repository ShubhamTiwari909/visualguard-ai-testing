# VisualGuard product features

VisualGuard catches unexpected changes in how a website looks. It opens two versions of your pages in a real browser, compares them, and tells you what changed and why it matters. Everything below works on your own computer. A shared dashboard, AI and an external database are optional.

## The basic loop

1. **Capture** the same pages from two versions, such as production and staging.
2. **Compare** them. VisualGuard finds the changed pixels and the page elements behind them.
3. **Explain** the result with a report: side-by-side images, a diff, and a status for each page.
4. **Review** the difference. Fix it if it is a bug, or accept it if it was intended.

VisualGuard tests anything a browser can open: React, Next.js, Vue or plain HTML.

A **run** is one execution. A **check** is one page at one viewport. A **baseline** is a saved expected look. A **project** groups one app's dashboard history and access.

| If you are a...    | You will probably...                                          |
| ------------------ | ------------------------------------------------------------- |
| Developer          | Check a branch before opening a pull request                  |
| QA engineer        | Compare key screens across releases                           |
| Designer           | Look at screenshots and approve the intended appearance       |
| Manager or lead    | See what changed and what still needs a decision              |

## What you can do

### Compare

- **Production vs staging.** Compare two running sites, deployed or local. Map different paths, such as `/pricing` on one side and `/plans` on the other. Run `npx visualguard test`.
- **One site over time.** Save screenshots as local baselines, then compare later runs against them. Run `npx visualguard https://example.com` to scan one site and compare it on the next scan, or pass two URLs to compare them.
- **Specific pages.** List routes, filter them, add dynamic examples such as blog slugs, or let VisualGuard find pages from Next.js files, a sitemap or a crawl. Pick viewports, locale, theme and Chromium, Firefox or WebKit.
- **Interactive states.** The `visualguard/playwright` fixture checks a page after your Playwright test logs in or opens a dialog.

### Understand

- **Stable screenshots.** Waits for fonts and network, stops animations, freezes time and scrolls lazy content. Mask noisy areas with `data-visualguard-ignore` and set tolerances. Wide masks can hide real changes.
- **Findings and statuses.** Each page ends as Pass (within tolerance), Review (a person should look), Regression (a real problem), Accepted (matches a recorded intentional change) or Error (capture failed). Findings name the changed element and flag problems such as clipping, overlaps, low contrast, broken images and failed requests. Optional accessibility (axe) and performance checks run alongside.
- **Reports.** Every run writes an HTML report with side-by-side, slider, overlay and diff views, plus `manifest.json`, JUnit and JSON output. Open it with `npx visualguard report`. Share the whole run folder, not just `index.html`.
- **Optional AI.** Gemini or Ollama can classify unclear differences. AI never hides a deterministic regression, and without it VisualGuard still works. Run `npx visualguard analyze` to re-analyze saved captures.
- **Proposed fixes.** `npx visualguard fix` suggests a source change, shows the diff, asks before applying it and re-checks the result. It is off by default.

### Review and accept

- **Intentional changes.** `npx visualguard accept` records a change you meant to make, so later local runs recognize it. It cannot hide new problems.
- **Two kinds of "accept".** Local acceptance is for your own runs. Approving a change in the dashboard is a shared decision by a reviewer, tied to that exact evidence. One does not replace the other.
- **Local baselines.** Creating or updating saved screenshots is always an explicit action. Mismatched browsers or viewports are rejected instead of compared.

### Automate

- **Watch mode.** `npx visualguard watch` re-runs affected pages when you edit source files.
- **Monitoring.** `npx visualguard monitor` compares a live site with its last capture. A scheduler such as a GitHub workflow repeats it.
- **CI and GitHub.** Run non-interactively with exit codes, job summaries and preview-deployment URLs. A GitHub Action, generated workflows and `npx visualguard comment` post a summary on pull requests. A webhook can send a JSON summary elsewhere.
- **Sharding.** Split a large run across CI jobs with `--shard`, then `npx visualguard merge` checks coverage and combines the results.

### Work as a team

- **Shared dashboard.** `npx visualguard dashboard` stores runs by project with filters for status, branch, revision and date. Publish runs from the CLI or import saved ones. Maintainers can rename or delete projects.
- **Run a test from the dashboard.** Save routes, URLs and viewports on a project, then choose **Run test**. The dashboard captures the pages itself using only your signed-in login, with no runner token. Progress shows live and the finished run links from the project. A private runner is optional (and required with the published 3.2.3 package, which predates this). Use one when the dashboard cannot reach your site, or on hosts without a browser such as Vercel. Start it with `npx visualguard dashboard runner`.
- **Accounts and sign-in.** Use local owner access, password login or Google sign-in. Link Google to an existing account, or invite people with expiring links. Roles are viewer, reviewer, maintainer and workspace administrator. Administrators can also disable users and revoke sessions.
- **Review inbox.** Reviewers comment, assign people, set deadlines, and approve, request changes or withdraw. The inbox lists what needs attention.
- **Approved baselines.** Maintainers promote reviewed evidence into numbered, immutable versions of a named set such as `main`. Runners fetch one with `dashboard baseline pull` and compare against it offline.
- **Visual policies and GitHub checks.** A policy states what evidence a revision needs. The result is Pending, Satisfied or Blocked, and can appear as a GitHub Check Run. Start in Informative mode before making it required.

### Hosting and data

- **Your data.** You own the database, domain and secrets. Application logins and source code stay on the machine that runs the tests.
- **Databases.** The local dashboard uses SQLite with no extra service. Shared installs use PostgreSQL or MongoDB. Screenshots are stored in the database.
- **Deploy.** `npx visualguard dashboard init` generates Vercel or Cloud Run files. Both need an external database. Cloud Run can run tests itself, but Vercel cannot.
- **Backups.** Export portable evidence, or take native database backups to restore a whole installation. The Audit & recovery page lists changes to access and settings. A password administrator can be recovered by an operator.

## Where to start

| You want to                                | Read                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Try VisualGuard inside your own app        | [NPM-PACKAGE-SETUP.md](NPM-PACKAGE-SETUP.md)                                                                                   |
| Run it from this repository's source       | [LOCAL-SETUP.md](LOCAL-SETUP.md)                                                                                               |
| Look up commands and configuration         | [Package README](../packages/visualguard/README.md)                                                                            |
| Learn the dashboard, reviews and policies  | [Dashboard overview](../apps/docs/src/content/docs/dashboard/overview.md)                                                      |
| Deploy the dashboard                       | [Deployment overview](../apps/docs/src/content/docs/deployment/overview.md)                                                    |
| Set up CI                                  | [CI overview](../apps/docs/src/content/docs/ci/overview.md)                                                                    |

A good first step is one route and the local report, with no AI and no database. Add a dashboard when a team wants to review together.

## Limits

- Screenshots from a different operating system, browser, viewport, theme or locale may not be a valid reference.
- Automated accessibility and performance checks are not a full audit. Local timings are not a production benchmark.
- Passing a run does not mean the team approved it. Approval is a separate dashboard decision.
- Hosting the dashboard does not schedule tests or monitoring. Use CI or another scheduler.
- There is no managed runner fleet, billing, automatic invitation emails, Slack or Teams integration, or external screenshot bucket.
- A GitHub check does not authorize a release, and VisualGuard does not set branch protection.
- Generated Vercel and Cloud Run files are not a tested production deployment.
