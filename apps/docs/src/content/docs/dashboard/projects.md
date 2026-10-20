---
title: "Projects, names and identities"
description: "Create, select, rename and delete dashboard projects and runs, and find a project or run that seems to be missing."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "apps/platform/server/project-command.ts", "apps/platform/server/project-directory.ts", "apps/platform/client/naming.tsx", "apps/platform/client/delete-action.tsx"]
sidebar: {"order": 4}
---

A project is the home for one application's test history, settings and access. This page shows how to create a project, choose it, rename it, and delete runs or whole projects safely. It also explains what to check when a project or run seems to be missing.

## Before you start

- Have a running dashboard. If you do not, follow [Start a local dashboard](/dashboard/local/).
- To create projects, be a workspace administrator. In local mode you are the Local owner, which counts as an administrator.
- To rename or delete, be a Maintainer of the project or a workspace administrator.
- Run CLI commands from your app's root folder. Examples use macOS or Linux shells; on Windows use WSL.

## How a project is identified

A project has three names. Each has a different job.

| Identifier | Example | Who uses it | Can it change? |
| --- | --- | --- | --- |
| Project ID | `storefront` | The CLI, CI, URLs and runner commands | Yes. Old IDs keep working as aliases |
| Display name | `Storefront Web` | People, in the sidebar and lists | Yes, at any time |
| Internal key | Hidden | The database | Never |

Project ID rules: 1 to 63 characters, lowercase letters, numbers and hyphens, starting with a letter or number. Display names have 1 to 120 characters.

The CLI also accepts an exact display name, such as `visualguard test "Storefront Web"`. That only works when exactly one project has that name. If two projects share it, you get `More than one project has that name; use the project ID instead`.

## 1. Create a project

Choose the way that matches your setup.

**From the browser.** On **Run history**, choose **+ New project**. Enter a **Project name** and a **Project ID**, then choose **Create project**. Only workspace administrators see this button.

**From the CLI, on a local dashboard.** In local mode, no sign-in is needed:

```bash
npx --no-install visualguard dashboard project create storefront \
  --name "Storefront Web" --server http://127.0.0.1:4400
```

You should see `Created: Storefront Web (storefront)`. Running it again prints `Already exists: ...` and changes nothing. History is never reset.

**From the CLI, on a login dashboard.** Project creation needs an administrator's email and password. Upload tokens cannot create projects. Put the credentials in a private file, such as `.env.dashboard-admin`, and add it to `.gitignore`:

```dotenv
VISUALGUARD_DASHBOARD_URL=https://visual.example.com
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='the administrator password'
```

```bash
npx --no-install visualguard dashboard --env-file .env.dashboard-admin \
  project create storefront --name "Storefront Web"
```

Remote dashboards must use HTTPS. An administrator who only signs in with Google creates projects in the browser instead.

| Option | What it does | Default |
| --- | --- | --- |
| `<id>` | The project ID to create | Required |
| `--name <name>` | Display name | The ID |
| `--server <url>` | Dashboard to create the project in | `VISUALGUARD_DASHBOARD_URL`; if unset, the local storage selected by your settings |

:::caution
Without `--server` or `VISUALGUARD_DASHBOARD_URL`, `project create` writes directly to local storage chosen from the current folder and settings. That may not be the storage your running dashboard uses. Pass `--server` when a dashboard is running.
:::

## 2. Select a project

You select a project before you configure tests, run a test or delete it.

- Choose it under **PROJECTS** in the sidebar, or
- On **Run history**, pick it in the **Project** filter and choose **Apply filters**.

You should see the **PROJECT** panel with its name, ID and stored run count. Each project keeps its own test settings, members and credentials. Changing one project never changes another.

## 3. Rename a project or change its ID

1. Open **People & integrations** and find **Project access**.
2. Pick the project in **Project**, then choose **Edit project name & ID**.
3. Change **Project name**, **Project ID** or both, then choose **Save project details**.

You should see `Project details saved. Old IDs still work.` Existing runs, links and upload tokens stay connected. A project can hold up to 1000 old IDs.

If someone else changed the project first, you see `Project details changed; refresh before saving again`. Refresh the page and try again.

## 4. Rename a run

Runs get a default label such as **Run #12**. To give one a clearer name:

1. Open the run from **Run history**.
2. Choose **Edit run name**, type a **Run name** (up to 120 characters) and choose **Save run name**.

