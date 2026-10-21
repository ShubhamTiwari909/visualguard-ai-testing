---
title: "Deliver GitHub checks"
description: "Let the dashboard post a visual policy check on each pull request's exact head commit, kept current by a webhook and scheduled reconciliation."
audience: "operator"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "apps/platform/server/policy-github.ts",
    "apps/platform/server/policy-command.ts",
    "apps/platform/server/policies.ts",
    "apps/platform/.env.example",
    "packages/visualguard/src/cli/commands/dashboard.ts",
  ]
sidebar: { "order": 5 }
---

The dashboard can post a GitHub check run named `VisualGuard / <project>` on a pull request. The check says whether the PR's **head commit** meets the project's [visual policy](/dashboard/visual-policies/): fresh evidence, a current baseline and any required approvals. This page shows how to connect the dashboard to GitHub, keep the check current, and roll it out safely.

## Before you start

- Run a hosted dashboard in login mode, reachable from GitHub over HTTPS. See [Choose dashboard hosting](/deployment/overview/).
- Be a project maintainer (to edit the policy) and have access to the dashboard server's environment settings.
- Publish CI runs for the exact PR head commit. See [preview deployments](/ci/preview-deployments/).
- Have rights to create a GitHub credential and a webhook for the repository.

## How the pieces fit

A VisualGuard PR can show three separate results. Each uses its own credential, and one can fail while another passes.

| Result           | Made by                            | Credential                               |
| ---------------- | ---------------------------------- | ---------------------------------------- |
| Job pass or fail | `visualguard test` exit code in CI | None                                     |
| PR comment       | `visualguard comment` in CI        | CI's `GITHUB_TOKEN`                      |
| Policy check run | The dashboard server               | `VISUALGUARD_GITHUB_TOKEN` on the server |

The check is a point-in-time snapshot. The dashboard updates it when it **reconciles**: it asks GitHub for the PR's current head commit, assesses the policy for that commit, and creates or updates the check. Reconciliation runs when you ask for it, when GitHub sends a webhook, and on your schedule.

## 1. Save a policy in Informative mode

Open **Visual regression policy** at `/policies` in the dashboard and select the project. Fill in the form:

| Field                                             | What to enter                                                                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Rollout mode                                      | **Informative — report without blocking** for now.                                 |
| Approved baseline set                             | The [baseline set](/dashboard/approved-baselines/) the evidence must match.        |
| PR target branch                                  | The branch your PRs merge into, such as `main`. Only PRs targeting it are checked. |
| Evidence environment                              | The `--environment` label CI publishes with, such as `staging`.                    |
| Evidence valid for (hours)                        | How old evidence may be before it counts as stale.                                 |
| GitHub repository (optional)                      | `owner/name`, such as `customer-org/customer-repo`. Required for checks.           |
| Required screenshot check IDs                     | One per line. Leave empty to require the baseline's full coverage.                 |
| Require reviewer approval for changed screenshots | Tick to require a human approval for changes.                                      |

Enter a **Reason for policy change** and choose **Save new policy version**.

Missing or partial evidence, a stale baseline, capture failures, the wrong commit and a withdrawn or rejected approval all block a Required check. PR comments cannot bypass them. A temporary exception (a screenshot check ID, exact commit, expiry and reason) can waive an approval requirement, but never a capture or structural error. Read [visual policies](/dashboard/visual-policies/) for what each rule means and how exceptions work.

## 2. Create a GitHub credential

The server needs a token that can write checks and read pull requests:

- **Checks:** read and write
- **Pull requests:** read

