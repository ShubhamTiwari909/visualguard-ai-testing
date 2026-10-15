# F03: collaborative review inbox

## Why this is the next standalone feature

The merged dashboard completes the Phase B shared-evidence boundary: F01 history, F02 access, and F06 CI uploads. Phase C in the organization roadmap contains three features. They should keep separate commits and can ship incrementally:

| Release unit | Features / phases combined | User outcome | Dependency / boundary |
| --- | --- | --- | --- |
| Shared dashboard, merged | Phase B: F01 + F02 + F06 upload stage | Share authenticated run evidence | Managed runner scheduling remains later |
| Collaborative review, this branch | Phase C's F03 review storage + permission-checked API + run review UI + assignment inbox | A second person can discuss and decide exact visual evidence | Uses existing check IDs; job-level pilot explicitly allowed by §6.3 |
| Reusable reference workflow, next | Phase C: F05 named checkpoints/catalog, then F04 baseline registry and promotion | Repeat named checks against traceable approved references | Keep F05 and F04 in their own commits; combine into a release after integration |
| Informative release assessment, later | Phase D: F07 policy, exact-revision check delivery, operational readiness | Explain whether a revision meets the team's rules | Depends on review, reference, and coverage semantics; start in shadow mode |

`codex/collaborative-review` starts from the merged `main`. This commit implements the F03 pilot, rather than claiming all of Phase C is complete. It combines the backend and user workflow needed to make reviews usable without waiting for baseline promotion or a release gate.

## Included behavior

- Each run has a **Team review** panel. Choose a check, inspect the reference/candidate screenshots and captured findings, then discuss or decide it.
- Comments support replies to earlier entries in the same check's history. A comment never counts as approval.
- Reviewers record **Approve visual change**, **Request changes**, or **Withdraw decision**, each with a required reason.
- Assign an active project reviewer and an optional deadline. The deadline input uses UTC; display dates use the browser's time zone.
- **Review inbox** filters a selected project's started threads by assignment, decision, and overdue status. Its default is **Assigned to me / Needs attention**, which includes pending and rejected work.
- Review history records the authenticated actor, server timestamp, check, run, source revision when supplied, evidence digest, and exact scope digest.
- Every change is appended using compare-and-swap. Conflicting submissions return 409; refresh and reconsider the latest history before resubmitting. The UI keeps an unsuccessful draft.
- Decisions, comments, assignments, and withdrawals remain in the thread history. There is no edit/delete-history endpoint. Deleting the run/project removes its threads, alongside existing evidence/access cleanup.

There are no new environment variables, services, migrations, package dependencies, or capture options. The existing SQLite, PostgreSQL, and MongoDB state adapters store the review ledger.

## Decision scope and safeguards

A decision covers **all visual changes in one check in one immutable stored run**. If the same screenshot contains an intentional color change and an unwanted overlap, request changes; this pilot cannot approve only one region. Comments can describe the specific region or finding, but do not suppress it. Region matching and independent finding decisions remain later work.

Visual approval never rewrites the engine manifest, `status`, summary, independent health/accessibility/performance findings, incompleteness, local accepted-change files, or baselines. The run can still display **Regression**, **Error**, or **Incomplete** after its visual change is approved. A run needs a compared reference/candidate pair and no recorded job execution error before visual decision buttons are enabled. Missing/error evidence can still be discussed or assigned.

New run IDs or changed evidence/revisions require new reviews. Re-importing an identical run is still idempotent and retains that same run's history. The API checks both the run evidence digest and a scope digest that includes the exact job and revision; it also checks the thread version. A stale request cannot silently approve replacement evidence.

The latest explicit decision controls the displayed visual state; later comments and assignment changes do not overwrite it. A withdrawal returns it to pending. This is a shared decision history, not an approval quorum: another permitted reviewer can explicitly supersede a decision with a reason and current thread version. Assignment does not grant permissions or reserve the right to decide; other project reviewers may participate. Self-review and administrator review are permitted. Required second-person approval, reviewer counts, policy exceptions, and release gates belong to F07.

Disabled users and users without current reviewer access cannot be assigned. While a recorded decision's author lacks current reviewer access, the displayed effective decision is pending and the historical entry remains visible. Restoring their reviewer access makes that historical decision eligible again; permanent revocation/policy semantics are not implemented here. An assignee who loses access remains visibly unavailable so the team can reassign the check.

