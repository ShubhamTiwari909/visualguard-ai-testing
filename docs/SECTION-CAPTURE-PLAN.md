# Section capture

## Goal

Let users capture and compare a marked section instead of the whole page. A CSS selector such as `[data-visualguard="checkout"]` selects the same section independently on production and staging.

## Configuration and behavior

- Add optional `screenshot.selector` globally and in route objects. A route overrides the global selector; `selector: null` on a route restores page capture.
- Require exactly one matching, visible, nonempty element. Wait using the configured browser action timeout; report missing, hidden, invalid, or duplicate targets as capture errors. Never fall back to a full-page screenshot.
- Capture the element at CSS pixel scale with existing masks and stabilization. Section capture takes precedence over `fullPage`; reject sections taller than `maxHeight` rather than silently clipping them.
- Allow multiple section entries for one route. Keep their job IDs and baselines distinct. Preserve existing page IDs and rendering identities when no selector is configured.
- Scope DOM evidence to the selected element and express boxes relative to the image. Keep navigation, network, accessibility, performance, and page health checks page-wide and explain this scope in the docs.
- Support the same global setting and an explicit check override in the Playwright fixture. Keep recaptures, noise maps, fixes, and baseline provenance consistent with the selected scope.

## Phases

1. Implement configuration, route expansion, section-aware jobs and baseline identity.
2. Implement element capture, scoped DOM evidence, and shared CLI/fixture paths.
3. Add browser-backed behavior tests for isolated changes, offsets, masks, missing/duplicate/hidden targets, oversize targets, overrides, and baseline isolation. Run focused regressions; do not run formatting, lint, or type checks.
4. Document markup, configuration, setup, baseline migration, limits, and troubleshooting in the Astro site and package guide. Regenerate the configuration reference.

Keep this planning commit separate. Commit implementation, documentation, and focused tests together. Preserve existing offline behavior and leave unrelated local files untouched.