You should see **Run name saved.** To go back to the default label, clear the field and save. Renaming changes only the label, never the stored evidence.

## 5. Delete a run

1. Open the run and choose **Delete run**.
2. Type `DELETE` and choose **Permanently delete run**.

The run disappears from project history. Screenshots shared with other runs stay. Your original local test output is kept. There is no undo.

A run that an approved baseline was promoted from cannot be deleted on its own. You see `This run is retained by approved baseline history`. Delete the whole project to remove that history.

## 6. Delete a project

Deleting a project is for retiring an app, not for fixing a filter that shows nothing.

1. Take a backup first; see [Storage and backups](/deployment/storage-and-backups/).
2. Select the project and choose **Delete project** in its **PROJECT** panel.
3. Read the summary. It names how many stored runs will go.
4. Type the project ID, such as `storefront`, and choose **Permanently delete project**.

This removes the project's runs, saved test settings, active test request, memberships, upload tokens, runner credentials and upload sessions. Screenshots still used by other projects stay. The project ID and its old aliases stay reserved forever, so an old token can never reach a new project. Use a new ID for a future project.

If a run arrived while the dialog was open, the count no longer matches and deletion stops. Cancel, refresh the page and confirm again.

Deletion does not remove copies on runner machines or in your own backups.

## Find a project or run that seems missing

Most "missing" data was written to a different workspace. Each process picks its storage from its own settings:

| Command | Where it reads settings | Where the data goes |
| --- | --- | --- |
| `test PROJECT` (no dashboard URL) | Your shell, plus `.env` and `.env.local` | The local storage those settings select |
| `test PROJECT --dashboard URL` | Your shell, plus `.env` and `.env.local` | The dashboard at that URL, whatever database it uses |
| `dashboard --env-file .env.visualguard` | That file, after your shell | The database the file selects |
| `dashboard` without `--env-file` | Only your shell | Defaults. It does not read `.env.visualguard` or `.env.local` |

Local SQLite storage also depends on the folder you start from. Use the same app root folder and one running dashboard.

To check a MongoDB or PostgreSQL workspace, stop the old dashboard and start the right one in terminal A:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

In terminal B, test against that exact server:

```bash
npx --no-install visualguard test "My Application" \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

If the name does not exist in that dashboard yet, create the project with an ID first, then use the ID:

```bash
npx --no-install visualguard dashboard project create my-app \
  --name "My Application" --server http://127.0.0.1:4400
npx --no-install visualguard test my-app \
  --dashboard http://127.0.0.1:4400 --config visualguard.config.ts --no-ai
```

To recover an earlier run without capturing again, find its folder in the earlier test output (by default `.visualguard/runs/RUN_ID`). Then upload it:

```bash
npx --no-install visualguard dashboard publish .visualguard/runs/RUN_ID \
  --project my-app --server http://127.0.0.1:4400
```

Replace `RUN_ID` with the real folder that holds `manifest.json`. Pointing a new dashboard at MongoDB does not move runs from an earlier SQLite workspace. These examples assume local mode; a login dashboard also needs the project's upload token, as in [Publish and retry saved evidence](/dashboard/publishing/).

## Verify the result

- Create two projects, save different test settings in each and confirm they stay separate.
- Rename a project ID, then run a CLI command with the old ID. It should still reach the same project.
- Open **Run history** filtered by the project and check the run count matches the sidebar.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Administrator access required to create projects` | Sign in as a workspace administrator, or ask one to create the project |
| `Project creation requires an administrator login` | Set `VISUALGUARD_ADMIN_EMAIL` and `VISUALGUARD_ADMIN_PASSWORD` in the `--env-file` you pass to `project create` |
| `This project ID was deleted and cannot be reused` | Deleted IDs stay reserved. Pick a new ID |
| `This project ID belongs to another project` | That ID is in use or is an alias of another project. Pick a different ID |
| `More than one project has that name; use the project ID instead` | Use the project ID in the CLI instead of the display name |
| `Project run count changed; refresh and confirm deletion again` | A run arrived or was removed while you confirmed. Cancel, refresh and confirm the new count |
| `This run is retained by approved baseline history` | A baseline was promoted from this run. Keep it, or delete the whole project |

More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Publish and retry saved evidence](/dashboard/publishing/): send runs to the project from CI.
- [Configure tests per project](/dashboard/project-configuration/): save the project's test profile.
- [Invite people and manage permissions](/dashboard/people-and-permissions/): give people access to the project.