## Run locally from this repository

These are commands for you to run manually; they were not executed during implementation.

Use Node 22.12+ and the repository's dependencies, then start the source dashboard:

```sh
pnpm platform:dev
```

Open `http://127.0.0.1:4400`. Source development serves the changed UI without rebuilding a previously packed package. Keep `.visualguard/` in your `.gitignore`; the dashboard does not add that ignore rule automatically.

Create a disposable project and publish a saved run using your existing CLI installation/build:

```sh
node packages/visualguard/dist/cli.js dashboard project create review-demo --name "Review demo"
node packages/visualguard/dist/cli.js dashboard import /absolute/path/to/saved-run --project review-demo
```

Both commands must use the same database/data-directory configuration as the running dashboard. The new UI and API run from source through `platform:dev`; an existing CLI build can import ordinary F01 evidence without containing the new review UI. To capture fresh evidence, start both application URLs and use your existing test command, for example:

```sh
node packages/visualguard/dist/cli.js test review-demo \
  --dashboard http://127.0.0.1:4400 \
  --production http://localhost:3101 \
  --staging http://localhost:3100 \
  --route / --no-ai
```

Open the run in history, scroll to **Team review**, and choose a check. In local mode the owner is **Local workspace**, so assignment is a one-person workflow. No account configuration is needed.

## Exercise the team workflow locally

Start the dashboard with password authentication enabled at the same loopback origin:

```sh
VISUALGUARD_AUTH_MODE=login \
VISUALGUARD_PUBLIC_URL=http://127.0.0.1:4400 \
VISUALGUARD_ADMIN_EMAIL=owner@example.test \
VISUALGUARD_ADMIN_PASSWORD='choose-a-unique-local-password' \
pnpm platform:dev
```

Use a disposable data directory if that administrator already exists: the bootstrap password only creates a new account and does not reset an existing one. An administrator creates accounts under **People & integrations**, then assigns project roles. The existing standalone walkthrough explains database/data-directory options and OIDC.

Use separate browser profiles or a private window for separate people; two ordinary tabs share the same sign-in cookie. Give the second account **Reviewer** access to the project. Give a third account **Viewer** access to exercise read-only participation. Hosted CLI upload continues to require the project's `VISUALGUARD_UPLOAD_TOKEN`; it cannot create a review.

## Installed package and hosting

The feature is bundled into the existing dashboard distribution. A consumer does not need a new config file or package API. Once you manually build/pack this branch and install that candidate package in another project, start the existing command:

```sh
npx visualguard dashboard
```

Use the [standalone walkthrough](STANDALONE-DASHBOARD-WALKTHROUGH.md) for candidate packaging, package installation, Cloud Run/Vercel scaffolding, and the existing four-setting hosted setup. Previously installed tarballs and existing deployments need the newly built package/UI to expose these controls. This branch does not publish npm, deploy to either host, or regenerate distribution output.

Raw SQLite files and native database backups include the review state and account/session state. Existing portable evidence exports remain **evidence only**: they exclude reviews, assignments, decisions, and authentication state. Restoring a portable export starts with no organizational approvals. Keep database-native backups if you need operational recovery of review history.

## API

Existing authentication, host/origin checks, JSON content type, and session action-token requirements apply. Browser mutations send `x-visualguard-platform-token`; upload bearer credentials cannot access these endpoints. Readers need project Viewer access; mutations need Reviewer or higher. The local owner has administrator access.

| Request | Result |
| --- | --- |
| `GET /api/runs/RUN_UUID/reviews?job=CHECK_ID` | Thread, exact digests, current version, visual state, assignment, deadline, and `canReview` |
| `POST /api/runs/RUN_UUID/reviews` | Append one explicit action against the submitted thread version |
| `GET /api/projects/PROJECT_ID/reviewers` | Eligible reviewer IDs/names, with no email/password fields |
| `GET /api/reviews?project=PROJECT_ID&owner=mine&status=open` | A bounded page of started review threads and an optional `nextCursor` |

Read the thread first and use its returned fields. An example POST body:

