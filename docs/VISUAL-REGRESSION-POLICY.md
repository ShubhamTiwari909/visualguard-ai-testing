# Visual regression policy and GitHub PR checks (F07)

F07 uses existing screenshot checks, approved baseline sets and shared review decisions. Named journeys and application dataset management remain deferred. The policy produces `pending`, `satisfied` or `blocked`; an API/storage/delivery failure returns an error and must not be treated as success. Engine results and offline reports remain unchanged.

## Start locally from scratch

1. Check out `codex/visual-regression-policy-f07` (or `main` after this feature merges), use Node.js 22.12+ and pnpm 9, then run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter visualguard exec playwright install chromium
   pnpm --filter visualguard build:dashboard
   ```

2. Follow steps 2–7 of the [approved baseline color-change walkthrough](APPROVED-BASELINES.md#from-scratch-local-color-change-example) to start production on port 4100, staging on 4101, and the dashboard on 4400; create `baseline-demo`; import and review the initial comparison; promote `main` v1; pull the approved snapshot; and run the baseline comparison. Stay on the F07 branch. Use the same `.visualguard/approved-demo-platform` data directory throughout. No upload token, Google login, PostgreSQL or MongoDB is needed. SQLite is created automatically.

3. Import the **new baseline comparison** from step 7, replacing `COMPARISON_DIRECTORY` with its directory containing `manifest.json`:

   ```sh
   export VISUALGUARD_DATABASE_URL="" DATABASE_URL="" VISUALGUARD_DASHBOARD_URL=""
   export VISUALGUARD_PUBLIC_URL="" VISUALGUARD_UPLOAD_TOKEN=""
   export VISUALGUARD_PLATFORM_DATA_DIR="$PWD/.visualguard/approved-demo-platform"
   node packages/visualguard/dist/cli.js dashboard import COMPARISON_DIRECTORY \
     --project baseline-demo --environment staging --branch main \
     --commit "$(git rev-parse HEAD)" --run-name "F07 unchanged baseline"
   ```

   Use the commit actually captured by this run. The evaluator checks both the uploaded metadata and the engine's recorded capture provenance. Relabeling older evidence does not change that provenance.

4. Open [Visual regression policy](http://127.0.0.1:4400/policies?project=baseline-demo). Choose the project, keep **Informative**, baseline `main`, target branch `main`, environment `staging`, and a 24-hour evidence lifetime. Keep required IDs empty to require every check in the approved baseline. Keep visual approval enabled. Leave GitHub repository blank for local testing. Enter a reason and save version 1.

5. Under **Assess visual evidence**, choose the new comparison and click **Assess current policy**. Unchanged, complete, reliable screenshots against the current approved baseline should be **Satisfied** without a new visual approval. You can also open the run and choose **Assess this run**.

6. Assess from the CLI, using the same data directory:

   ```sh
   node packages/visualguard/dist/cli.js dashboard policy assess \
     --project baseline-demo --revision "$(git rev-parse HEAD)"
   ```

   Add `--run RUN_UUID` to inspect a specific stored run. Add `--enforce` to exit with code 2 unless satisfied, including when no policy/evidence exists. Without `--enforce`, pending/blocked assessments are printed as information; operational errors still fail the command. This works directly against local platform storage with no running server. Offline screenshot comparison remains independent of the platform.

7. Reopen the policy page, change the evidence lifetime, enter another reason, and save again. Expect version 2 and both entries in history. Open two tabs and save in one; saving the stale version from the other must return a conflict. Reload before making another change.

## Exercise each protection

| Check | Action | Expected result |
| --- | --- | --- |
| Visual change | Run the baseline config with `--staging http://127.0.0.1:4100`, import that new run, and assess | Blocked until a reviewer approves each changed screenshot in **Check reviews**; reassess afterward |
| Withdraw/reject | Withdraw the current visual approval or reject it, then reassess | Blocked; comments and local accept files do not substitute for approval |
| Exact commit | Assess a different full 40-character commit | Pending without evidence; selecting a run from a different commit blocks |
| Coverage | Add a nonexistent ID to required checks and save | Blocked for missing required screenshot even if captured checks pass |
| Partial execution | Upload an individual shard or an engine-marked incomplete run | Blocked; merge and publish the complete execution |
| Stale reference | Restore/promote a new approved version, then assess old evidence | Blocked; pull the current version and capture again |
| Capture reliability | Assess a run with capture errors, instability, truncation or independent failures | Blocked even if its visual change was approved |
| Evidence age | Assess a run older than the configured lifetime | Blocked; freshness starts at capture time, not upload time |
| Temporary exception | Add an exact check ID, exact commit, reason and expiry under **Temporary visual approval exceptions**, then save | Only its missing visual approval is waived until expiry; explicit rejection and structural/capture failures still block |
| Access changes | Remove/disable/downgrade the deciding reviewer in a hosted workspace, then reassess | Their decision no longer provides an approval |
| Permissions | View as a project viewer | Policy/history and assessment available; edits and browser GitHub reconciliation require a maintainer |

