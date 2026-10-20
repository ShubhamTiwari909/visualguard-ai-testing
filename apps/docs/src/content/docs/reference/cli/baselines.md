---
title: "Baseline command workflows"
description: "Choose between local baselines, approved team baselines and rolling monitor snapshots, and see the exact commands that create, update or download each one."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["README.md", "docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/cli/commands/monitor.ts", "packages/visualguard/src/core/provenance.ts", "packages/visualguard/src/core/run.ts"]
sidebar: {"order": 3}
---

A baseline is a saved "expected" screenshot that later runs compare against. VisualGuard has three kinds, and each one is created and updated by a different command. Use this page to pick the right kind and to find the exact commands for it. New to the term? See the [glossary](/concepts/glossary/).

## Before you start

- Read [comparison modes](/concepts/comparison-modes/) if you are not sure whether you need baselines at all. The default `compare` mode needs no baselines: it compares production with staging live.
- Run commands from your app's root folder.

## Which baseline do I need?

| Kind | Who owns it | How it is created | How it is updated | Where it lives |
| --- | --- | --- | --- | --- |
| Local baselines | Your repository | `test --update-baselines` | `test --update-baselines` again, on purpose | `baseline.dir` (default `visualguard/baselines`) |
| Approved team baselines | The dashboard, after review | Promotion in the dashboard | A new approved version, then a new `baseline pull` | A new folder you choose with `--out` |
| Monitor snapshots | The `monitor` command | The first `monitor` run | Automatically after each run, unless a page regressed | `monitor.dir` (default `.visualguard/monitor`), one folder per host |

## Local baselines

Use these when you want reviewed screenshots stored in git, for example for a component library or a page that has no separate production site.

### 1. Configure baseline mode

Your config needs `mode: "baseline"`, a staging URL, explicit routes and viewports, and `baseline.dir`. [The local baselines guide](/guides/local-baselines/) has a complete config.

### 2. Save the baselines on purpose

Check that the current pages look right, then save them:

```bash
npx --no-install visualguard test --config visualguard.baseline.ts --update-baselines --no-ai
```

You should see each job saved. VisualGuard writes a PNG plus `.meta.json`, `.dom.json` and `.health.json` files next to it for each route and viewport.

### 3. Compare against them

```bash
npx --no-install visualguard test --config visualguard.baseline.ts --no-ai
```

You should see every unchanged page pass.

### 4. Commit the files together

Commit each PNG with its three sidecar files. VisualGuard uses the metadata to check that a later capture uses the same browser, platform, viewport and theme.

:::caution
Missing or mismatched baselines fail by default. Do not add `--update-baselines` to CI just to make a failure go away; it would accept whatever the page looks like now.
:::

## Approved team baselines

Use these when a team reviews changes in the dashboard and wants everyone, including CI, to compare against the same approved set.

After a reviewer promotes exact evidence in the dashboard, download a pinned version into a new folder:

```bash
npx --no-install visualguard dashboard baseline pull main --project storefront \
  --version 1 --out .visualguard/approved-v1 --server https://YOUR_DASHBOARD_HOST
```

Replace `main`, `storefront`, `1` and the server with your real set name, project ID, version and dashboard. For a dashboard that uses login, set `VISUALGUARD_UPLOAD_TOKEN` to the project's upload token first. Without `--server`, the command reads the local database instead. The `--out` folder must not exist yet; otherwise you see `Output directory already exists; choose a new directory to pin this version`.

You should see a new folder with the approved screenshots and an `approved-baseline.json` receipt. Point `baseline.dir` at it to compare against it.

Approved folders are read-only on your machine. `--update-baselines` refuses to change them with `Approved baselines cannot be updated locally` (or `Approved snapshots cannot be updated locally`). To move forward, approve a new version in the dashboard and pull it into another new folder. See [approved baselines](/dashboard/approved-baselines/).

## Monitor snapshots

Use these to watch a live site over time, for example every night, to catch content edits or broken third-party scripts.

```bash
npx --no-install visualguard monitor https://example.com
```

- The first run saves snapshots and prints `saved to PATH; the next run compares against them`.
- Later runs compare with the last snapshots, then update them. Pages that regressed keep their old snapshot, so they are reported again until fixed.
- `monitor.update: "always"` updates every snapshot, even after a regression.
- `--reset` replaces every stored snapshot with this run's captures. Use it after you checked that a change is intended.
- `--workflow` writes a scheduled GitHub workflow (default `0 3 * * *`) instead of running.

Monitor snapshots are not a human approval. Never use a rolling snapshot as evidence that someone reviewed a change. See [monitoring](/guides/monitoring/).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No baseline yet; run with --update-baselines to save one` | Check the pages, then run `test --update-baselines` once. |
| `Baseline rendering settings do not match: PATH` | Use the original browser, platform, viewport and theme, or regenerate the baselines. |
| `Baseline metadata missing for PATH` | Regenerate the baselines, or set `baseline.legacy: "allow"` briefly while you migrate. |
| `Approved baselines cannot be updated locally` or `Approved snapshots cannot be updated locally` | Promote a new version in the dashboard and pull it into a new folder. |
| `Nothing to monitor: pass a URL or set baseURL.production.` | Pass the site URL to `monitor`, or set `baseURL.production`. |

More help: [capture and baseline problems](/troubleshooting/capture/).

## Next steps

- [Set up local baselines](/guides/local-baselines/) with a complete config.
- [Promote approved baselines](/dashboard/approved-baselines/) in the dashboard.
- [Schedule monitoring](/guides/monitoring/) for a live site.
