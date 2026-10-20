---
title: "Configure tests per project"
description: "Save a project's test profile in the dashboard: URLs, routes, viewports and AI provider, with versioning and the limits of what it can hold."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/project-tests.ts", "apps/platform/client/project-tests.tsx"]
sidebar: {"order": 6}
---

Each dashboard project can save a test profile: the two URLs to compare, the routes, the viewports and an optional AI provider. **Run test** uses this saved profile. This page shows how to fill it in, what each field accepts and how versions protect you from overwriting a teammate's change.

## Before you start

- Have a project in a running dashboard. See [Projects, names and identities](/dashboard/projects/).
- Be a Maintainer of the project or a workspace administrator. Viewers and Reviewers can read the saved profile but cannot change it.
- Know the two URLs to compare, and make sure they are reachable from whatever will capture: the dashboard host, or a [private runner](/dashboard/private-runners/).

## 1. Open the project's settings

Choose the project under **PROJECTS** in the sidebar. You can also pick it in the **Project** filter on **Run history** and choose **Apply filters**.

You should see the **PROJECT** panel with a **Visual test** area. If nothing is saved yet, it says **Configure this project's test settings** and the form is already open. Otherwise, choose **Configure tests** to open it.

## 2. Fill in the profile

The form is headed **Project test configuration** and says the values are saved only for this project.

| Field | What it accepts | Default |
| --- | --- | --- |
| **Production / reference URL** | The approved version, as an `http://` or `https://` address. No user name, password, `?query` or `#fragment` | Empty |
| **Staging / candidate URL** | The new version to check, with the same rules | Empty |
| **Routes (one per line)** | 1 to 100 paths, each starting with a single `/`, such as `/` or `/checkout` | `/` |
| **Viewports (JSON)** | 1 to 8 named sizes. Names use letters, numbers, `_` or `-` (up to 40). Width 200 to 3840, height 200 to 2160 | `{"desktop": {"width": 1280, "height": 800}}` |
| **AI provider** | **None**, **Gemini** or **Ollama** | **None** |
| **AI model (optional)** | A model name, shown when the provider is not None | Provider default |

A realistic example for a store with a desktop and a phone size:

```json
{
  "desktop": { "width": 1280, "height": 800 },
  "mobile": { "width": 390, "height": 844 }
}
```

With routes `/`, `/products` and `/checkout`, this profile plans six comparisons: three routes times two viewports.

:::tip
Start with AI provider **None**. Add Gemini or Ollama after the first test works. The AI key or Ollama service must be on the machine that captures, not in this form.
:::

## 3. Save the profile

Choose **Save test configuration**.

You should see the form close and the **Visual test** line show **Configuration v1**. Each later save adds one: v2, v3 and so on. Open **Saved test configuration** to read back the stored values.

While you have unsaved edits, the panel says **Save the configuration before running a test.** and **Run test** is disabled.

## How versions protect your work

Every save records which version you started from.

- If a teammate saved in the meantime, your save stops with `Project configuration changed; refresh before saving`. Refresh the page, review their version and edit again.
- **Run test** sends the version you see. If it is no longer current, you get `Save or refresh this project's configuration before running`.
- A test that already started keeps using the exact copy it started with. Later edits never change a running test.

## Example: two projects, two profiles

| Project | Production / reference URL | Staging / candidate URL |
| --- | --- | --- |
| `storefront` | `https://shop.example.com` | `https://preview-shop.example.com` |
| `docs` | `https://docs.example.com` | `http://127.0.0.1:3001` |

Each project keeps its own values in the dashboard database. Saving one never changes the other.

Note the `docs` staging URL. `127.0.0.1` means "the machine doing the capture". It works when the dashboard runs on your computer, or when a private runner on your computer captures. A hosted dashboard cannot reach your laptop's `127.0.0.1`.

## What the profile does not hold

The profile is plain data, kept small on purpose. It never stores:

- Passwords, API keys, cookies or login state for your app.
- Capture hooks, executable TypeScript or file paths.
- Every other option from `visualguard.config.ts`, such as baseline mode or custom stabilization.

Keep those in `visualguard.config.ts` and use ordinary CLI tests when you need them, for example to [test pages behind a login](/guides/application-auth/). Saving a dashboard profile never edits `visualguard.config.ts` or changes `visualguard test --config ...`.

Dashboard tests always capture with Chromium, one page at a time.

## Verify the result

- The **Visual test** line shows the new configuration version.
- **Saved test configuration** lists the URLs, routes, viewports and AI provider you entered.
- Another project still shows its own, unchanged profile.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Invalid request fields` when saving | A value breaks a rule in the table above. Check that URLs have no `user:pass@`, `?...` or `#...`; that routes look like `/checkout`, not `checkout`, `//checkout` or a full URL; and that there are 1 to 8 viewports within the size limits |
| A JSON error when saving | The viewport box is not valid JSON. Check quotes, commas and braces |
| `Project configuration changed; refresh before saving` | Someone saved first. Refresh, review and save again |
| **Configure tests** is missing | You are a Viewer or Reviewer. Ask a Maintainer or administrator |

More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Run tests from the dashboard](/dashboard/run-tests/): start a test from this profile.
- [Connect a private runner](/dashboard/private-runners/): capture when the dashboard cannot reach your URLs.
- [Configuration](/guides/configuration/): the full set of options for CLI tests.