A GitHub App installation token is the usual choice for check runs. Confirm which token types GitHub accepts in [GitHub's check run docs](https://docs.github.com/en/rest/checks/runs#create-a-check-run). A normal `gh` CLI login token is not suitable. Installation tokens expire, so your deployment must refresh the value; VisualGuard does not.

## 3. Configure the dashboard server

Add these settings to the server's private environment or secret store. Never put them on CI runners.

```dotenv
VISUALGUARD_GITHUB_TOKEN=your-checks-write-token
VISUALGUARD_GITHUB_REPOSITORIES=storefront=customer-org/customer-repo
VISUALGUARD_GITHUB_WEBHOOK_SECRET=a-long-random-secret
```

| Variable                            | What it does                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `VISUALGUARD_GITHUB_TOKEN`          | Credential the server uses to read PRs and write checks.                                                    |
| `VISUALGUARD_GITHUB_REPOSITORIES`   | Allowlist of `project=owner/repo` pairs, comma-separated. A project can only post to its listed repository. |
| `VISUALGUARD_GITHUB_WEBHOOK_SECRET` | Shared secret used to verify GitHub webhook signatures.                                                     |

The project side of each pair is the project's **internal ID**: the ID it was first created with. Renaming a project's public ID does not change it. Generate the webhook secret with a tool such as `openssl rand -hex 32`.

Restart or redeploy the dashboard. On the policy page, **GitHub PR checks** should now say "GitHub delivery is configured."

## 4. Publish evidence for the PR head

CI must publish a run for the PR's real head commit, with its PR number and the policy's environment:

```bash
npx --no-install visualguard test storefront \
  --dashboard https://visualguard.example.com \
  --commit "$PR_HEAD_SHA" --pr 123 --environment staging --no-ai
```

On GitHub, use `github.event.pull_request.head.sha`, not the default merge commit. The job needs only `VISUALGUARD_UPLOAD_TOKEN`.

## 5. Assess and reconcile

You can do this on the policy page: **Assess current policy** under **Assess visual evidence**, and **Reconcile GitHub check** under **GitHub PR checks**. Or use the CLI from a trusted machine:

```bash
npx --no-install visualguard dashboard policy assess \
  --project storefront --revision CAPTURED_FULL_SHA --server https://visualguard.example.com
npx --no-install visualguard dashboard policy reconcile \
  --project storefront --pr 123 --server https://visualguard.example.com
```

Both print JSON. Against a hosted dashboard they need `VISUALGUARD_UPLOAD_TOKEN` for that project in the environment.

| Command and option                | What it does                                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| `policy assess --project <id>`    | Project to assess. Required.                                            |
| `--revision <sha>`                | Exact source commit. Required.                                          |
| `--run <id>`                      | Assess one specific stored run.                                         |
| `--enforce`                       | Exit with code `2` unless the result is satisfied.                      |
| `policy reconcile --project <id>` | Project to reconcile. Required.                                         |
| `--pr <number>`                   | Verify the live PR head and update its check.                           |
| `--all`                           | Refresh every tracked PR for the project. Use either `--pr` or `--all`. |
| `--server <url>`                  | Dashboard origin. Without it, the command opens local storage directly. |

`reconcile` exits with `2` if any PR failed to update.

The check's result depends on the rollout mode:

| Mode        | Policy result | GitHub check         |
| ----------- | ------------- | -------------------- |
| Informative | Any           | Completed, `neutral` |
| Required    | Satisfied     | Completed, `success` |
| Required    | Blocked       | Completed, `failure` |
| Required    | Pending       | In progress          |

The check links back to `/policies` when `VISUALGUARD_PUBLIC_URL` is set.

## 6. Add the webhook

A webhook makes the dashboard reconcile as soon as a PR changes. In the GitHub repository, open **Settings → Webhooks → Add webhook**:

| Field        | Value                                                 |
| ------------ | ----------------------------------------------------- |
| Payload URL  | `https://visualguard.example.com/api/github/webhook`  |
| Content type | `application/json`                                    |
| Secret       | The same value as `VISUALGUARD_GITHUB_WEBHOOK_SECRET` |
| Events       | **Pull requests** only                                |

The server reconciles on `opened`, `reopened`, `synchronize`, `ready_for_review`, `edited` and `closed`. It ignores other events.

:::caution
The server checks the signature against the exact bytes GitHub sent. If your host parses the JSON body first, the request fails with "GitHub webhooks require the original raw request body". Test a real delivery on Vercel or Cloud Run. If raw bodies cannot reach the server, rely on scheduled reconciliation instead.
:::

## 7. Schedule reconciliation

Webhooks can be missed, and reviews, baselines, policy or access can change without a PR event. Run this from a trusted scheduler at least every five minutes:

```bash
npx --no-install visualguard dashboard policy reconcile \
  --project storefront --all --server https://visualguard.example.com
```

Give the scheduler `VISUALGUARD_UPLOAD_TOKEN` through its secret store. Hosting does not set up a scheduler for you. Cloud Scheduler or Vercel Cron need a job that runs this CLI; they cannot call a CLI name directly. Only one reconciliation per project runs at a time; a second gets "GitHub reconciliation is already running; retry later". Each project tracks up to 100 open PRs.

## Example: rolling out on one repository

A team adds checks to `customer-org/storefront`, policy target `main`:

1. Week 1: Informative mode, webhook on, reconcile every five minutes. Every PR shows a neutral `VisualGuard / storefront` check.
2. They test the hard cases: push a new commit (the old evidence must not count), let evidence go stale, revoke a token, and redeliver a webhook from GitHub.
3. Week 2: switch **Rollout mode** to **Required**. Checks now show `success` or `failure`.
4. Only then do they mark the check as required in GitHub branch protection. VisualGuard never changes branch protection or merges PRs.

## Verify the checks

1. Push a commit to a PR and publish evidence for its head SHA.
2. Reconcile. A `VisualGuard / <project>` check should appear on that exact commit.
3. Push another commit. The new commit should get a new check; the old evidence must not satisfy it.
4. In GitHub's webhook settings, open **Recent Deliveries**. Deliveries should return 200.

## Troubleshooting

| Problem                                                                            | Fix                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| "Configure the GitHub credential and repository allowlist on the dashboard server" | Set `VISUALGUARD_GITHUB_TOKEN`, and list the repository in `VISUALGUARD_GITHUB_REPOSITORIES`. |
| "Configure a GitHub repository in the project policy first"                        | Fill in **GitHub repository** on the policy and save a new version.                           |
| "This repository is not allowed for this project"                                  | Use the project's internal ID in `VISUALGUARD_GITHUB_REPOSITORIES`.                           |
| "PR must be open and target the policy's configured branch"                        | Check the PR's base branch matches **PR target branch**.                                      |
| Webhook returns 401 "Invalid GitHub webhook signature"                             | Use the same secret in GitHub and on the server, and keep the raw body intact.                |
| "GitHub request failed (403)"                                                      | The token lacks Checks write or Pull requests read, or has expired.                           |
| "Use a project upload token for a hosted dashboard"                                | Set `VISUALGUARD_UPLOAD_TOKEN` before running `policy` commands.                              |

See [dashboard troubleshooting](/troubleshooting/dashboard/) for more.

## Next steps

- [Visual policies](/dashboard/visual-policies/): rules, exceptions and what blocks a PR.
- [Preview deployments](/ci/preview-deployments/): publish evidence for the right commit.
- [Approved baselines](/dashboard/approved-baselines/): manage the references the policy checks against.
