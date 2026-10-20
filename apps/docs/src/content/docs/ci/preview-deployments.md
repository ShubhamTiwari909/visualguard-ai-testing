---
title: "Test the actual preview revision"
description: "Wait for a preview deployment and publish evidence with the commit that actually served it."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "docs/NPM-PACKAGE-SETUP.md"]
sidebar: {"order": 3}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

## Choose a trusted preview URL

Use your deployment system's successful deployment event or a bounded readiness check. Set `VISUALGUARD_STAGING_URL` or `--staging` to that event's actual environment URL. Keep the reference URL stable and inspect access protection; a login/error page is not the intended application.

For a GitHub workflow using a successful deployment status, pass `github.event.deployment_status.environment_url` as the Action's `staging-url`. Validate the event belongs to your expected repository/project and successful state before running. The deployment event's code SHA and the PR head can differ; resolve their relationship instead of assuming it.

## Bind evidence to the captured commit

On a pull-request workflow, an Actions checkout may default to a temporary merge ref. For exact-revision policy checks, deploy/capture the real PR head and record that SHA. The following command is a template: replace all uppercase values with the actual deployed URL, full captured commit and PR number, after configuring the scoped upload credential.

```sh
npx --no-install visualguard test storefront --dashboard https://YOUR_DASHBOARD_HOST --staging https://ACTUAL_PREVIEW_HOST --commit CAPTURED_FULL_SHA --pr 123 --environment staging --no-ai
```

The shell/CI environment needs `VISUALGUARD_UPLOAD_TOKEN` for login-mode publishing. Neither database nor dashboard administrator credentials belong on that worker. The test command loads ignored application `.env`/`.env.local` locally; CI values should already be set by the job.

## Verify and troubleshoot

Check the actual preview build's commit, run manifest revision and current PR head independently. A stale preview must not satisfy a new-head policy. If readiness, authentication or network access fails, fix that before trusting the screenshots. [Configure exact-revision delivery](/ci/github-checks/).
