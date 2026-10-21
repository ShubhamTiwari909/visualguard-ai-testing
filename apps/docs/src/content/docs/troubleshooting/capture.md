---
title: "Capture, report, AI and fix problems"
description: "Fix unreachable pages, wrong screenshots, noisy diffs, baseline errors, report issues, skipped AI analysis and rejected or unverified fixes."
audience: "developer"
docType: "reference"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "README.md",
    "docs/NPM-PACKAGE-SETUP.md",
    "packages/visualguard/src/core/run.ts",
    "packages/visualguard/src/core/provenance.ts",
    "packages/visualguard/src/ai/analyze-job.ts",
    "packages/visualguard/src/ai/budget.ts",
    "packages/visualguard/src/ai/factory.ts",
    "packages/visualguard/src/fixer/fix.ts",
    "packages/visualguard/src/fixer/auto.ts",
    "packages/visualguard/src/fixer/verify.ts",
  ]
sidebar: { "order": 3 }
---

Use this page when `visualguard test` runs but the screenshots, the report, the AI analysis or an automatic fix is not what you expect. Each problem lists the likely cause, the exact fix and how to confirm it.

## Before you start

- Run commands from your app's root folder and use the same `--config` as the failing run.
- Remember that a non-zero exit can be correct. Exit `1` often means VisualGuard found a real regression. Read [exit codes](/reference/exit-codes/) and open the report before changing settings.
- `report` keeps serving the report until you press Ctrl+C.
- Examples use macOS/Linux shells; on Windows use WSL.

## Pages cannot be reached

### Connection refused or timeout

The run result shows a capture error such as `staging: ... net::ERR_CONNECTION_REFUSED`, or `doctor` marks a URL as failed.

- **Likely cause:** the app server is not running, or the host or port is wrong. In CI or Docker, `localhost` may point to a different machine than you think.
- **Fix:** start the server, correct `baseURL` (or `--production` and `--staging`), and make sure the machine that runs VisualGuard can open both URLs.
- **Confirm:**

  ```bash
  npx --no-install visualguard doctor
  npx --no-install visualguard test --list
  ```

  You should see both URL checks marked as OK with an HTTP status, and `--list` printing the URL pairs that will be captured.

### Missing base URL

You see `Missing base URL for staging` (or production).

- **Likely cause:** the config has no URL for that side and no override was given.
- **Fix:** set `baseURL.staging` in the config, set `VISUALGUARD_STAGING_URL`, or pass `--staging URL`. The same applies to production.
- **Confirm:** `test --list` prints full URLs for both sides.

### The site returns an error status

`doctor` shows a URL as `https://… → HTTP 500` with `The site responds with an error status.`

- **Likely cause:** the page itself fails, or needs headers or login.
- **Fix:** open the URL in a browser from the same machine. Fix the app, or add headers or a saved login session for that environment. See [application login](/guides/application-auth/).
- **Confirm:** `doctor` shows a status below 400.

## Screenshots look wrong

### Login page, blank page or error page in the screenshot

- **Likely cause:** the saved login session expired or belongs to another environment, the route needs data that is missing, or the page is still loading.
- **Fix:** save a fresh session for that environment, then capture again.

  ```bash
  npx --no-install visualguard auth staging --until-url "**/dashboard"
  ```

  If you see `storageState file for staging not found: PATH`, the config points to a session file that does not exist. Create it with `auth` or fix the path.

- **Confirm:** open the new screenshot in the report. It should show the real page, not a login form.

### A real change is not detected

- **Likely cause:** something hides it. Common reasons: the route or viewport was filtered out with `--only`, `--route` or `--viewport`; the area is covered by `stabilize.mask` or `stabilize.hide` or a `data-visualguard-ignore` marker; the change is smaller than `diff.maxDiffPixels` (20 pixels by default); or the noise map treated the area as always changing.
- **Fix:** narrow the setting that hides the change. Do not remove all masks at once. See [diffs and noise](/guides/diff-and-noise/).
- **Confirm:** run against a page with a known change and an unchanged control page. The changed page should fail and the control page should pass.

### Random pixel changes on every run

- **Likely cause:** fonts, clocks, animations, videos, ads, third-party scripts or live data change between captures.
- **Fix:** keep the default stabilisation on, block noisy requests with `stabilize.blockRequests`, and mask only the parts that really change on their own. See [stable captures](/guides/stable-captures/). Never mask meaningful UI just to make a test pass.
- **Confirm:** run the same unchanged pages twice. Both runs should pass.

## Baseline problems

These apply in baseline mode (`mode: "baseline"`). See [local baselines](/guides/local-baselines/).

### No baseline yet

The job shows `No baseline yet; run with --update-baselines to save one`.

