---
title: "Run your first visual test"
description: "Run a complete local comparison from scratch, without AI, accounts or a database, then read the saved report."
audience: "developer"
docType: "tutorial"
channel: "published"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "packages/visualguard/src/cli/commands/test.ts",
    "packages/visualguard/src/cli/commands/report.ts",
    "scripts/docs/smoke-quickstart.mjs",
  ]
sidebar: { "order": 5 }
---

In this tutorial you run a full visual comparison on your own computer. You start two tiny demo pages that differ only in a button colour. VisualGuard captures both, finds the difference and writes an HTML report. You need no AI key, account, dashboard or database.

## What you will build

- Two local web pages: a **reference** on port 4100 and a **candidate** on port 4101. The reference is what the page should look like. The candidate is the version you are checking.
- One config file, `visualguard.config.ts`.
- One saved run with screenshots, a difference image and an HTML report.

Afterwards you can swap the demo URLs for your own app.

## Before you start

- Node.js **22.12** or newer. Check with `node --version`. See [requirements](/start/requirements/).
- A project folder. Use your app's root folder, or make an empty folder and run `npm init -y` in it.
- Two terminals open in that same folder. This page calls them **terminal A** and **terminal B**.

Each command below is a single line, so it also works in Windows PowerShell. The JavaScript and config files work on every system.

## 1. Install VisualGuard and a browser

In terminal B, at your project's root, install the current package, Playwright and the Chromium browser:

```sh
npm install --save-dev --save-exact visualguard@latest
npm install --save-dev playwright
npx playwright install chromium
npx --no-install visualguard --version
```

You should see npm finish without errors, Playwright download Chromium, and a version number printed last.

- On Linux, run `npx playwright install --with-deps chromium` instead of the third line. It adds the system libraries Chromium needs.
- If your app already has Playwright 1.45 or newer, keep it. Do not create a second lockfile.
- With pnpm, run `pnpm add -D -E visualguard@latest`, `pnpm add -D playwright` and `pnpm exec playwright install chromium`. Then use `pnpm exec visualguard` wherever this page says `npx --no-install visualguard`.

### Check the installed release

Check the installed package version independently of the CLI label:

```sh
npm ls visualguard --depth=0
```

You should see the concrete version npm resolved, rather than the word `latest`. `--save-exact` records that version in `package.json`; commit the lockfile so teammates and CI use the same build. With pnpm, run `pnpm list visualguard --depth=0`. If the CLI label differs, include both values in bug reports. See [release availability](/releases/).

## 2. Start two versions of a page

VisualGuard compares two running sites. This step starts two small demo pages. If you already have two running versions of your own app, skip this step and use their URLs in step 3.

Create a file called `demo-sites.mjs` at your project's root with exactly this content:

```js
import { createServer } from "node:http";

for (const [port, color] of [
  [4100, "#146c43"],
  [4101, "#b42318"],
]) {
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html lang="en"><head>
      <meta charset="utf-8"><title>Storefront demo</title>
      <style>body{font:20px system-ui;padding:64px}button{background:${color};color:white;padding:16px 24px;border:0;border-radius:8px}</style>
      </head><body><h1>Storefront</h1><p>Your order is ready.</p>
      <button>Continue to checkout</button></body></html>`);
  }).listen(port, "127.0.0.1", () => console.log(`Demo: http://127.0.0.1:${port}`));
}
```

The reference page (port 4100) has a green button. The candidate page (port 4101) has a red one. Everything else is the same.

In **terminal A**, at your project's root, start both pages:

```sh
node demo-sites.mjs
```

You should see two lines:

```text
Demo: http://127.0.0.1:4100
Demo: http://127.0.0.1:4101
```

Leave terminal A running. Open both URLs in your browser. The button should be green on one and red on the other.

:::tip
If a port is already in use, stop the other program, or change the port here and in the config in step 3. These are app servers, not dashboard servers.
:::

## 3. Create the config file

The config tells VisualGuard which two sites to compare, which pages and which screen size. In terminal B, create `visualguard.config.ts` at your project's root with exactly this content:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "http://127.0.0.1:4100",
    staging: "http://127.0.0.1:4101",
  },
  routes: ["/"],
  viewports: { desktop: { width: 1280, height: 800 } },
  ai: { provider: "none" },
  output: { dir: ".visualguard" },
});
```

| Field                | Meaning in this demo                      |
| -------------------- | ----------------------------------------- |
| `baseURL.production` | The reference site (green button).        |
| `baseURL.staging`    | The candidate site (red button).          |
| `routes`             | Test only the home page, `/`.             |
| `viewports`          | One desktop screen, 1280 by 800 pixels.   |
| `ai.provider`        | `'none'`: use only the built-in analysis. |
| `output.dir`         | Save runs under `.visualguard/`.          |

Notes:

- If you skipped step 2, put your own two URLs in `baseURL`.
- If you already ran `visualguard init`, edit its file instead of creating a second one.
- The `.ts` file works in JavaScript projects too. No TypeScript build is needed.
- Add `.visualguard/`, `.env.local` and any saved login files to `.gitignore`.

