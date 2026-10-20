---
title: "Installation and version problems"
description: "Diagnose unsupported Node, missing browser binaries, package labels and driver installation."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/config/load.ts"]
sidebar: {"order": 2}
---

| Symptom | Cause / diagnostic | Fix and verification |
| --- | --- | --- |
| Node unsupported | `node --version` shows an older runtime. | Use CLI 22.12+ or docs 22.22+ as appropriate, reinstall under that runtime, rerun doctor/build. |
| npm 3.2.3 prints CLI 3.2.2 | Known embedded version label in the published artifact. | Check `npm ls visualguard --depth=0`; keep both versions in reports. Do not reinstall repeatedly to chase the label. |
| Browser executable missing | Playwright library exists but its matching binary does not. | Run `npx playwright install chromium` in the application; on Linux include `--with-deps`. Rerun doctor. |
| Missing pg, MongoDB or OIDC module | Dashboard installed with optional dependencies omitted. | Reinstall the package with optional dependencies enabled; restart with the same DB settings. |
| npx fetches another package | Command not run at the installed application root. | Use `npx --no-install visualguard --help` from that root and inspect package-manager metadata. |
| pnpm/Corepack unavailable | Package manager not installed for the selected Node. | Follow [pnpm installation](https://pnpm.io/installation) for pnpm 9; do not mix npm/pnpm lockfiles. |
| Config not found | Wrong working directory or unsupported discovered filename. | Use the actual app root or `--config PATH`; JSON requires explicit selection. Run `test --list`. |

[Repeat installation](/start/install/) only after diagnosing which prerequisite is missing. No AI key or database is required for the first local comparison.