- **Likely cause:** missing baselines fail by default (`baseline.missing: "error"`).
- **Fix:** check that the current pages look right, then save baselines on purpose:

  ```bash
  npx --no-install visualguard test --update-baselines --no-ai
  ```

- **Confirm:** run the same command without `--update-baselines`. The jobs should pass. Commit the PNG files together with their `.meta.json`, `.dom.json` and `.health.json` files.

### Baseline metadata missing or settings do not match

You see `Baseline metadata missing for PATH` or `Baseline rendering settings do not match: PATH`.

- **Likely cause:** the baseline was made by an older version, or with a different browser, platform, viewport or theme.
- **Fix:** capture with the original settings, or regenerate the baselines with `--update-baselines`. For a short migration from older baselines, you can set `baseline.legacy: "allow"`, then regenerate and remove it.
- **Confirm:** the run passes without the metadata error.

### Approved baselines cannot be updated locally

- **Likely cause:** the folder came from `dashboard baseline pull`. Approved sets are read-only on your machine.
- **Fix:** change approved references through the dashboard review and promotion flow, then pull the new version into a new folder. See [approved baselines](/dashboard/approved-baselines/).
- **Confirm:** the new folder holds the new version and the run passes.

## Report problems

### The report shows another run, or `Run "ID" not found`

- **Likely cause:** `report` used a different config or output folder, or the run ID is wrong.
- **Fix:** use the same `--config` as the test and pass a real run ID, ID prefix or run number:

  ```bash
  npx --no-install visualguard report --config visualguard.config.ts --run 0042
  ```

- **Confirm:** the report header shows the run you expected. The run folder holds a `manifest.json`.

### `No runs found`

- **Likely cause:** no test has run with this output folder yet, or `output.dir` points somewhere else.
- **Fix:** run `npx --no-install visualguard test` first, or use the config that sets the right `output.dir`.
- **Confirm:** `.visualguard/runs/` (or your output folder) contains run folders.

### Images are missing after sharing a report

- **Likely cause:** only `index.html` was copied. The report reads screenshots from the run folder next to it.
- **Fix:** share the whole run folder, for example as a CI artifact. See [run artifacts](/reference/artifacts/).
- **Confirm:** open the copied `index.html` on another machine. Every image should load.

## AI analysis

AI analysis is optional. When it cannot run, VisualGuard keeps the result from its built-in checks (called heuristics) and adds a note to the job. AI problems never fail a run by themselves. See [AI policy and budgets](/guides/ai-policy-and-budgets/).

### `AI off: GEMINI_API_KEY is not set; using heuristics only`

- **Likely cause:** the provider is `gemini`, but no `GEMINI_API_KEY` or `GOOGLE_API_KEY` reached the process.
- **Fix:** add the key to `.env.local` (local) or your CI secrets, then rerun. For a run that should skip AI on purpose, pass `--no-ai`.
- **Confirm:** `doctor` shows `gemini (MODEL)` for the AI provider, and new jobs include an AI explanation.

### No AI explanation, but no error

- **Likely cause:** AI is off by default (`ai.provider: "none"`), or the job did not need it. By default (`ai.analyze: "uncertain"`) VisualGuard skips jobs that the heuristics already marked as regressions, passing jobs, accepted jobs and capture errors.
- **Fix:** set a provider in the config or pass `--provider gemini`. A `--provider` flag wins over a config that says `none`. Set `ai.analyze: "all"` to analyse regressions too.
- **Confirm:** `doctor` lists your provider, and the report shows analysis for jobs that changed.

### `AI analysis failed: ...`

Common messages and fixes:

| Message                                                                  | Fix                                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `Gemini rejected the API key (check GEMINI_API_KEY)`                     | Create a new key, update the secret and rerun.                                        |
| `Gemini model "ID" is not available; set ai.model to a current model id` | Set `ai.model` to a model your key can use. `doctor` lists valid choices.             |
| `Gemini quota used up ...`                                               | Wait for the reset time shown, or use another key or model.                           |
| `Gemini rate limit reached`                                              | VisualGuard retries short waits itself. Lower `ai.concurrency` if it keeps happening. |
| `Ollama is not reachable at HOST`                                        | Start Ollama, or set `OLLAMA_HOST` to the right address.                              |
| `Ollama model "ID" is not installed. Run: ollama pull ID`                | Run that command, then rerun. Pick a model that can read images.                      |

**Confirm:** rerun only the analysis, without capturing again:

```bash
npx --no-install visualguard analyze --run 0042 --provider gemini
```

### `AI skipped: ...` after the first failures

- **Likely cause:** a stopping error happened earlier in the same run, such as a rejected key, a missing model or an exhausted daily quota. VisualGuard stops calling the provider for the rest of the run and labels later jobs `AI skipped: REASON`.
- **Fix:** fix the first error (see the table above), then run `analyze` on the saved run.
- **Confirm:** `analyze` finishes without the `AI skipped` note.

