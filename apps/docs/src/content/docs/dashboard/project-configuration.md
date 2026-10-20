---
title: "Configure tests per project"
description: "Save a bounded project comparison profile and understand version conflicts and worker-only secrets."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/project-tests.ts"]
sidebar: {"order": 5}
---

## Before you start

Use an installed VisualGuard release containing the described features and administrator access to the selected dashboard. Complete [local dashboard setup](/dashboard/local/) first. Work from your application root unless a step names a deployment folder. The shell examples use macOS/Linux POSIX syntax; use WSL for shell/Docker walkthroughs on Windows. Keep existing application/dashboard processes running in separate terminals.

Select a project in the sidebar, or select it in the Run history project filter and apply the filter. Its project section has **Configure tests** and **Run test** for workspace administrators and project maintainers.

Choose **Configure tests**, then enter that project's production/reference URL, staging/candidate URL, routes (one per line), viewports and AI provider/model. Save the configuration. Each project stores its own values in the dashboard database; configuring one app does not change another app. A request runs an exact snapshot of the saved version. Save pending edits before starting a test; refresh before editing again if another maintainer changed the version.

For example, project `storefront` can compare `https://shop.example.com` with `https://preview-shop.example.com`, while project `docs` compares `https://docs.example.com` with `http://127.0.0.1:3001`. The URLs must be reachable from the runner. `localhost` refers to the runner's computer, including when the dashboard is hosted elsewhere.

The dashboard config is a bounded comparison profile: explicit routes (up to 100), one to eight viewports, and an optional AI provider/model. It stores no passwords, API keys, application cookies, arbitrary file paths, executable TypeScript or capture hooks. Keep full-feature local configuration in `visualguard.config.ts` when using ordinary CLI tests, including application login state, custom hooks and baseline mode. Saving a dashboard profile does not rewrite that file or change existing `visualguard test --config ...` behavior.

## Verify the setup

Save different URLs/routes in two projects, revisit each and confirm isolation. Refresh after a stale edit conflict and review the latest saved version before running.

## Troubleshooting and next steps

Check the canonical origin, selected project, environment file and installed dashboard/runner versions. [Diagnose dashboard symptoms](/troubleshooting/dashboard/) before creating another workspace. [Continue the dashboard workflow](/dashboard/private-runners/). Keep long-running dashboard/runner processes open; stop with Ctrl+C when finished.
