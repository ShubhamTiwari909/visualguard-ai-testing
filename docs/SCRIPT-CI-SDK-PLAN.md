# Script and CI SDK implementation plan

## Goal

Offer a supported `runVisualGuard(options)` function from the existing `visualguard`
package. Scripts and CI should be able to load a config or supply one inline, execute
the same comparison engine as the CLI, retain reports and screenshots, and decide
their own process exit status. Keep the existing low-level API and CLI compatible.

## Scope and sequence

1. Add a typed, quiet-by-default SDK wrapper. Resolve paths against an explicit
   working directory; validate inline configuration and reject conflicting config
   sources. Reuse existing configuration precedence, URL validation, capture,
   section selectors, baseline identity, failure policy and cancellation support.
2. Return the manifest, run directory, policy-derived exit code, passed flag and
   absolute report paths. Generate HTML and JUnit by default; make GitHub summary
   output explicit. Allow existing reporters and a progress callback. Never call
   `process.exit`, open a browser UI, publish evidence, or change process environment.
3. Support baseline comparisons with explicit snapshot updates. Reject updates in
   compare mode, invalid failure policies and invalid shard assignments before
   capture. Keep interrupted/failed operations as rejected promises; completed
   comparisons, including regressions and capture-error jobs, return their verdict.
4. Document setup, inline/file config, section capture, reports/diffs, baseline
   persistence, CI artifacts, cancellation, environment behavior and limitations in
   both repository docs and the Astro programmatic API guide. Include a runnable
   JavaScript script and a manual/PR GitHub Actions example.
5. Validate behavior with focused SDK tests against local pages, then build and
   verify the exported SDK from the built package. Check documentation consistency.

## Boundaries

This feature is a Node.js SDK in the current package, not an HTTP client or MCP
server. It does not add dashboard publishing, cloud storage provisioning, a hosted
runner, scheduling, or baseline promotion. Callers own application startup, CI
credentials, artifact retention and process exit handling. Concurrent invocations
should use distinct output/baseline directories; existing core retention and
cancellation semantics apply.

Environment files populate an SDK-owned copy of the supplied environment (or the
process environment), with existing values taking precedence. Config modules and
user hooks still execute as normal Node.js code and observe the actual
`process.env`; the SDK must document this distinction rather than mutate global
state. HTML reports reference screenshot/diff files, so CI uploads must retain the
entire run directory.

## Delivery

Commit this plan first, then keep SDK implementation, focused tests, docs, example
and a minor changeset together in one feature commit. Formatting, lint and standalone
type checks remain deferred under the repository instructions. A package build may
emit the public declarations required by consumers.
