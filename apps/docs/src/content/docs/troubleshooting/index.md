---
title: "Troubleshooting"
description: "Find a symptom, check its cause and verify the smallest corrective action."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["CONTRIBUTING.md"]
sidebar: {"order": 1}
---

## Choose the failing stage

- [Installation and version](/troubleshooting/installation/): Node, package resolution, optional drivers or missing browser binaries.
- [Capture and reports](/troubleshooting/capture/): unreachable pages, blank/login screenshots, unstable pixels or missing reports.
- [Dashboard and accounts](/troubleshooting/dashboard/): wrong storage/project, login/origin, token, upload, runner and policy issues.
- [CI and previews](/troubleshooting/ci/): missing secrets/permissions, stale URLs/revisions, artifacts and incomplete shards.

Start by recording the installed package version, CLI-reported version, Node/Playwright/browser, OS, exact working directory and redacted config. For npm 3.2.3 the CLI label is 3.2.2; verify with `npm ls visualguard --depth=0`. Run doctor using the same config as the failed test.

A useful support report contains the expected/actual result and a minimal reproducible route. Remove secrets, session cookies, private DOM text/screenshots and source excerpts before sharing. Never paste raw environment files or tokens.
