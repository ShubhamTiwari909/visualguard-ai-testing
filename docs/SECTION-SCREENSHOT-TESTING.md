# Section screenshot testing with data attributes

Use section capture when you want to compare a checkout panel, header, pricing table, or another part of a page. VisualGuard still opens the page in a real browser, but saves and visually compares only the selected element's rectangle.

Use a package release or source checkout that includes `screenshot.selector`. Before using it from npm, check that your installed release includes this feature; earlier published packages do not support it. An older release can ignore an unknown configuration field, so confirm the saved screenshot dimensions when adopting this setting.

## Before you start

- [Install VisualGuard](../apps/docs/src/content/docs/start/install.md) or use the [local source setup](../apps/docs/src/content/docs/contributing/local-setup.md) containing this feature.
- Have reachable reference and candidate URLs, or use [local baselines](../apps/docs/src/content/docs/guides/local-baselines.md).
- Choose an element that exists on both versions at the selected viewport. Give it a unique, stable attribute and a visible, nonempty layout box.

## 1. Mark your section

Add an attribute to the actual container you want to capture:

```html
<section data-visualguard="checkout">
  <h2>Order summary</h2>
  <button>Pay now</button>
</section>
```

The same markup works in React JSX. The attribute name is your choice: `[data-testid="checkout"]` or `[data-section="checkout"]` also works. VisualGuard uses a CSS selector; it does not automatically discover all marked elements.

`data-visualguard="checkout"` is an ordinary HTML attribute, used by your configured selector. You do not need to import a browser library or initialize anything in the application. This is different from `data-visualguard-ignore`: that existing attribute masks or hides dynamic content instead of selecting a section to test.

Use a container with a normal layout box. `display: contents` and zero-size wrappers cannot define a useful screenshot. Give repeated cards different attribute values or use a selector that identifies exactly one card. Deploy the attribute on both environments before comparing them.

## 2. Configure the selector

In `visualguard.config.ts` in your application root:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://shop.example.com",
    staging: "http://localhost:3000",
  },
  routes: ["/checkout"],
  screenshot: {
    selector: '[data-visualguard="checkout"]',
  },
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844 },
  },
  ai: { provider: "none" },
});
```

Replace the URLs with your own. Start the candidate application before running the test. The global selector applies to every configured or discovered route, so every selected route must contain exactly one matching element.

For a package installation, complete the [npm setup](NPM-PACKAGE-SETUP.md#2-install-and-run-your-first-test) first: install `visualguard` and `playwright`, install Chromium, and create the config in the application root. Use a release that contains this feature. No dashboard, database, or extra AI key is needed.

## 3. Run and verify

Check the config and preview the planned jobs first. Preview lists jobs without checking whether the section exists; matching the selector happens during capture.

```sh
npx --no-install visualguard doctor
npx --no-install visualguard test --list
npx --no-install visualguard test --no-ai
npx --no-install visualguard report
```

Use the locally installed package to avoid accidentally downloading a different release. If your config file has another name or location, pass `--config PATH` to each command. For a source build, replace `npx --no-install visualguard` with `node packages/visualguard/dist/cli.js` from the VisualGuard repository root, after building the package.

Open the reference and candidate screenshots. They should contain only the checkout container, with dimensions matching its rendered box. There should be one check per configured route and viewport. Section jobs have a selector-derived suffix in their IDs, keeping their saved references separate from page captures.

Change something outside the container and rerun: its pixels should not affect the section diff. Change text, spacing, or color inside it and rerun: the section should show that difference. A page-wide health failure can still fail the check; see the scope below.

## 4. Choose different sections per route

Put `screenshot.selector` on a route object to override the global selector. Use different entries and names to capture several sections of one page:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://shop.example.com",
    staging: "http://localhost:3000",
  },
  routes: [
    { path: "/", name: "Header", screenshot: { selector: '[data-visualguard="header"]' } },
    { path: "/", name: "Pricing", screenshot: { selector: '[data-visualguard="pricing"]' } },
    { path: "/contact", name: "Contact page", screenshot: { selector: null } },
  ],
  screenshot: { selector: '[data-visualguard="main"]' },
  ai: { provider: "none" },
});
```

Each section has its own job, screenshots, comparison, and baseline. `selector: null` on `/contact` restores the normal page screenshot settings. If a route omits the selector override, it inherits the global selector. If neither is configured, page capture works as before. Explicit route settings also work in `routes.extra` when using discovery.

Use `--only /checkout` to filter existing route entries while preserving their section settings. `--route /checkout` replaces the configured route entries, so per-route selectors are lost and only the global selector can apply. Do not expect either flag to discover every marked section automatically.

## 5. Use saved baselines or interactive states

Section capture also works with `mode: "baseline"`. Create section references explicitly with `npx visualguard test --update-baselines`. Changing from a page to a section, or changing the selector, requires new matching references. Do not rename an old full-page PNG to reuse it as a section baseline.

For example, keep the same routes and selector and add these settings to your configuration:

```ts
mode: "baseline",
baseline: { dir: "visualguard/baselines" },
```

With the application running at `baseURL.staging`, create the intended references and then compare a later capture:

```sh
npx --no-install visualguard test --update-baselines --no-ai
npx --no-install visualguard test --no-ai
```

Inspect and commit the intended baseline files with your normal review process. Do not update baselines on every CI run, because that would replace the reference you need to compare against. Without a matching baseline, the default policy fails instead of automatically accepting the new section.

In a [Playwright test](../apps/docs/src/content/docs/guides/playwright.md), a global `screenshot.selector` applies to both the current page and its reference. Override it per check with `selector`:

