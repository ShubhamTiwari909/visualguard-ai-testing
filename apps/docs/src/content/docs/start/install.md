---
title: "Install VisualGuard"
description: "Install the pinned package and a browser in your app, create the config with init, and check that everything is ready."
audience: "developer"
docType: "how-to"
channel: "published"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/cli/commands/init.ts", "packages/visualguard/src/cli/commands/doctor.ts"]
sidebar: {"order": 4}
---

This page adds VisualGuard to the app you want to test and creates its config file. You do not need to clone the VisualGuard repository. If you want a complete runnable example first, follow [the quickstart](/start/quickstart/) instead; it includes a small demo app.

## Before you start

- Meet the [requirements](/start/requirements/): Node.js 22.12 or newer and permission to install a browser.
- Have an app with two versions you can open in a browser. Usually this is production (the **reference**, what the page should look like) and staging or a local dev server (the **candidate**, the version you are checking). See the [glossary](/concepts/glossary/).
- Run every command from your app's root folder, where `package.json` lives.

VisualGuard tests any page a browser can open: React, Next.js, Vue, static HTML and more. It does not need to run on the same machine as your app.

## 1. Install the package and a browser

Pin an exact version so every teammate and CI job runs the same release. Then install Playwright and its Chromium browser.

```bash
cd /path/to/your-app
npm install --save-dev --save-exact visualguard@3.2.3
npm install --save-dev playwright
npx playwright install chromium
```

You should see npm add `visualguard` and `playwright` to `devDependencies`, and Playwright download Chromium.

Notes:

- If your project already has Playwright 1.45 or newer, keep it. Skip the second command.
- On Linux and in CI, use `npx playwright install --with-deps chromium` to add system libraries.
- Keep optional dependencies on. Do not use `--omit=optional`; the dashboard's PostgreSQL, MongoDB and sign-in drivers depend on them.

### Using pnpm instead

If your app uses pnpm, keep pnpm and its lockfile. Do not create a second lockfile.

| Step | npm | pnpm |
| --- | --- | --- |
| Add VisualGuard | `npm install --save-dev --save-exact visualguard@3.2.3` | `pnpm add -D -E visualguard@3.2.3` |
| Add Playwright | `npm install --save-dev playwright` | `pnpm add -D playwright` |
| Install the browser | `npx playwright install chromium` | `pnpm exec playwright install chromium` |
| Run any VisualGuard command | `npx --no-install visualguard ...` | `pnpm exec visualguard ...` |

`npx --no-install` makes sure you run the copy installed in your app, not a different download.

## 2. Ignore local files in Git

VisualGuard writes results and secrets to files that should not be committed. Add these lines to `.gitignore` if they are missing:

```text
.visualguard/
.env.local
.env.visualguard
.env.dashboard-admin
```

`init` adds `.visualguard/` and `.env.local` for you. The other two are for the dashboard.

## 3. Start your app

Start the version you want to check, as you normally would. For example:

```bash
npm run dev
```

Leave it running. Note its URL, such as `http://127.0.0.1:3000`. Your reference version, such as `https://your-app.example.com`, must also be reachable.

## 4. Create the config with init

`init` asks a few questions and writes `visualguard.config.ts`. Run it in a second terminal at your app's root:

```bash
npx --no-install visualguard init
```

The wizard asks for:

| Question | What to enter |
| --- | --- |
| Production URL | Your reference, such as `https://your-app.example.com` |
| Staging / preview URL | Your candidate, such as `http://127.0.0.1:3000` |
| Routes to test | Pick the pages to compare. Start with one or two. |
| Viewports | Pick the screen sizes, such as desktop and mobile. |
| AI provider | Choose **None** for your first run. You can add AI later. |
| GitHub Actions workflow | Decline for now if you only test locally. |

You should see messages such as `Created visualguard.config.ts` and `Added "visual": "visualguard test" to package.json scripts`, then a final hint to run `npx visualguard test`.

### Set up without questions

For scripts or CI, pass the answers as options instead. Use real, reachable URLs:

```bash
npx --no-install visualguard init --yes --production https://your-app.example.com --staging http://127.0.0.1:3000 --ai none
```

Use either the wizard or this command, not both. With `--yes`, init picks the routes it discovers and the desktop and mobile viewports. Review the file before your first test.

