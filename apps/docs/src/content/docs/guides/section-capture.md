---
title: "Capture a single section"
description: "Mark a section with a data attribute and compare only that element using global or per-route settings."
audience: "developer"
docType: "tutorial"
channel: "both"
lastReviewed: "2026-10-21"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/config/urls.ts", "packages/visualguard/src/core/jobs.ts", "packages/visualguard/src/capture/capture.ts", "packages/visualguard/src/capture/dom-snapshot.ts", "packages/visualguard/src/playwright/index.ts"]
sidebar: {"order": 6}
---

Use section capture when you want to compare a checkout panel, header, pricing table, or another part of a page. VisualGuard still opens the page in a real browser, but saves and visually compares only the selected element's rectangle.

Use a package release or source checkout that includes `screenshot.selector`. Before using it from npm, check that your installed release includes this feature; earlier published packages do not support it. An older release can ignore an unknown configuration field, so confirm the saved screenshot dimensions when adopting this setting.

## Before you start

- [Install VisualGuard](/start/install/) or use the [local source setup](/contributing/local-setup/) containing this feature.
- Have reachable reference and candidate URLs, or use [local baselines](/guides/local-baselines/).
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

## 3. Run and verify

```sh
npx visualguard test
npx visualguard report
```

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

## 5. Use saved baselines or interactive states

Section capture also works with `mode: "baseline"`. Create section references explicitly with `npx visualguard test --update-baselines`. Changing from a page to a section, or changing the selector, requires new matching references. Do not rename an old full-page PNG to reuse it as a section baseline.

In a [Playwright test](/guides/playwright/), a global `screenshot.selector` applies to both the current page and its reference. Override it per check with `selector`:

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
- Section capture takes precedence over `screenshot.fullPage`. A section taller than `screenshot.maxHeight` causes an error; increase that limit deliberately or select a smaller element. Element screenshots show the container's visible rectangle, including clipping by its own scrollable content; they do not expand an inner scrolling area to expose all its contents.
- Existing stabilization, masks, hides, retries, and noise-map recaptures still apply. Hiding or masking the whole target makes the check unhelpful; mask only dynamic descendants.
- DOM explanations cover the selected subtree and use coordinates relative to the screenshot. Moving the entire container elsewhere on the page is outside the visual scope of this check. Changes to the container's own size or its content remain visible.
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

## Next steps

Use [stable captures](/guides/stable-captures/) to handle dynamic content, [routes](/guides/routes/) for route selection, and [reports](/guides/reports/) to inspect evidence.
