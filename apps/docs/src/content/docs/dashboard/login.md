---
title: "Enable dashboard login"
description: "Switch a dashboard from local mode to login mode, set its exact public address and create the first administrator."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "docs/NPM-PACKAGE-SETUP.md",
    "apps/platform/server/auth.ts",
    "apps/platform/server/runtime.ts",
    "apps/platform/client/auth.tsx",
    "apps/platform/client/settings.tsx",
  ]
sidebar: { "order": 10 }
---

Login mode turns a personal dashboard into a team workspace. People sign in with their own accounts, and every action is tied to a person. This tutorial switches a local dashboard to login mode on your computer and creates the first administrator. The same settings apply to a hosted dashboard.

## Before you start

- Finish [Start a local dashboard](/dashboard/local/) and stop the running dashboard with Ctrl+C.
- Choose a storage. For invitations and account management you need SQLite, PostgreSQL or a MongoDB replica set. See [Storage and backups](/deployment/storage-and-backups/).
- For a trial, use a fresh data folder or database instead of your live data.
- Pick a unique administrator password of 12 to 256 characters.

Examples use macOS or Linux shells; on Windows use WSL.

## 1. Add the login settings

Edit the ignored `.env.visualguard` file. Keep your database setting (an empty `VISUALGUARD_DATABASE_URL=` for SQLite), and set:

```dotenv
VISUALGUARD_AUTH_MODE=login
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400
VISUALGUARD_ADMIN_EMAIL=owner@example.com
VISUALGUARD_ADMIN_PASSWORD='YOUR_UNIQUE_12_TO_256_CHARACTER_PASSWORD'
VISUALGUARD_USER_ADMISSION=invite
```

| Setting                      | What it does                                                                                                     | Default                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `VISUALGUARD_AUTH_MODE`      | `local` or `login`                                                                                               | `login` when a public URL is set or on Cloud Run or Vercel; otherwise `local` |
| `VISUALGUARD_PUBLIC_URL`     | The exact address people open, with no path. Must be `https://` unless it is `localhost`, `127.0.0.1` or `[::1]` | Not set. Required in login mode                                               |
| `VISUALGUARD_ADMIN_EMAIL`    | Email of the first administrator                                                                                 | Not set                                                                       |
| `VISUALGUARD_ADMIN_PASSWORD` | Password of the first administrator, 12 to 256 characters                                                        | Not set                                                                       |
| `VISUALGUARD_USER_ADMISSION` | `invite`: new people join only with an invitation. `legacy`: a company login can create accounts automatically   | `invite` on a new installation                                                |

The dashboard accepts requests only at the exact public address. Opening it by another name, such as `localhost` instead of `127.0.0.1`, returns `Use the configured dashboard URL`.

:::caution
An existing installation that already has accounts must set `VISUALGUARD_USER_ADMISSION` to `invite` or `legacy` explicitly before upgrading. The dashboard refuses to start otherwise. Back up first and upgrade every dashboard instance together.
:::

## 2. Restart the dashboard

When a public URL is set, the dashboard listens on all network addresses by default. For a trial on your computer, keep it on this machine with `--host`:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard --host 127.0.0.1 --port 4400
```

You should see `VisualGuard dashboard: http://127.0.0.1:4400`.

On first start, the dashboard creates the administrator account, named **Workspace administrator**, from the email and password. This happens only once. Changing these settings later does not change or reset that account.

## 3. Sign in

Open exactly `http://127.0.0.1:4400`.

You should see **Welcome to your workspace** with **Email** and **Password** fields. With `invite` admission it also says: "Joining for the first time? Ask your administrator for an invitation link."

Enter the administrator email and password and choose **Sign in**. You should see **Run history**, your name in the top bar, a **Sign out** button and **Audit & recovery** in the sidebar.

Ten failed attempts for an account lock sign-in for ten minutes: `Too many login attempts; try again in ten minutes`.

## 4. Check your profile

Choose **Profile** in the top bar. **Your profile** shows your **Name**, **Email** and **Workspace role**: **Workspace administrator**.

To change your password, use **Your password** on the same page: enter the **Current password** and a **New password**, then choose **Change password**. You should see "Password changed. Other sessions have been revoked."

## 5. Create an upload token for the CLI

In login mode, the CLI needs a project upload token, even on `127.0.0.1`. Your dashboard password is not used for uploads.

Create one under **People & integrations** → **Project access** → **Upload credentials**, then follow [Publish and retry saved evidence](/dashboard/publishing/).

## Dashboard login and app login are different

| Kind of login     | What it protects                                 | Where it is set up                                                        |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| Dashboard account | Who can see and change stored evidence           | This page, and [People & permissions](/dashboard/people-and-permissions/) |
| Upload token      | Which project a CLI or CI job can send runs to   | [Publishing](/dashboard/publishing/)                                      |
| App login state   | Lets the capturer open private pages in your app | [Test pages behind a login](/guides/application-auth/)                    |

An upload token is neither a dashboard password nor an app session.

## Keep a way back in

- Changing `VISUALGUARD_ADMIN_PASSWORD` later does not reset the administrator. It is used only once.
- Never edit password rows in the database by hand.
- Keep at least one tested password administrator before you add Google-only accounts. The dashboard protects the last active administrator from being disabled or demoted.
- If every administrator is locked out, an operator can restore a password administrator from the dashboard host. **Audit & recovery** → **Administrator recovery** lists the steps; see [Operations and recovery](/deployment/operations-and-recovery/).

## Verify the setup

- Sign in at the exact public address works, and **Your profile** shows **Workspace administrator**.
- After **Sign out**, opening any page shows the sign-in screen, not your runs.
- A CLI upload without `VISUALGUARD_UPLOAD_TOKEN` fails with `Set VISUALGUARD_UPLOAD_TOKEN for a dashboard requiring login`.

## Troubleshooting

| Problem                                                                                                       | Fix                                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Hosted login requires VISUALGUARD_PUBLIC_URL`                                                                | Set the public URL in the same file you pass with `--env-file`                             |
| `Hosted login requires HTTPS`                                                                                 | Use an `https://` public URL. Plain HTTP works only on `localhost`, `127.0.0.1` or `[::1]` |
| `VISUALGUARD_PUBLIC_URL must be an HTTP(S) origin without a path`                                             | Remove any path, query or trailing segment, such as `/dashboard`                           |
| `Configure VISUALGUARD_ADMIN_EMAIL and VISUALGUARD_ADMIN_PASSWORD (12+ characters), or an OIDC administrator` | No administrator exists yet. Set both values and restart                                   |
| `Use the configured dashboard URL`                                                                            | Open the dashboard at exactly the public URL                                               |
| `Email or password is incorrect`                                                                              | Check the account. Remember the bootstrap password is used only on first start             |
| `Existing installation: set VISUALGUARD_USER_ADMISSION=invite or legacy explicitly before upgrading`          | Choose `invite` or `legacy`, back up and restart                                           |

More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Configure and link Google sign-in](/dashboard/google-sign-in/): let people sign in with Google.
- [Invite people and manage permissions](/dashboard/people-and-permissions/): add your team.
- [Deployment overview](/deployment/overview/): host the dashboard for your team.