| Option | What it does | Default |
| --- | --- | --- |
| `-y`, `--yes` | Accept defaults without asking questions | Off (asks questions) |
| `--production URL` | Reference URL | Asked by the wizard |
| `--staging URL` | Candidate URL | Asked by the wizard |
| `--ai gemini\|ollama\|none` | AI provider written to the config | Asked by the wizard |
| `--workflow` | Also write `.github/workflows/visualguard.yml` | Off |
| `--force` | Overwrite an existing config file | Off (keeps the existing file) |

:::note
These URLs describe your app, not the dashboard. For a fully local comparison, run two app servers on different ports.
:::

## 5. Read the generated config

On a fresh project, `init` creates `visualguard.config.ts`. Keep that name and format; do not rename it to `.json`. VisualGuard loads the TypeScript file directly, even in a JavaScript app, with no build step.

A minimal config in the same format looks like this:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://your-app.example.com",
    staging: "http://127.0.0.1:3000",
  },
  routes: ["/"],
  viewports: {
    desktop: { width: 1280, height: 800 },
  },
  ai: { provider: "none" },
});
```

| Field | What it means |
| --- | --- |
| `baseURL.production` | The reference: what the page should look like. |
| `baseURL.staging` | The candidate: the version you are checking. |
| `routes` | The paths to test on both sites, such as `"/"` or `"/pricing"`. |
| `viewports` | Named screen sizes. Each route is captured once per viewport. |
| `ai.provider` | `"none"`, `"gemini"` or `"ollama"`. `"none"` uses only the built-in analysis. |

Your generated file may have more routes, viewports, comments and stabilisation settings. Edit its values rather than replacing it with this smaller example. See [configure your project](/guides/configuration/) and [configuration fields](/reference/configuration/).

### What init does and does not do

| init can… | init does not… |
| --- | --- |
| Write `visualguard.config.ts` | Create a database |
| Add a `visual` script to `package.json` if missing | Start a dashboard server |
| Add `.visualguard/` and `.env.local` to `.gitignore` | Create a dashboard project |
| Save a Gemini key you type into `.env.local` | Run a test |
| Write a GitHub Actions workflow if you choose it | Overwrite an existing config, unless you pass `--force` |

To turn on AI later, change `ai.provider` in the config, or pass `--provider gemini` or `--provider ollama` to `visualguard test`.

## Check the installed version

Run both commands:

```bash
npx --no-install visualguard --version
npm ls visualguard --depth=0
```

You should see `visualguard@3.2.3` from `npm ls`.

:::caution[Known version label]
The published **3.2.3** package prints **3.2.2** from `visualguard --version`. This is a wrong label inside the package, not a downgrade. Trust `npm ls visualguard --depth=0` (or `pnpm list visualguard --depth=0`). Include both numbers when you report a bug. See [release availability](/releases/).
:::

## Verify the setup

Run doctor. It checks Node.js, Playwright, the browser, your config and both URLs:

```bash
npx --no-install visualguard doctor
```

You should see a check mark on each line and `Ready.` at the end. Also confirm that:

- `visualguard.config.ts` is at your app's root.
- `npx --no-install visualguard test --list` prints your two URLs, your routes and a line such as `2 jobs (1 route × 2 viewports)`.

## Example: a Vue app with a local dev server

A team's Vue app runs in production at `https://shop.example.com`. A developer starts `npm run dev` on `http://127.0.0.1:5173`. They install the package, run `init --yes --production https://shop.example.com --staging http://127.0.0.1:5173 --ai none`, and trim the discovered routes to `/`, `/cart` and `/checkout`. Doctor prints `Ready.`, so they run `npx --no-install visualguard test`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `--version` prints 3.2.2 | Expected for 3.2.3. Confirm with `npm ls visualguard --depth=0`. |
| `npx --no-install` says the command is not found | You are not in your app's root, or the install failed. `cd` to the folder with `package.json` and reinstall. |
| Doctor says the browser is missing | Run `npx playwright install chromium` in the same folder. |
| Doctor cannot reach a URL | Start the app, check the port and the host spelling (`127.0.0.1` vs `localhost`). |
| init kept your old config | It does not overwrite by default. Edit the file, or pass `--force` on purpose. |
| A config error mentions a field | Fix the named field. See [configuration fields](/reference/configuration/). |

More fixes: [installation problems](/troubleshooting/installation/).

## Next steps

- [Run your first visual test](/start/quickstart/): capture, compare and open the report.
- [Configure your project](/guides/configuration/): add routes, viewports and settings.
- [Make captures repeatable](/guides/stable-captures/): reduce noise before you rely on results.
- [Find what you need](/start/common-tasks/): every other task in one table.
