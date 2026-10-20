---
title: "Publish and retry saved evidence"
description: "Send runs from your computer or CI to a dashboard project with an upload token, retry a failed upload, or import a run on the dashboard host."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["docs/NPM-PACKAGE-SETUP.md", "packages/visualguard/src/cli/commands/dashboard.ts", "packages/visualguard/src/cli/commands/test.ts", "apps/platform/server/upload-client.ts", "apps/platform/server/ingest.ts", "apps/platform/client/settings.tsx"]
sidebar: {"order": 5}
---

Publishing sends a run from the machine that captured it to a dashboard project. Use this page to connect the CLI or CI to a dashboard, create the upload token a login dashboard needs, and retry an upload that failed without capturing again.

## Before you start

- Have a running dashboard and a project in it. See [Start a local dashboard](/dashboard/local/) and [Projects, names and identities](/dashboard/projects/).
- For a login dashboard, be a Maintainer of the project or a workspace administrator, so you can create an upload token.
- The machine that captures needs network access to both app versions and to the dashboard.
- Run commands from your app's root folder. Examples use macOS or Linux shells; on Windows use WSL.

## Choose how to send a run

| Method | Command | When to use it |
| --- | --- | --- |
| Capture and publish | `visualguard test PROJECT --dashboard URL` | Everyday use on your computer or in CI |
| Publish a saved run | `visualguard dashboard publish RUN_DIR --project ID --server URL` | Retry after a failed upload, or send an older run |
| Import on the host | `visualguard dashboard import RUN_DIR --project ID` | You are on the dashboard machine and can open its storage directly |

`--dashboard` and `--server` only connect to a dashboard that is already running. They never start one.

| Dashboard mode | Upload token needed? |
| --- | --- |
| Local mode on `127.0.0.1` | No |
| Login mode, even on `127.0.0.1` | Yes, a project upload token |

Remote dashboards must use HTTPS. Plain HTTP only works for `localhost`, `127.0.0.1` and `[::1]`.

## 1. Create an upload token (login mode)

An upload token lets one project receive runs. It is not a password and cannot do anything else.

1. Sign in and open **People & integrations**.
2. In **Project access**, pick the project in **Project**.
3. Under **Upload credentials**, enter a **Name** such as `GitHub Actions` and set **Expires in days** (1 to 90, default 30).
4. Choose **Create upload token**.

You should see **Copy your upload token now**. It is shown only once. Choose **Copy token** and store it in a password manager or CI secret before you choose **Dismiss**. The token appears in the list with its expiry, and you can **Revoke** it at any time.

An upload token can:

- Upload runs to its one project.
- Download that project's approved baselines.
- Assess that project's visual policy and reconcile its GitHub checks.

It cannot create projects, browse history, approve reviews, change baselines or manage people.

## 2. Point the CLI at the dashboard

Add the dashboard address, and the token for a login dashboard, to your app's ignored `.env.local`. In CI, use secrets instead.

```dotenv
VISUALGUARD_DASHBOARD_URL=https://visual.example.com
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

For a local login trial, use `http://127.0.0.1:4400`. The `test` command reads `.env` and `.env.local` by itself. Values already set in your shell win.

The capturing machine needs neither the database URL nor any dashboard password.

## 3. Capture and publish

```bash
npx --no-install visualguard test storefront --config visualguard.config.ts --no-ai
```

With `VISUALGUARD_DASHBOARD_URL` set, this is the same as adding `--dashboard https://visual.example.com`. You should see a line starting with `Dashboard project:`, the usual test output, then `Dashboard run: <link> [<status>]`.

Add labels so the team can filter the run later:

| Option | What it does | Default |
| --- | --- | --- |
| `--environment <name>` | Environment label shown in Run history | `staging` |
| `--run-name <name>` | Custom run name | `Run #N` |
| `--branch <name>` | Branch label | Not set |
| `--commit <sha>` | Source commit. Needed for baselines and policies | Taken from the capture when known |
| `--pr <number>` | Pull request number | Not set |
| `--deployment <id>` | Deployment label, such as a preview URL ID | Not set |

Example for a pull request in CI:

```bash
npx --no-install visualguard test storefront --config visualguard.config.ts \
  --branch feature/new-checkout --commit "$(git rev-parse HEAD)" --pr 42
```

See [GitHub Actions](/ci/github-actions/) for a full workflow.

## 4. Retry a failed upload

If publishing fails, the test prints `Dashboard publishing failed: ...` and `Saved evidence is kept at: <folder>`. The local run is safe. Retry it without capturing again.

`dashboard publish` does not read `.env.local` by itself. Create a small ignored file, `.env.visualguard-upload`, with just the token:

```dotenv
VISUALGUARD_UPLOAD_TOKEN=YOUR_PROJECT_UPLOAD_TOKEN
```

Then publish the saved folder:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard-upload \
  publish .visualguard/runs/RUN_ID \
  --project storefront --server https://visual.example.com
```

Replace `RUN_ID` with the folder from the error message. Pass the same `--environment`, `--branch`, `--commit`, `--pr`, `--deployment` and `--run-name` labels as the original test. You should see `Published: <link> [<status>]`, or `Already published: ...` if it had arrived after all.

How retries work:

- Files travel in 1 MiB chunks with checksums and a few automatic retries.
- The same unchanged run can resume its upload for up to 24 hours.
- Changed bytes can never overwrite evidence already uploaded under the same identity.
- A run is saved only after every required file arrives and validates.

## 5. Import on the dashboard host

On the machine that runs the dashboard, you can copy a run straight into storage. Use the same settings file as the dashboard:

```bash
npx --no-install visualguard dashboard --env-file .env.visualguard \
  import .visualguard/runs/RUN_ID --project storefront --name "Storefront Web"
```

You should see `Imported: /runs/<id> [<status>]`. Refresh the dashboard to see it. Import copies the evidence, so deleting the original folder later is safe. An incomplete run stays incomplete.

## Upload limits

| Limit | Value |
| --- | --- |
| Files per run | 4096 |
| Size of one file | 32 MiB |
| Size of `manifest.json` | 16 MiB |
| Total size of one run | 512 MiB |
| Metadata record on MongoDB | 12 MiB |

Split a very large test into smaller, complete runs, for example with [sharding](/ci/sharding/).

## Verify the result

- The run appears in **Run history** under the right project, with the expected branch, commit and environment.
- Opening the run shows every expected check, with no **Incomplete evidence** warning.
- The token's name and expiry appear under **Upload credentials**.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Set VISUALGUARD_UPLOAD_TOKEN for a dashboard requiring login` | The dashboard runs in login mode. Create an upload token and set it |
| `Set VISUALGUARD_UPLOAD_TOKEN to a project upload credential` | Remote dashboards always need a token. Check the variable name and that `--env-file` points to the right file |
| `Remote uploads require HTTPS` | Use the dashboard's `https://` address |
| `Upload credential does not permit this project` | The token belongs to another project. Use that project's token, or create one here |
| `Cannot bind dashboard project: ...` | The CLI could not reach the dashboard or find the project. Check the URL, the token and the project ID |
| `Upload session missing or expired; start a new upload` | More than 24 hours passed. Run `dashboard publish` again for a fresh upload |

Do not capture again just to hide an upload failure. Publish the saved run. More fixes: [Dashboard troubleshooting](/troubleshooting/dashboard/).

## Next steps

- [Run tests from the dashboard](/dashboard/run-tests/): start a capture from the browser instead.
- [Review exact visual evidence](/dashboard/reviews/): review the checks you just published.
- [GitHub Actions](/ci/github-actions/): publish from every pull request.
