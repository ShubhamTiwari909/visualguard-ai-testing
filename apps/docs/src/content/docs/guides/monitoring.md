---
title: "Monitor a site over time"
description: "Create rolling monitoring references, choose an update policy and schedule checks without losing their history."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/cli/commands/monitor.ts", "packages/visualguard/src/setup/workflow-template.ts"]
sidebar: {"order": 17}
---

Monitoring compares a live site with its previous saved appearance. Use it to spot production changes such as CMS edits or broken third-party content. It does not require a second deployment. Monitoring and [watching local source edits](/guides/watch/) are separate workflows.

## Before you start

[Install VisualGuard and Chromium](/start/install/). Choose a URL reachable by the machine or CI job that will capture it. The commands below use the candidate page from the [local quickstart](/start/quickstart/); keep its server running, or replace the address with your real production origin.

## 1. Create the first monitoring reference

```sh
npx --no-install visualguard monitor http://127.0.0.1:4101 --no-ai
```

The first run saves snapshots under the configured `monitor.dir`, normally `.visualguard/monitor/HOST/`. Inspect that initial appearance before relying on it. First-reference creation does not certify that the current site is correct.

## 2. Run again and inspect the change

Change the demo button color, restart its server and run the same monitor command. Open the report using the same config/output settings:

```sh
npx --no-install visualguard monitor http://127.0.0.1:4101 --no-ai
npx --no-install visualguard report
```

Read the status and findings. Under the default `monitor.update: 'unless-regression'`, regressed pages retain their old reference until fixed or explicitly reset. Other pages can roll forward. This is an automated observation policy, not a human-approved baseline registry.

## 3. Choose reference updates deliberately

Merge this fragment into an existing config:

```ts
monitor: {
  dir: '.visualguard/monitor',
  update: 'unless-regression',
},
```

`update: 'always'` rolls every page forward. Use `--reset` only after reviewing the current appearance, because it explicitly replaces monitoring snapshots:

```sh
npx --no-install visualguard monitor http://127.0.0.1:4101 --reset --no-ai
```

For references that change only after deliberate approval, use [local baselines](/guides/local-baselines/) or [approved team baselines](/dashboard/approved-baselines/).

## 4. Schedule actual captures

The following creates `.github/workflows/visualguard-monitor.yml` and exits; it does not start a scheduler on your computer:

```sh
npx --no-install visualguard monitor https://YOUR_REAL_SITE --workflow '0 3 * * *'
```

Replace the URL with a real address before running. Review the generated workflow, package-manager/dependency commands, browser installation and schedule, then commit it to your repository's normal default-branch workflow path. GitHub cron uses UTC. A scheduled cloud worker cannot reach a laptop's localhost unless you explicitly provide that network path.

Persist `monitor.dir` between CI runs using your trusted cache/storage process, and preserve the evidence/report directory after each run. A fresh ephemeral runner without prior snapshots starts over instead of comparing with yesterday. Keep unrelated sites/projects from sharing the same writable snapshot directory accidentally.

## Check the setup

Confirm the first run saves references, a second run compares against them and a known regression retains the intended old reference. Restart or recreate your worker, restore the monitor directory, and verify it still uses prior captures. Check CI artifacts and any configured webhook independently from capture success.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Every run behaves like a first run | Persist and restore the actual monitor directory before capture. |
| Change disappears from the next result | Review the rolling update policy; use controlled baselines for approval workflows. |
| Workflow never runs | Check the committed workflow/default branch, valid UTC schedule and provider execution history. |
| Site unreachable in CI | Use the actual deployed URL or an authorized runner with network access. |

[Configure CI](/ci/overview/) and [report delivery](/guides/reporters/) after the local monitor works.