An exception must expire within seven days. Changing exceptions creates a new policy version with actor and reason. An empty required-check list inherits all current baseline entries; an explicit list is the maintainer's selected required coverage. Every captured check, including additional checks, must still have a compatible approved reference and satisfy reliability/review rules.

## Optional GitHub setup

Local assessment adds no required environment variables. For GitHub delivery, configure these **on the dashboard server**:

| Variable | Value |
| --- | --- |
| `VISUALGUARD_GITHUB_TOKEN` | Fine-grained token with **Checks: write** and **Pull requests: read** for the selected repositories, or a GitHub App installation token maintained by your deployment |
| `VISUALGUARD_GITHUB_REPOSITORIES` | Comma-separated immutable project-ID mappings, e.g. `storefront=your-org/store,admin-ui=your-org/admin-ui` |
| `VISUALGUARD_GITHUB_WEBHOOK_SECRET` | Random secret matching the repository webhook configuration |
| `VISUALGUARD_PUBLIC_URL` | Existing HTTPS dashboard origin; used for hosted authentication and check details links |

Keep secrets in the deployment secret store. They are never returned in policy responses or included in artifacts. Token rotation/installation-token refresh is the deployment's responsibility. A classic PAT cannot create Check Runs; use a supported token type described by [GitHub's Checks API](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run).

1. Restart the server with those settings and normal hosted login configuration. In **Visual regression policy**, set the allowed `owner/repository`, target branch and evidence environment; keep **Informative**; save with a reason.
2. Configure a repository webhook to `https://YOUR_DASHBOARD/api/github/webhook`, content type JSON, the matching secret, and **Pull requests** events. The handler verifies the raw-body signature before processing it. Do not put this endpoint behind an additional interactive login screen. The hosting adapter must preserve raw request bytes: disable JSON body parsing for this endpoint. If a host supplies an already parsed object, the endpoint rejects it rather than checking a reserialized payload; use scheduled/CLI reconciliation when raw-body forwarding is unavailable.
3. In trusted CI, check out the PR's **head SHA**, capture against the pulled approved baseline, then publish with `--commit HEAD_SHA --pr PR_NUMBER --environment staging`. `HEAD_SHA` must be the captured head commit, rather than GitHub's temporary merge commit. Use the actual base repository's PR number. Never expose upload or GitHub credentials to untrusted PR code.
4. Reconcile after upload:

   ```sh
   # Set VISUALGUARD_UPLOAD_TOKEN through CI secrets for this project.
   node packages/visualguard/dist/cli.js dashboard policy reconcile \
     --project storefront --pr 123 --server https://YOUR_DASHBOARD
   ```

   This requires the **server's** GitHub configuration; CI does not need the server's GitHub token. Upload credentials can assess/reconcile only their own project. They cannot edit policy, exceptions, reviews, baselines or accounts, or browse general run history.

5. Inspect **GitHub PR checks** on the policy page or the `VisualGuard / PROJECT_ID` GitHub check. Informative mode completes with a neutral conclusion and records the actual assessment in its title/output. Required mode uses success for satisfied, failure for blocked, and in-progress for missing evidence. A newer PR head gets a separate check and cannot inherit an older commit's success. Evidence must be bound to that PR, SHA and environment.
6. Review changed screenshots in the dashboard, then reconcile again. Configure a trusted scheduler to run the following at least every five minutes, and after policy, review, baseline or account changes:

   ```sh
   node packages/visualguard/dist/cli.js dashboard policy reconcile \
     --project storefront --all --server https://YOUR_DASHBOARD
   ```

   The command refreshes tracked open PRs, continues after individual failures, prints per-PR errors, and exits nonzero if any reconciliation fails. Start tracking a PR via its webhook or `--pr`. Closed PRs are skipped by scheduled runs; closed events mark them closed and reopened events resume checks. Run the command separately for each project. Serverless hosts require this external schedule; no background process is assumed.

