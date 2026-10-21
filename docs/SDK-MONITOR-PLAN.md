# SDK monitor support

## Goal

Let a daily script replace the CLI monitor invocation with `runVisualGuard`,
without changing rolling snapshots, compatibility checks or baseline health
comparisons. Keep cloud storage, completion markers, execution records and
notifications in the application's existing orchestration.

## Implementation

1. Extract the monitor site's selection and engine options into an internal helper
   shared by the CLI and SDK. Prefer production, fall back to staging, and capture
   that one live site. Preserve CLI snapshot paths and monitor update settings.
2. Add `monitor: true | { dir?, update?, reset? }` to the SDK. With `true`, use the
   CLI's `config.monitor.dir/<host>` path. An explicit SDK `dir` denotes the exact
   snapshot folder, resolved against `cwd`, for integrations that pull/push that
   folder to durable storage. Return its absolute path as `result.snapshotDir`.
3. Always enable baseline health comparison. Use `unless-regression` unless the
   explicit setting or config selects `always`; make reset deliberate. Reject
   conflicting `updateBaselines` and malformed monitor options before capture.
   Normal incompatible references must fail rather than being overwritten.
4. Keep the SDK's HTML, JUnit, job summary, manifest, run folder, exit code,
   reporters and cancellation behavior. Do not add GCS, Zapier or Teams clients.
5. Test first-run initialization, repeated regressions, advancing healthy/review
   snapshots, known/new broken images, incompatible capture settings, explicit
   resets, CLI path parity, and reports. Add a daily orchestration example showing
   callers using the returned result directly for publishing and notification.
6. Update both repository and Astro guides. Distinguish rolling monitor snapshots
   from approved/fixed baselines, explain durable storage and failure handling,
   and state that 3.4.0 does not contain this new option. Add a minor changeset;
   do not publish or change the prepared release history.

## Delivery and checks

Commit this plan first. Keep implementation, focused behavior tests, examples,
docs and changeset in one feature commit on `codex/sdk-monitor`. Use focused
monitor/SDK tests, the package build and documentation checks for validation.
Keep the previous CLI/offline flows compatible. No external CI deployment or
cloud/notification delivery is implied by the local tests.
