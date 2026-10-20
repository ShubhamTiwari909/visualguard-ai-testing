---
title: "Capture authenticated application pages"
description: "Save a logged-in browser session with the auth command, send extra headers, and prepare pages with beforeNavigate and beforeCapture hooks."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/cli/commands/auth.ts", "packages/visualguard/src/capture/browser.ts", "packages/visualguard/src/capture/capture.ts", "packages/visualguard/src/config/schema.ts", "packages/visualguard/src/cli/commands/doctor.ts"]
sidebar: {"order": 8}
---

This page shows how to capture pages that sit behind a login, a password-protected preview or a feature flag. You log in once in a real browser window, VisualGuard saves that session to a file, and every later capture starts already logged in. You can also send extra request headers and run your own code before each page loads or before each screenshot.

Use it when your screenshots show a login form instead of the page you wanted to test.

## Before you start

- Finish [Run your first visual test](/start/quickstart/) so you have a working `visualguard.config.ts` with `baseURL.production` and `baseURL.staging`.
- Have a test account for each environment. Use accounts with stable, predictable data, not a real customer account.
- Run the `auth` command on a machine with a screen: it opens a visible browser window.
- Run commands from your app's root folder, where `visualguard.config.ts` lives.

These settings are for your application's own login. They are separate from signing in to the VisualGuard [dashboard](/dashboard/overview/).

## Three tools

| Tool | Use it for |
| --- | --- |
| `environments.<env>.storageState` | Start every capture with saved cookies and local storage, so pages load logged in. Create the file with `visualguard auth`. |
| `environments.<env>.headers` | Send extra HTTP headers, such as a preview-protection bypass token or a basic-auth header. |
| `hooks.beforeNavigate` and `hooks.beforeCapture` | Run your own Playwright code before the page loads, or just before the screenshot. |

Each environment (`production` and `staging`) has its own settings, so the two sides can use different accounts and tokens.

## 1. Save a logged-in session

Run `auth` with the environment name:

```bash
npx --no-install visualguard auth staging
```

A browser window opens at `baseURL.staging`. The terminal shows `Log in in the browser window, then press Enter here to save the session.`

1. Log in in the window as you normally would, including any two-factor step.
2. Wait until you see the logged-in page.
3. Press **Enter** in the terminal.

You should see:

```text
✓ Saved the staging session to .visualguard/auth/staging.json

Use it in visualguard.config.ts:

  environments: { staging: { storageState: ".visualguard/auth/staging.json" } },

Keep this file out of git: it contains your login cookies.
```

Repeat for production:

```bash
npx --no-install visualguard auth production
```

### auth flags

| Flag | What it does | Default |
| --- | --- | --- |
| `<env>` | `production` or `staging`. | Required |
| `--url <url>` | Page to open first, such as your login page. | The environment's base URL |
| `--out <path>` | Where to save the session file. | `.visualguard/auth/<env>.json` |
| `--until-url <glob>` | Save automatically when the page URL matches this glob, instead of waiting for Enter. Waits up to 10 minutes. | Off |
| `-c, --config <path>` | Config file path. | `visualguard.config.ts` |

For example, to start on the login page and save as soon as you reach the dashboard:

```bash
npx --no-install visualguard auth staging --url https://staging.example.com/login --until-url '**/dashboard'
```

The window uses the browser engine from `browser.name` (Chromium by default). If you close the window before saving, `auth` stops with `The browser was closed before the session was saved.`

## 2. Use the session in your config

