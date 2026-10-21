# VisualGuard SDK for scripts and CI

Use `runVisualGuard` from the `visualguard` package to run visual comparisons in
Node.js scripts and CI. It uses the same engine and configuration as the CLI,
including section screenshots. No dashboard is required. Importing it does not
start a test; awaiting the function does.

Use a package release that exports `runVisualGuard`. On a source checkout, build
the package before trying a consumer example. The older `createRun` API remains
available for integrations that already resolve configuration themselves.

## 1. Install and prepare your application

Use Node.js 22.12 or newer. In the application root:

```sh
npm install --save-dev visualguard playwright
npx playwright install chromium
```

Commit `package.json` and the lockfile. Linux CI needs
`npx playwright install --with-deps chromium` instead. Production and staging must
already be running and reachable from the machine executing the script. For
localhost applications, start both servers and wait for readiness before capture.
The SDK does not start application servers or bypass Cloud Run authentication.

Create `visualguard.config.mjs` in the application root:

```js
import { defineConfig } from 'visualguard';

export default defineConfig({
  routes: ['/'],
  viewports: { desktop: { width: 1440, height: 900 } },
  ai: { provider: 'none' },
  output: { dir: '.visualguard', keepRuns: 10 },
});
```

Provide URLs through `VISUALGUARD_PRODUCTION_URL` and
`VISUALGUARD_STAGING_URL`, or put `baseURL: { production, staging }` in the config.
Both are required for the default compare mode. Keep passwords and tokens out of
the config; use the existing environment/auth configuration for protected sites.

## 2. Create and run the script

Copy [the complete script](../examples/sdk/visual-check.mjs) to
`scripts/visual-check.mjs` in your application. The essential flow is:

```js
import { runVisualGuard, VisualGuardError } from 'visualguard';

try {
  const result = await runVisualGuard({ failOn: 'review' });
  console.log(result.manifest.summary);
  console.log('Evidence:', result.runDir);
  console.log('HTML:', result.artifacts.html);
  console.log('JUnit:', result.artifacts.junit);
  process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof VisualGuardError ? error.exitCode : 1;
}
```

Run from the application root:

```sh
VISUALGUARD_PRODUCTION_URL=https://production.example.com \
VISUALGUARD_STAGING_URL=https://staging.example.com \
node scripts/visual-check.mjs
```

Use your actual URLs. On Windows, set the variables using your shell or `.env`.
An explicit config path is supported:

```js
const result = await runVisualGuard({ cwd: '/absolute/app/path', configPath: 'config/visualguard.config.ts' });
```

Paths resolve from `cwd` (default: `process.cwd()`), including config, output,
baseline and custom JUnit paths. A config in a subdirectory does not change `cwd`.
With no explicit config, the standard config filenames are discovered. With no
file, defaults plus environment/overrides are used; routes follow normal discovery.

## 3. Use inline configuration or capture one section

```js
const result = await runVisualGuard({
  config: {
    baseURL: {
      production: 'https://production.example.com',
      staging: 'https://staging.example.com',
    },
    routes: ['/checkout'],
    screenshot: { selector: '[data-visualguard="checkout"]' },
    ai: { provider: 'none' },
  },
  failOn: 'review',
});
```

Place `data-visualguard="checkout"` on exactly one visible container on both pages.
Inline `config` skips config discovery; supplying both `config` and `configPath`
is an error. Route overrides, `selector: null` page fallback, masks and baseline
identity work exactly as documented in [section screenshot testing](SECTION-SCREENSHOT-TESTING.md).
Health, accessibility and performance checks remain page-wide.

## 4. Understand results and errors

| Result field | Meaning |
| --- | --- |
| `manifest` | Full structured run: IDs, summary, jobs, findings, captures, diffs and provenance. |
| `runDir` | Absolute directory containing the complete saved evidence. |
| `exitCode` | `0` for a passing completed comparison; `1` when the selected policy fails. |
| `passed` | Whether `exitCode` is zero. A review may pass the default regression policy. |
| `artifacts.manifest` | Absolute `manifest.json` path. |
| `artifacts.html` | Absolute `index.html` path, unless disabled. |
| `artifacts.junit` | Absolute JUnit path, unless disabled. |
| `artifacts.githubSummary` | Summary file path when explicitly enabled. |

