---
title: "Installation and version problems"
description: "Fix an old Node version, missing Playwright or browser, wrong package version, missing database drivers and config files that are not found."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/config/load.ts", "packages/visualguard/src/capture/browser.ts", "packages/visualguard/src/cli/commands/doctor.ts", "packages/visualguard/package.json"]
sidebar: {"order": 2}
---

Use this page when VisualGuard will not start, cannot find a browser, or reports a version you did not expect. Each problem below lists the likely cause, the exact fix and how to confirm it.

## Before you start

- Run every command from your app's root folder, the folder that holds `package.json`.
- Run `npx --no-install visualguard doctor` first. It checks most of the problems on this page in one go.
- Examples use macOS/Linux shells; on Windows use WSL.

## Node version is too old

You see `VisualGuard needs Node.js 22.12 or newer.` from `doctor`, or `The dashboard requires Node.js 22.12 or newer.` when the dashboard starts.

- **Likely cause:** the terminal or CI job uses an older Node release.
- **Fix:** switch to Node 22.12 or newer (for example with your version manager), then reinstall dependencies so native packages match the new Node.
- **Confirm:** `node --version` prints 22.12 or newer, and `npx --no-install visualguard doctor` marks Node.js as OK.

Contributors who build this documentation site need Node 22.22 or newer. App users do not.

## Playwright is not installed

You see `Playwright is not installed.` with the hint `Install it with: npm install -D playwright && npx playwright install chromium`.

- **Likely cause:** Playwright is an optional peer dependency, so installing `visualguard` alone does not add it.
- **Fix:**

  ```bash
  npm install -D playwright
  npx playwright install chromium
  ```

- **Confirm:** `doctor` shows a Playwright version and a Browser line with the browser name and its version.

## Browser is not installed

You see `Playwright's chromium browser is not installed.` with the hint `Run: npx playwright install chromium`. The same message names `firefox` or `webkit` if you selected those.

- **Likely cause:** the Playwright library is installed, but the matching browser download is missing. This often happens after a Playwright upgrade, on a fresh CI machine or in a new container.
- **Fix:** install the browser your config uses. On Linux, add `--with-deps` to install system libraries too.

  ```bash
  npx playwright install chromium
  # Linux and CI images:
  npx playwright install --with-deps chromium
  ```

- **Confirm:** `doctor` shows the browser name and version with no failure.

:::note
The dashboard has its own version of this problem when it runs tests itself. See [Run test fails with Chromium is not installed](/troubleshooting/dashboard/).
:::

## The CLI label differs from the installed package

- **Likely cause:** another binary is on your PATH, or the installed artifact carries a stale embedded build label.
- **Fix:** nothing to reinstall. Check the real installed version with your package manager and quote both numbers in bug reports.

  ```bash
  npm ls visualguard --depth=0
  # or
  pnpm list visualguard --depth=0
  ```

- **Confirm:** the package manager shows the concrete installed version. Include it and the CLI label in a mismatch report. See [release availability](/releases/) for details.

## Generated dashboard folder uses an unexpected release

- **Likely cause:** `visualguard dashboard init` writes the dependency version from its embedded CLI label, which can differ from package metadata in a misbuilt artifact.
- **Fix:** inspect the generated `package.json`. To use the current release, run `npm install --save-exact visualguard@latest` in that deployment folder, validate it and commit the lockfile. If you require an earlier tested release, select it deliberately.
- **Confirm:** `npm ls visualguard --depth=0` inside the deployment folder shows the release you intended.

## npx downloads a different package or version

- **Likely cause:** you ran the command outside the app folder, so `npx` could not find the local install and fetched one from the registry.
- **Fix:** move to the app root and use `npx --no-install` (npm) or `pnpm exec` (pnpm). Both refuse to download a package.

  ```bash
  npx --no-install visualguard --help
  ```

- **Confirm:** the command prints help without a download prompt, and `npm ls visualguard --depth=0` shows the version you expect.

## pnpm or Corepack is not available

- **Likely cause:** the package manager is not installed for the Node version you switched to.
- **Fix:** follow the [pnpm installation guide](https://pnpm.io/installation) for pnpm 9. Use one package manager per project and do not mix npm and pnpm lockfiles.
- **Confirm:** `pnpm --version` works in the same terminal, and `pnpm exec visualguard --help` prints help.

## Missing `pg`, `mongodb` or `openid-client` module

The dashboard fails with an error saying a package named `pg`, `mongodb` or `openid-client` cannot be found.

- **Likely cause:** these are optional dependencies used for PostgreSQL, MongoDB and Google or OIDC sign-in. They were skipped, for example by installing with optional dependencies turned off.
- **Fix:** reinstall `visualguard` with optional dependencies enabled, then restart the dashboard with the same database settings.
- **Confirm:** the dashboard starts and `/api/health` responds on its address.

## Config file not found

You see `No visualguard.config.ts found and no URLs given.` or `Config file not found: PATH`.

- **Likely cause:** you are in the wrong folder, or the file has a name VisualGuard does not look for. It finds `visualguard.config.ts`, `.mts`, `.js`, `.mjs` and `.cjs` automatically. Other names, including JSON files, need `--config`.
- **Fix:** run from the app root, create a config with `npx --no-install visualguard init`, or point to the file:

  ```bash
  npx --no-install visualguard test --config path/to/visualguard.config.ts --list
  ```

- **Confirm:** `test --list` prints the planned production and staging URL pairs without capturing.

## Troubleshooting other stages

If installation now works but captures fail, continue with [capture and report problems](/troubleshooting/capture/). You do not need an AI key or a database for the first local comparison.

## Next steps

- [Repeat the installation steps](/start/install/) once you know which prerequisite was missing.
- [Run the quickstart](/start/quickstart/) to confirm a full comparison works.
- [Check compatibility](/reference/compatibility/) for supported Node, Playwright and browser versions.
