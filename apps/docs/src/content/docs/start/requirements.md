---
title: "Requirements"
description: "Check Node.js, Playwright browsers, operating systems and optional services before you install VisualGuard."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["package.json", "packages/visualguard/package.json", "packages/visualguard/src/cli/commands/doctor.ts", "docs/RELIABILITY-CHANGES.md"]
sidebar: {"order": 3}
---

This page lists what you need before you install VisualGuard. The basic needs are small: Node.js, a browser that Playwright can drive, and an app the browser can reach. Everything else, such as AI or a dashboard, is optional and listed separately.

## Before you start

- Decide which setup you want. [Choose your setup](/start/choose-setup/) explains the options.
- Open a terminal. Examples use macOS/Linux shells; on Windows use WSL for multi-line shell commands.

## What every user needs

| Need | Minimum | How to check |
| --- | --- | --- |
| Node.js | **22.12** or newer | `node --version` |
| A package manager | npm (comes with Node.js) or pnpm | `npm --version` or `pnpm --version` |
| Playwright | **1.45** or newer (a peer dependency) | `npx playwright --version` |
| A Playwright browser | Chromium by default; Firefox or WebKit if you choose them | `npx --no-install visualguard doctor` after install |
| Something to test | Two reachable versions of your app, or the demo in the [quickstart](/start/quickstart/) | Open both URLs in a browser |
| Network access | The capture machine must reach every URL it tests | `npx --no-install visualguard doctor` checks each URL |

Notes:

- Use an even-numbered (LTS) Node.js release for a maintained environment. The project's CI covers Node 22 and 24.
- Install the browser with the **same Playwright version** your project uses. If your project already has Playwright, keep it if it is 1.45 or newer.
- A hosted dashboard does not make a private app reachable. The machine that runs the browser must reach your app itself.

### Install the browser

On macOS and Windows, install the browser normally:

```bash
npx playwright install chromium
```

On Linux and in CI, also install the system libraries the browser needs:

```bash
npx playwright install --with-deps chromium
```

You should see Playwright download the browser and finish without errors. `--with-deps` may ask for permission to install operating system packages. For Firefox or WebKit, replace `chromium` with `firefox` or `webkit`.

### Operating systems

| System | Status |
| --- | --- |
| macOS | Supported. Chromium is in the full test matrix. |
| Linux | Supported. Chromium is in the full test matrix; Firefox and WebKit have smaller smoke tests. |
| Windows | Supported. Chromium is in the full test matrix. One-line npm and VisualGuard commands work in PowerShell. Use WSL for examples with `export`, heredocs or `\` line continuations. |

See [compatibility](/reference/compatibility/) for the full tested scope.

## Install or select Node.js

If `node --version` fails or shows a version older than 22.12:

1. Install a supported LTS release from [the official Node.js download page](https://nodejs.org/en/download).
2. Close and reopen the terminal.
3. Check `node --version` and `npm --version` again.

If you use nvm and already have Node 24 installed, run `nvm use 24` to select it for the current terminal. Select the same version in every terminal you use for a guide.

## Optional services

You only need these for the features named in the left column.

| Feature | What you also need |
| --- | --- |
| Local visual tests, reports and baselines | Nothing more. No login, database or AI key. |
| Local dashboard | Nothing more. SQLite is built in; there is no database service to install. |
| Shared team dashboard | Login, a fixed HTTPS address, and a persistent PostgreSQL database or MongoDB with transaction support. See [hosting](/deployment/overview/). |
| Google sign-in | A Google web OAuth client with the right callback address. Password sign-in works without it. See [Google sign-in](/dashboard/google-sign-in/). |
| AI analysis | A Gemini API key, or a reachable Ollama server with the chosen model installed. See [Gemini](/guides/ai-gemini/) or [Ollama](/guides/ai-ollama/). |
| Publishing to a hosted dashboard | The dashboard URL, an existing project and a project upload token. See [publishing](/dashboard/publishing/). |
| **Run test** from the dashboard | A signed-in maintainer and either enabled dashboard-host capture with Chromium, or a connected [private runner](/dashboard/private-runners/) with a project runner credential. Use a private runner on Vercel or if the installed dashboard does not support host capture. |

:::note
A dashboard host that only stores and shows results does not need Playwright browsers. A host that runs **Run test** itself does, and so does every private runner.
:::

:::caution
Do not skip optional package dependencies when you install a dashboard. Do not use `npm install --omit=optional`. The PostgreSQL, MongoDB and sign-in drivers are shipped as optional dependencies.
:::

## Example: checking a new laptop

A developer joins a team that already uses VisualGuard. They run `node --version` and see `v20.11.0`, which is too old. They install Node 24 LTS, reopen the terminal and see `v24.x`. In the app folder they run `npm install`, then `npx playwright install chromium`, then `npx --no-install visualguard doctor`. Every line shows a green check and the output ends with `Ready.`

## Repository and documentation contributors

These extra needs apply only if you work on VisualGuard's own source code.

| Need | Version |
| --- | --- |
| Git | Any current version |
| pnpm | **9.0.0** |
| Node.js for the documentation site | **22.22** or newer (Node 24 meets every tested requirement) |

The docs site needs a newer Node than the CLI. This does not raise the CLI's 22.12 minimum. To install a checkout without the docs site, run:

```bash
pnpm install --filter visualguard... --filter @visualguard/platform...
```

A root install may still read workspace metadata, so use a current Node release when you can. See [documentation development](/contributing/documentation/) and [run from source](/contributing/local-setup/).

## Check your environment

1. Run `node --version`. It should print `v22.12.0` or newer.
2. Run `npm --version` (or `pnpm --version`).
3. After you [install VisualGuard](/start/install/) and create a config, run `npx --no-install visualguard doctor`. You should see a check mark for Node.js, Playwright, the browser and each URL, and the word `Ready.` at the end.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `node --version` shows an older version | Install Node 22.12 or newer, reopen the terminal, and select it with `nvm use` if you use nvm. |
| Doctor says the browser executable is missing | Run `npx playwright install chromium` from the same app folder. |
| The browser fails to start on Linux or CI | Run `npx playwright install --with-deps chromium` to add system libraries. |
| Doctor cannot reach a URL | Start the app, check the port, and make sure the capture machine can reach that host. |
| A PowerShell command fails on `export` or `\` | Use WSL for that example, or rewrite it as a single line. |
| Dashboard cannot load its database driver | Reinstall without `--omit=optional`. |

More fixes: [installation problems](/troubleshooting/installation/).

## Next steps

- [Install VisualGuard](/start/install/) in your app.
- [Run your first visual test](/start/quickstart/) with a ready-made demo.
- [Find what you need](/start/common-tasks/) for any other task.