The default `failOn: 'regression'` fails regressions and error jobs. Use `'review'`
to fail review results too; `'any'` has the same current failing statuses as
`'review'`. Incomplete evidence also fails. Check both summary and policy when
presenting results: `passed` does not mean every job has status `pass`.

A completed run with a visual difference or a capture-error job returns a result.
Invalid configuration, unavailable browsers/URLs, cancellation and report-writing
failures reject the promise. `VisualGuardError` exposes an `exitCode` and optional
`hint`; other errors may be ordinary Node.js errors. Do not catch an exception
and accidentally leave CI successful. The SDK never calls `process.exit`, changes
`process.exitCode`, opens a report window, uploads evidence or publishes a release.

## 5. Reports, diffs and progress

HTML and JUnit are generated by default. The SDK is quiet unless you add a
progress callback or reporter:

```js
const result = await runVisualGuard({
  reports: {
    html: true,
    junit: 'test-results/visualguard.xml',
    githubSummary: Boolean(process.env.GITHUB_STEP_SUMMARY),
    reportURL: process.env.VISUALGUARD_REPORT_URL,
  },
  onEvent(event) {
    if (event.type === 'job:end') console.log(event.job.name, event.job.status);
  },
});
```

`junit: true` (default) writes `junit.xml` in the run directory. Set `html: false`
or `junit: false` to omit that output; the manifest and evidence are still saved.
`githubSummary: true` requires `GITHUB_STEP_SUMMARY` and appends a Markdown summary
without a GitHub token. `reportURL` is a link to a report you have hosted yourself;
it does not upload or serve the report. GitHub summaries do not embed private
diff images automatically. Custom `reporters: [terminalReporter()]` can add terminal
output. Final reporter callbacks are awaited; a failure rejects the SDK call.
Config-file `reporters` settings are CLI settings; SDK reporters are selected with
the SDK's `reports` and `reporters` options.

Progress callbacks are synchronous observers. Their exceptions are ignored so
display code cannot break capture. Do not pass an async progress callback; use
an awaited custom reporter `onRunEnd` for final asynchronous delivery.

Screenshot, DOM, diff and crop paths in `manifest.jobs` are relative to `runDir`.
Some jobs have no diff image (for example a failed capture). Join an existing
path with `runDir` to read it. The report references these images: retain the
**whole run directory**, not just `index.html`. Serve it through an authenticated
static host when needed, or download the CI artifact and use the CLI report flow.
Normal `output.keepRuns` retention applies; use separate output directories for
parallel SDK invocations and upload evidence before a later run can prune it.

## 6. Baseline mode

Set `mode: 'baseline'`, provide `baseURL.staging`, and configure
`baseline: { dir: 'visualguard/baselines' }` in your file or inline config.
Create or intentionally refresh references with:

```js
const result = await runVisualGuard({ updateBaselines: true });
process.exitCode = result.exitCode;
```

Then call `runVisualGuard()` without that flag for comparisons. Missing baselines
fail by default. Updates are explicit and rejected in compare mode; existing
approved-baseline protections still apply. Do not automatically update references
in every CI run or you lose the comparison. Store trusted baselines and their
metadata/DOM/health sidecars in version control or durable storage and restore
them before capture. The SDK does not promote approved baseline sets or provision
GCS storage. Keep browser, OS and viewport consistent between baseline creation
and CI; incompatible references need deliberate regeneration.

## 7. Configure GitHub Actions

1. Install the dependencies locally and commit the lockfile, config and script.
2. Copy [the workflow example](../examples/sdk/github-actions.yml) to
   `.github/workflows/visual-sdk.yml` in your application repository.
3. In GitHub repository settings, create Actions variables
   `VISUALGUARD_PRODUCTION_URL` and `VISUALGUARD_STAGING_URL`. Use deployed URLs
   reachable by GitHub-hosted runners; private networks need appropriate runner
   access. A PR event does not automatically create or select a preview URL.