7. Simulate delivery recovery by temporarily removing the server's GitHub token, reconciling, restoring the token and reconciling again. The dashboard records the failure. Retrying discovers an existing Check Run by external ID, including after an ambiguous creation response, instead of blindly creating duplicates. Transient reads/updates have bounded retries. A shared lease serializes reconciliations for a project.

Checks are **point-in-time observations**. Scheduled/on-demand reconciliation is required to reflect later review withdrawals, membership changes, reference changes, expiry and outages. GitHub can retain a prior conclusion while the dashboard or network is unavailable; monitor the scheduler and avoid treating that cached conclusion as a continuously valid authorization. Start in informative mode. Before enabling required branch checks, validate this recovery/freshness behavior with your pilot and operational monitoring. This feature never changes branch protection or merges a PR.

F07 verifies the live PR head and target branch for check delivery. F04 promotion still records a maintainer's landed-revision attestation; it does not gain automatic merge ancestry verification.

## Storage and API

Policies/history, exceptions and delivery records use the existing persistent state store (SQLite, PostgreSQL or MongoDB). Policy updates append a version to one compare-and-swap record; at most 200 versions/2 MiB per project. At most 100 open PRs are tracked per project; closed records can be reclaimed at the limit. Assessments support up to 1000 checks. Native database backups preserve policy and reconciliation state; portable evidence export/restore does not include it. Full project deletion removes policy and delivery records.

Under `/api/projects/PROJECT/policy` (project aliases accepted):

- `GET /`: current policy, newest-first history, edit permission and GitHub availability.
- `POST /`: `{expectedVersion, reason, policy}`. A policy contains `mode`, `baselineSet`, `targetBranch`, `environment`, `requiredChecks`, `requireApproval`, `maxAgeHours`, optional `repository`, and `exceptions`.
- `POST /assess`: `{revision, runId?}`; explicitly selecting another revision's run blocks.
- `GET /deliveries`: recent bounded reconciliation records, including last errors.
- `POST /reconcile`: `{pullRequest}`; verifies GitHub state and refreshes a check.

Browser mutations require the existing CSRF protection. Scoped upload tokens are accepted only for reading policy/delivery state, assessing and reconciling their project. `POST /api/github/webhook` instead requires `X-Hub-Signature-256` on the raw body; duplicate PR events reconcile idempotently. GitHub delivery uses the documented [PR API](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request) and [Check Runs API](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28).

## Validation for this implementation

Focused local validation passed: 47 behavior tests across policy evaluation, HTTP permissions/CSRF/scoped credentials, SQLite persistence, GitHub reconciliation, baseline deletion and runtime integration. Four PostgreSQL/MongoDB cases were skipped because their test connection variables were not configured. The package JavaScript/dashboard/offline-report build passed without declaration generation. Browser checks covered desktop and 390px mobile layouts, save/reload/save, assessment display, no horizontal overflow and a clean console after the validation fix. The built CLI returned exit 0 for satisfied evidence and exit 2 for a missing revision with `--enforce`.

GitHub delivery was exercised with simulated API responses; no live repository webhook or Check Run was configured during implementation. Formatting, lint and type checks were not run, as required by the current repository instructions. These deferred checks remain outstanding before merge/release.

PR #52 review also added regression cases for newer evidence arriving during GitHub publication and an expired reconciliation lease. Delivery now reselects the newest evidence bound to the exact PR/commit/environment before confirming its result, and a worker that loses its lease cannot invalidate the newer worker's result from its failure handler. The full local platform suite passed 358 tests, with 158 conditional external-storage cases skipped. The original PR CI exercised PostgreSQL and MongoDB and passed 492 tests with 22 conditional skips; final cleanup CI results should be checked on the reviewed head before merging.