[Install VisualGuard](/start/install/) explains the interactive `init` wizard if you prefer it.

## 4. Check, list and compare

Run these three commands in terminal B, one at a time.

First, `doctor` checks that everything is ready:

```sh
npx --no-install visualguard doctor --config visualguard.config.ts
```

You should see a check mark next to Node.js, Playwright, the browser and both URLs, and `Ready.` at the end.

Next, `--list` shows what will be tested without taking screenshots:

```sh
npx --no-install visualguard test --config visualguard.config.ts --list
```

You should see both URLs, `desktop` as the viewport, a line that maps `/` to `/`, and `1 job (1 route × 1 viewport)`.

Now run the comparison. `--no-ai` makes sure no AI service is called:

```sh
npx --no-install visualguard test --config visualguard.config.ts --no-ai
```

You should see VisualGuard capture both pages and print a summary. The home page gets the status **review** or **regression**, because the button colour changed.

:::note[A failing exit code here is expected]
The command may exit with code `1`. That means "a visual change was found", which is the right answer for this demo. It is not an install problem. Exit code `2` means a config or command mistake, and `3` means an environment problem such as a missing browser. See [exit codes](/reference/exit-codes/).
:::

## 5. Open the report

The report shows the two screenshots side by side, the difference image and the findings:

```sh
npx --no-install visualguard report --config visualguard.config.ts
```

You should see `VisualGuard report · run #1`, a `Local` URL and a `File` path. Your browser opens the report. If it does not, open the `Local` URL yourself.

In the report:

1. Select the `/` desktop job.
2. Switch between the **Side by side**, **Slider**, **Onion skin** and **Diff** views (keys `1` to `4`). The diff highlights the button.
3. Read the findings. They describe the changed element and its style change.

The report server keeps running. Press Ctrl+C in terminal B to stop it before you reuse that terminal.

| `report` option | What it does                                            | Default            |
| --------------- | ------------------------------------------------------- | ------------------ |
| `--run RUN_ID`  | Open a specific run                                     | The latest run     |
| `--no-serve`    | Write `index.html` and print its path, without a server | Starts a server    |
| `--no-open`     | Do not open a browser                                   | Opens a browser    |
| `--port N`      | Serve on this port                                      | A random free port |

### Where the files are

Each run is saved in its own folder: `.visualguard/runs/RUN_ID/`. It holds `manifest.json` (the full record), the screenshots, the diff images and `index.html`. The HTML file refers to the image files, so share the whole folder, not just `index.html`. See [run artifacts](/reference/artifacts/).

## Verify the setup

Check each item:

- Both demo URLs load, and the button colours differ.
- `doctor` ends with `Ready.`, and `--list` shows one job for `/` at `desktop`.
- `.visualguard/runs/` contains a run folder with screenshots, `manifest.json` and `index.html`.
- The report shows the `/` job as **review** or **regression**.

Then prove the comparison can also pass:

1. In `demo-sites.mjs`, change `'#b42318'` to `'#146c43'` so both buttons are green.
2. In terminal A, press Ctrl+C, then run `node demo-sites.mjs` again.
3. Make sure the report server in terminal B is stopped.
4. Run `npx --no-install visualguard test --config visualguard.config.ts --no-ai` again.

You should see a new run with the status **pass** and exit code `0`. Open its report to confirm it, rather than assuming it passed.

## Troubleshooting

| Problem                                                    | Fix                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `connect ECONNREFUSED` or doctor cannot reach a URL        | Start terminal A. Check the ports. Use the same host spelling as the config (`127.0.0.1`, not `localhost`).          |
| `Executable doesn't exist` or the browser is missing       | Run `npx playwright install chromium` again from this folder. On Linux add `--with-deps`.                            |
| The run shows **pass** when you expected a change          | Check the two URLs in the config and the second colour in `demo-sites.mjs`. Restart terminal A after any edit.       |
| The run still shows a change after you matched the colours | You did not restart terminal A, so the old page is still served.                                                     |
| `report` cannot find a run                                 | Use the same `--config` (and so the same output folder) as `test`. Read the test's error first if it did not finish. |
| Exit code `2`                                              | A config or command mistake. Read the message; it names the field or option.                                         |
| `EADDRINUSE` when starting the demo                        | Another program uses port 4100 or 4101. Stop it, or change both ports in the demo and the config.                    |

More fixes: [capture and report problems](/troubleshooting/capture/).

## Next steps

- [Select routes](/guides/routes/): test the pages that matter in your real app.
- [Make captures repeatable](/guides/stable-captures/): remove noise from animations and dates.
- [Run visual tests in CI](/ci/overview/): get a report on every pull request.
- [Start a local dashboard](/dashboard/local/): keep run history and review results in a browser.

### Clean up

Press Ctrl+C in each terminal to stop the demo and report servers. Your runs stay in `.visualguard/`. If you used a throwaway folder, save any evidence you want before you delete it.