4. Run the workflow manually from Actions, or open a pull request. It installs
   dependencies and Chromium, executes the SDK script, and uploads evidence even
   when the comparison step fails. It does not run application deployment.
5. Read the job summary, then download the evidence artifact for the HTML report,
   production/staging screenshots, diffs and JUnit XML. Reports appear only if a
   run reached that stage; setup failures may have no evidence. JUnit is a file,
   not an automatically published GitHub Checks test-results view.

The example uses npm and Node 24. For pnpm/yarn, change installation and cache
steps to match your committed lockfile. `include-hidden-files: true` is necessary
because the default evidence folder is `.visualguard`. Keep that folder dedicated
to evidence: screenshots/DOM/reports can contain application data. Choose access
and retention accordingly. Custom JUnit paths outside it need a separate artifact
upload. Existing baseline directories are not automatically cached or approved.

The example has manual and pull-request triggers. For daily Cloud Run/GCS runs,
follow the separate [daily CI plan](DAILY-CI-CLOUD-RUN-GCS-PLAN.md) for scheduling,
authentication, persistence and report hosting; the SDK does not implement those
cloud resources. No external CI deployment is claimed by the local example tests.

## 8. Environment, overrides and cancellation

The SDK copies `env` (default: `process.env`), then loads `.env` and `.env.local`
into that copy. Existing values win; `.env.local` overrides `.env` for values not
already supplied. Set `loadEnv: false` to disable files. `env: {}` isolates
resolution from process variables but still loads files unless disabled.
Explicit `overrides` win over environment and config, using the same resolution
rules as the CLI. Supported overrides include production/staging URLs, routes,
selected viewports, output directory, browser, concurrency and AI provider/model.

The SDK does not mutate your supplied object or `process.env`. Config files and
hooks are executable Node.js code: their own reads of `process.env` observe the
real process environment, not the SDK copy. Prefer declarative config plus SDK
`env`/`overrides`; if your config reads environment files itself, load those into
the process before importing it using the existing low-level `loadEnvFiles` helper.

Pass `signal: controller.signal` from an `AbortController`. The complete example
handles SIGINT/SIGTERM and removes listeners. You can also pass
`AbortSignal.timeout(120_000)`. Cancellation rejects; do not treat leftover partial
evidence as a successful report. Caller-owned servers still need caller cleanup.
Core cancellation checkpoints apply; cancellation is not a hard deadline for all
configuration/discovery or synchronous report work.

Additional execution options are `ai` (including `false` to disable analysis),
`aiCache`, `debug`, `shard: { index, total }` and `runGroup`. Shard indexes start at
one; use a common nonempty run group across machines (automatic from GitHub run
metadata when available). A successful shard is only that shard's result, not a
complete suite verdict. Keep separate shard evidence and use the existing CLI
merge flow to verify completeness before deciding the final suite outcome.

## Troubleshooting and verification

| Symptom | Check |
| --- | --- |
| `runVisualGuard` is not exported | Install/build a release containing the SDK; inspect `npm ls visualguard`. |
| Missing URLs/config | Check `cwd`, `configPath`, and actual CI variables. Inline config skips file discovery. |
| Browser launch fails | Install matching Playwright browser binaries and Linux dependencies on that runner. |
| Review result but CI passes | Select `failOn: 'review'` and assign `process.exitCode = result.exitCode`. |
| No report after a failure | Setup/cancellation errors reject before report completion; inspect the script error. |
| HTML has no screenshots | Download/upload the full run directory with images and preserve relative paths. |
| No GitHub summary | Enable `reports.githubSummary` only with a valid `GITHUB_STEP_SUMMARY`. |
| Baseline mismatch | Restore all sidecars, match rendering identity and keep section/page references separate. |

Verify once with matching pages (pass), once with a deliberate visual change
(`failOn: 'review'` fails), and once with an invalid section (error result).
Inspect JSON, JUnit and actual report screenshots. The SDK is a Node.js API for
scripts and runners; use `visualguard/playwright` for fixture checks, and the
documented dashboard entry point for hosted evidence operations.