### Budget reached

You see `AI budget reached (ai.maxCallsPerRun); explained by heuristics only`, `AI token budget reached`, `AI generation-attempt budget reached` or `AI network-attempt budget reached`.

- **Likely cause:** the run used its AI allowance. The limits are `ai.maxCallsPerRun` (30 job analyses), `ai.maxTokens` (200,000), `ai.maxGenerationAttempts` (60) and `ai.maxNetworkAttempts` (120). A later `analyze` or `fix` on the same run continues from the token and attempt counts saved in `ai-usage.json`, so those limits do not start from zero.
- **Fix:** test fewer routes per run, keep `ai.analyze: "uncertain"`, or raise the limit on purpose.
- **Confirm:** the next run finishes without a budget note, or with the note only where you expect it.

### Deadline reached

- **Likely cause:** `ai.timeoutMs` (120,000 ms by default) is the deadline for all AI work in one command. When it passes, pending requests are cancelled and the remaining jobs keep their heuristic result with an `AI analysis failed` note.
- **Fix:** analyse fewer jobs per run, or raise `ai.timeoutMs`.
- **Confirm:** rerun `analyze` and check that every changed job has an explanation.

## Automatic fixes

`visualguard fix` proposes source edits, applies them, and checks them visually. Each attempt ends as `fixed`, `unverified`, `rejected`, `failed` or `skipped`. The command exits `0` only when every attempt is `fixed`. See [automatic fixes](/guides/fixes/).

### `Fixing is turned off.`

- **Fix:** set `fix: { enabled: true }` in the config. Fixes are still applied only after you confirm them.
- **Confirm:** run `fix` again. The error no longer appears.

### `The working tree has uncommitted changes`

- **Likely cause:** `fix` needs a clean git checkout so every change can be reviewed and undone.
- **Fix:** commit or stash your changes, or pass `--allow-dirty` if you accept mixing them.
- **Confirm:** `git status` is clean and `fix` starts.

### `Change not applied.` (rejected)

- **Likely cause:** you answered no when `fix` asked to apply the change. This is the normal result of declining.
- **Fix:** nothing to fix. Run `fix` again to get a new proposal.

### `Applied but not verified: set fix.verify.server to check it visually.` (unverified)

- **Likely cause:** there is no `fix.verify.server`, so VisualGuard could apply the edit but could not recapture the page to check it.
- **Fix:** add `fix.verify.server` with the local URL (and optionally the `command` that starts your dev server). Review `git diff` yourself before you keep an unverified change.
- **Confirm:** the next `fix` reports `fixed` with `ROUTE now matches production (N differing pixels)`.

### Reverted or rolled back

You see one of these messages:

- `Still differs; reverted.` The page still did not match after the edit.
- `Collateral change on ROUTE (VIEWPORT); reverted.` The edit fixed one page but changed another.
- `Batch verification failed on ROUTE (VIEWPORT); all batch edits reverted.` The final check over the whole original run found a page that changed.
- `No working fix after N attempt(s)... All edits were reverted.`

- **Likely cause:** the proposed edit did not fully fix the page, or it changed pages that should stay the same. VisualGuard checks every route and viewport from the original run, so an intentional side effect also counts as a change.
- **Fix:** read the saved attempt in `fixes/` inside the run folder. Fix the code by hand, or recapture and review the intended side effect in a new run first. Raise `fix.maxAttempts` (up to 5) to allow more tries.
- **Confirm:** `git diff` shows no leftover edits from the fix, and the next `test` run still shows the original regression.

### Other fix errors

| Message                                                                | Fix                                                                                          |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Automatic fixing requires fix.verify.server for visual verification.` | Configure `fix.verify.server` before using `--auto`.                                         |
| `Sending source code to PROVIDER hasn't been allowed.`                 | Run `visualguard fix` once in a terminal and allow it, or set `fix.allowSourceUpload: true`. |
| `A server is already running at URL`                                   | Stop it so VisualGuard can start the dev server from the fix worktree, or use `--in-place`.  |
| `Nothing is answering at URL`                                          | Start your dev server, or set `fix.verify.server.command`.                                   |
| `PATH changed since the proposal; generate a new proposal.`            | A file changed after the proposal. Run `fix` again.                                          |
| `No source files matched this change (check fix.include).`             | Add the right source folders to `fix.include`.                                               |
| `--pr, --branch, --in-place and --keep-worktree need --auto.`          | Add `--auto`, or drop those flags.                                                           |

## Next steps

- [Read result statuses](/concepts/results/) to tell regressions from items that need review.
- [Accept intentional changes](/guides/accepting-changes/) so they stop failing.
- [Fix CI-only problems](/troubleshooting/ci/) if the same run passes on your computer.
