---
title: "Requirements"
description: "Check Node, Playwright browsers, operating systems and optional services before starting."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["package.json", "packages/visualguard/package.json", "docs/RELIABILITY-CHANGES.md"]
sidebar: {"order": 2}
---

## VisualGuard package users

- Node.js **22.12 or newer**. Check `node --version`. Use an even-numbered supported Node release for a maintained environment.
- An application repository with npm or pnpm and two reachable versions, or the local demo in the quickstart.
- A compatible Playwright installation (peer minimum 1.45) and the binaries for each selected browser. Install the browser with the same Playwright version used by your project.
- Network access from the capture machine to both application URLs. A hosted dashboard does not make a private application reachable from your runner.

On macOS and Windows, install the selected browser normally. On Linux/CI, install system dependencies too:

```sh
npx playwright install --with-deps chromium
```

This may require permission to install operating-system packages. For Firefox/WebKit, install the selected browser as well. The CLI supports Windows; POSIX shell/Docker examples use WSL there. Do not paste `export`, heredocs or backslash continuations directly into PowerShell. Simple one-line npm/VisualGuard commands work in its normal shell.

## Optional services

| Workflow | Additional prerequisites |
| --- | --- |
| Local visual test/report/baseline | None: no login, database or AI key. |
| Local dashboard | SQLite is embedded; no separate database service. |
| Shared dashboard | Login, canonical HTTPS origin and persistent PostgreSQL or transactional MongoDB. |
| Google login | Web OAuth client and configured callback/audience; password access can be used without it. |
| AI analysis | Gemini key or a reachable Ollama service with the selected model. |
| Remote publishing | Dashboard URL, existing project and project upload token. |
| Dashboard-triggered tests | Connected browser worker with a separate project runner credential. |

A dashboard-only host does not need Playwright browsers. The browser worker does. Do not omit optional package dependencies when installing a dashboard: database and OIDC drivers use that packaging mechanism.

## Repository and documentation contributors

Use Git and pnpm **9.0.0**. The documentation application requires Node **22.22+**; Node 24 meets the tested toolchain requirements. This does not raise the consumer CLI minimum. For a checkout install excluding docs, use `pnpm install --filter visualguard... --filter @visualguard/platform...`; root installation may still resolve workspace metadata, so use a current Node when possible. The full website instructions are in [documentation development](/contributing/documentation/).

## Check before continuing

Run `node --version` and the selected package manager's version command. Install dependencies from the application or repository directory named by your guide, then run VisualGuard doctor after creating the config. [Continue to installation](/start/install/).