```ts
await visualguard.check(page, {
  name: "Open checkout",
  selector: '[data-visualguard="checkout"]',
  referenceSetup: async (reference) => {
    await reference.getByRole("button", { name: "Open checkout" }).click();
  },
});
```

Open the checkout on the test page before calling this check. `referenceSetup` opens it on the reference side. Pass `selector: null` to capture the page for one check. Route-object settings belong to CLI route planning; fixture checks use the global setting or their explicit `selector` option.

## Capture scope and limits

- The selector must be valid CSS and match exactly one visible element in the main document on each side. Missing, hidden, empty, or ambiguous targets cause a capture error. There is no fallback to a page screenshot. Waits use `browser.actionTimeoutMs` (15 seconds by default).
- A global `screenshot.selector` must be a nonblank string. `null` is supported only as a route override or a Playwright check override; omit the global selector to use normal page capture.
- Section capture takes precedence over `screenshot.fullPage`. A section taller than `screenshot.maxHeight` causes an error; increase that limit deliberately or select a smaller element. Element screenshots show the container's visible rectangle, including clipping by its own scrollable content; they do not expand an inner scrolling area to expose all its contents.
- Existing stabilization, masks, hides, retries, and noise-map recaptures still apply. Hiding or masking the whole target makes the check unhelpful; mask only dynamic descendants.
- DOM explanations cover the selected subtree and use coordinates relative to the screenshot. Moving the entire container elsewhere on the page is outside the visual scope of this check. Changes to the container's own size or its content remain visible.
- Verified fixes share a repair goal across viewports of the same section. An unrelated section on the same route must retain its captured candidate appearance unless it is also fixed; unexpected collateral changes still cause a rollback. A container hidden by a fully transparent parent is rejected instead of producing blank evidence.
- Navigation, failed requests, console errors, broken-image checks, horizontal overflow, and optional accessibility/performance checks remain page-wide. Selecting a section does not turn these into section-only checks.
- Overlays covering the section can appear in its screenshot. Close or hide unrelated overlays with your usual capture hooks. Embedded frames and shadow-root-only targets are outside this initial selector workflow.
- This configuration is available to CLI runs and Playwright checks. The dashboard's saved project-settings form does not yet expose a section-selector field; run using the config file and publish the evidence through the existing CLI workflow.

## Troubleshooting

| Symptom | Check and fix |
| --- | --- |
| Target is missing | Inspect both URLs, authentication state, route, and viewport. Add the attribute to both environments and ensure the UI state is open. |
| More than one element matches | Give the container a unique attribute value, or narrow the CSS selector. Hidden duplicates also make a selector ambiguous. |
| Target is invisible or empty | Check conditional rendering, `display`, `visibility`, `opacity`, dimensions, and whether a parent hides it. |
| The target appears too late | Use `waitFor`, a capture hook, or increase `browser.actionTimeoutMs` to wait for expected content. |
| A full page was captured | Check your installed version supports the feature, the config file was loaded, and a route did not set `selector: null`. |
| A baseline is missing or incompatible | Explicitly generate the intended section references; do not reuse page references. |
| An unrelated failure remains | Inspect page-wide health/accessibility/performance findings separately from the section's visual diff. |

## Where results are saved

With the default output settings, each run lives under `.visualguard/runs/<run-id>/`. Its `manifest.json` identifies each section job and retains the effective selector in `capturePolicy.screenshot.selector`. Each job's artifact folder contains its reference/candidate PNGs and available DOM/diff evidence. DOM boxes are relative to the cropped image.

Use the report to locate the correct section and viewport; do not compare images from different jobs just because their source page is the same. A source-backed run or installed release supporting this feature is required. The setup wizard and dashboard saved-settings form do not generate these selectors automatically.

## Source checkout: try the existing demo section

This example uses a section already marked with `data-testid="hero"`, so no fixture changes are required. First follow [local setup sections 1–3](LOCAL-SETUP.md#3-try-the-demo-without-a-dashboard): install dependencies and Chromium, build the CLI, start both demo sites, and create `output/local-demo.json`. Keep the demo servers running.

From the VisualGuard repository root, copy that config into a section-specific file:

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(readFileSync("output/local-demo.json", "utf8"));
config.routes = ["/color-change"];
config.screenshot = { selector: '[data-testid="hero"]' };
writeFileSync("output/section-demo.json", JSON.stringify(config, null, 2) + "\n");
JS
```

Check and run the source build with this explicit config:

```sh
node packages/visualguard/dist/cli.js doctor --config output/section-demo.json
node packages/visualguard/dist/cli.js test --config output/section-demo.json --list
node packages/visualguard/dist/cli.js test --config output/section-demo.json --no-ai
node packages/visualguard/dist/cli.js report --config output/section-demo.json --no-open
```

Open the printed report URL. The images should contain only the hero card and show its changed button. The header, other cards, and footer should be outside the screenshots. Use the same selector on both environments; VisualGuard resolves it independently, so the container can occupy a different page position on each side.

A Review result is an expected visual finding for this demo. Whether it produces a nonzero process exit depends on the failure policy. A capture Error instead requires investigation; do not replace a missing section with a page screenshot or accept a new baseline to hide it.

## Next steps

Use [stable captures](../apps/docs/src/content/docs/guides/stable-captures.md) to handle dynamic content, [routes](../apps/docs/src/content/docs/guides/routes.md) for route selection, and [reports](../apps/docs/src/content/docs/guides/reports.md) to inspect evidence.