Add an `environments` block to your existing `defineConfig({ ... })`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing baseURL, routes and viewports
  environments: {
    production: { storageState: ".visualguard/auth/production.json" },
    staging: { storageState: ".visualguard/auth/staging.json" },
  },
});
```

The path is relative to your app's root folder. If the file does not exist, the capture stops with `storageState file for staging not found: …`.

Now run a test:

```bash
npx --no-install visualguard test
```

You should see the logged-in pages in the report, not a login form.

:::caution
A session file contains your login cookies. Anyone with the file can act as that account until the session expires. Keep it out of Git: `.visualguard/` should be in your `.gitignore` (`doctor` warns when it is not). If you save it elsewhere with `--out`, ignore that path too.
:::

## 3. Send extra headers (optional)

Use `headers` for protected preview deployments or simple gateways. Read secrets from environment variables, never write them in the config:

```ts
environments: {
  production: { storageState: ".visualguard/auth/production.json" },
  staging: {
    storageState: ".visualguard/auth/staging.json",
    headers: {
      "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET ?? "",
    },
  },
},
```

VisualGuard loads `.env` and `.env.local` before it reads your config, so `process.env` sees values from those files. A header whose value is an empty string is not sent, so the `?? ""` pattern above is safe when the variable is missing. `doctor` also sends these headers when it checks that each URL responds.

:::caution
The browser sends these headers with **every** request the page makes, including requests to other sites such as analytics or font hosts. To send a secret only to your own host, add it in a `beforeNavigate` hook with `page.route` instead (see the example in step 4).
:::

## 4. Prepare pages with hooks (optional)

Hooks are async functions in your config. VisualGuard calls them for every page, on both environments, with one argument:

| Field | What it is |
| --- | --- |
| `page` | The Playwright [`Page`](https://playwright.dev/docs/api/class-page). |
| `env` | `"production"` or `"staging"`. |
| `route` | The route being captured, such as `/account`. |
| `url` | The full URL that will be (or was) opened. |
| `viewport` | The viewport name, such as `desktop`. |

When each hook runs:

| Hook | Runs | Good for |
| --- | --- | --- |
| `beforeNavigate` | After the browser context is ready, before the page opens. | Adding cookies, routing or blocking requests, `addInitScript` (feature flags, test mode). |
| `beforeCapture` | After the page loaded, fonts and images are ready and the network is quiet. Before media is paused and the screenshot is taken. | Closing a dialog, expanding a section, scrolling to the top, waiting for your own condition. |

Example: turn on a feature flag, send a token only to your own host, and close a welcome dialog:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing settings
  hooks: {
    beforeNavigate: async ({ page, env }) => {
      await page.addInitScript(() => {
        localStorage.setItem("feature:new-nav", "on");
      });
      if (env === "staging") {
        await page.route("https://staging.example.com/**", (route) =>
          route.continue({
            headers: { ...route.request().headers(), "x-preview-token": process.env.PREVIEW_TOKEN ?? "" },
          }),
        );
      }
    },
    beforeCapture: async ({ page }) => {
      const close = page.getByRole("button", { name: "Dismiss" });
      if (await close.isVisible()) await close.click();
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  },
});
```

Things to know about hooks:

- **They can run more than once per page.** Retries, the noise check (a second load of a page that differs) and fix verification all capture again. Write hooks that are safe to repeat.
- **They run in Node.js.** Code inside `page.evaluate` or `addInitScript` runs in the browser and cannot see your config's variables unless you pass them in.
- **An error in a hook fails that capture**, and the page shows an error status in the report.
- **They are not part of dashboard profiles.** The dashboard stores no hooks, cookies or session files. Use `visualguard.config.ts` for logged-in testing. See [Project configuration](/dashboard/project-configuration/).

## Use sessions in CI

`auth` needs a screen, so create session files on your own machine. In CI, store the file's contents as a secret and write it to disk before the test:

```bash
mkdir -p .visualguard/auth
printf '%s' "$STAGING_STORAGE_STATE" > .visualguard/auth/staging.json
printf '%s' "$PRODUCTION_STORAGE_STATE" > .visualguard/auth/production.json
npx --no-install visualguard test
```

Sessions expire. When captures start showing the login page again, run `auth` again and update the secret. A dedicated test account with a long session lifetime helps.

## Example: a logged-in account page

Your `/account` page needs a login on both production and staging, and staging is a Vercel preview with deployment protection. You run `visualguard auth production` and `visualguard auth staging --until-url '**/account'`, add both `storageState` paths, and add the `x-vercel-protection-bypass` header for staging from `VERCEL_BYPASS_SECRET` in `.env.local`. A `beforeCapture` hook closes the cookie-settings dialog. The next `test` shows both account pages with the same test user's name and no login form.

## Verify you are capturing the logged-in page

1. Run `npx --no-install visualguard doctor`. Both URL lines should show an HTTP status below 400.
2. Run `npx --no-install visualguard test --only /account` (use one of your protected routes).
3. Open the report. Both screenshots should show the logged-in page. In **Page health**, the HTTP status should not be 401 or 403.
4. Check `git status` does not list any session file.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Screenshots show the login page | The session expired or belongs to another host. Run `auth` again for that environment. |
| `storageState file for staging not found` | Check the path in `environments.staging.storageState`. It is relative to your app's root folder. |
| `No URL for staging: set baseURL.staging or pass --url.` | Set `baseURL.staging`, or pass `--url` to `auth`. |
| `auth` waits forever | Press Enter in the terminal after logging in, or check the `--until-url` glob matches the final URL. |
| Production and staging show different users | Each side uses its own session. Log in with matching test accounts. |
| HTTP 401 or 403 on a preview deployment | The bypass header is missing or empty. Check the environment variable is set where the test runs. |
| A dialog appears in some screenshots only | Close it in `beforeCapture`, or hide it with `stabilize.hide`. See [Stable captures](/guides/stable-captures/). |

See [Capture problems](/troubleshooting/capture/) for more.

## Next steps

- [Stable captures](/guides/stable-captures/): hide, mask and wait for content that changes between loads.
- [Routes](/guides/routes/): per-environment paths and `waitFor` selectors.
- [Preview deployments in CI](/ci/preview-deployments/): test each pull request's preview URL.
- [Configuration reference](/reference/configuration/): every `environments` and `hooks` option.