```json
{
  "jobId": "checkout__desktop",
  "evidenceDigest": "<64-character digest from GET>",
  "scopeDigest": "<64-character scope digest from GET>",
  "expectedVersion": 0,
  "event": {
    "action": "comment",
    "reason": "Please inspect the checkout button on the candidate."
  }
}
```

Other actions are `approve_visual_change`, `reject_visual_change`, and `withdraw_decision`, each with `reason`. `comment` optionally adds `replyTo` using an existing event ID in that same thread. `assign` requires `reason`, `assigneeId` (reviewer ID or `null`), and `dueAt` (UTC ISO timestamp or `null`). Clearing an assignment also clears its deadline. A new non-null deadline must be in the future.

Inbox `owner` accepts `mine`, `unassigned`, or `all`; `status` accepts `open` (pending/rejected), `pending`, `rejected`, `approved`, or `all`; `overdue=true` limits unresolved work to elapsed deadlines. Submit the returned `nextCursor` as `after` to continue. Ordering is stable by thread key, not by urgency or most recent activity. Filters apply to a bounded scan of 50 thread keys per page, so a page can contain no matches and still have a next cursor. The UI exposes that case rather than claiming all work is finished. Unstarted checks remain discoverable in run history; the inbox is not a coverage report.

Limits: 200 normal immutable events per check, 1–4,000 trimmed characters for reasons, 500 characters for check IDs, and up to 1,000 eligible reviewers in the assignment picker. A full thread returns 413 on another normal append; it is never silently pruned. One final withdrawal of an existing decision remains allowed beyond that limit, so a full discussion cannot trap an approval. Use a new capture for further discussion/decisions. The existing 16 KiB request-body limit also applies. Missing/expired sessions return 401, denied roles or invalid action tokens 403, missing runs/checks 404, stale evidence/version 409, invalid payloads 400, and unsupported content types 415. The service does not claim a successful release assessment.

## Manual acceptance sequence

1. Import or publish a representative run with at least two checks, including a changed screenshot and an independent failed request or accessibility finding. Open its review panel and verify both screenshot links and the comparison viewer.
2. Add a comment and a reply. Refresh the page; names, text, timestamps, reply links, and source revision should remain. The visual state stays pending.
3. Assign the check to a second reviewer with a future UTC deadline and a note. In the second person's browser, open **Review inbox**, choose the project, and leave **Assigned to me / Needs attention** selected. Open the deep link to the exact check.
4. Request changes with a reason. The item remains in **Needs attention** and can also be found under **Changes requested**. Approve only after inspecting the entire check. The visual state changes, but engine findings, run status, and the other check remain unchanged.
5. Add another comment after approval. It should preserve the visual approval. Withdraw the decision with a reason; the effective state returns to pending with all earlier entries intact.
6. Open the same thread in two browsers before either submits. Save in one, then submit in the other. Expect a conflict, with the second draft preserved. Refresh the second thread, read the new entry, and submit again. Both successful events remain visible.
7. Capture a new run/revision and open the equivalent check. It starts with no approvals. Try submitting the old run's digests to the new run through the API; expect 409. Re-importing an identical existing run should retain its existing history instead.
8. As a Viewer, read the discussion but confirm mutation controls are absent and a direct POST is denied. A user without project access and a CI upload token must not read or mutate reviews. A browser POST missing the action token or with a different origin must fail.
9. Remove the assigned reviewer's role or disable their account. The assignee is shown as unavailable, they disappear from the picker, and their existing decision becomes effectively pending while they lack access. Historical entries remain. Assign another eligible reviewer.
10. Let a near-future deadline pass, then refresh the inbox. **Overdue only** includes the unresolved check. A visually approved check no longer counts as overdue. No email or scheduled notification is sent.
11. Delete a disposable run/project using the existing confirmation flow. Its reviews should disappear along with the evidence. Re-importing as a new stored run starts fresh.
12. Repeat persistence, conflicting writes, isolation, and deletion with your disposable PostgreSQL and MongoDB configurations. Reopen the dashboard against the same local database file and confirm threads survive restart.

Focused regression cases are included for the service, HTTP access boundary, and optional live storage adapters. **No format, lint, type-check, build, browser check, or test commands were run during implementation.** The code has only been reviewed statically; it is not yet validated for release. Measure reviewer usefulness and repeatability with a pilot before building an enforcing release gate.
