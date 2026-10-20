---
title: "Make captures repeatable"
description: "Stop animations, clocks, fonts, slow requests, banners and live content from changing screenshots, using stabilize and screenshot settings, masks, hides and hooks."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "npm 3.2.3 / source e2c69cc"
sourcePaths: ["packages/visualguard/src/config/schema.ts", "packages/visualguard/src/capture/capture.ts", "packages/visualguard/src/capture/stabilize.ts", "packages/visualguard/src/capture/browser.ts", "packages/visualguard/src/core/findings.ts"]
sidebar: {"order": 5}
---

A repeatable capture gives the same screenshot every time the page has not changed. Without it, a clock, a carousel or a slow image can make an unchanged page look different. This page explains what VisualGuard does to keep pages still, and the settings you can use for the rest.

Use this page when an unchanged page shows differences, or before you add a page with live data, animation or third-party widgets.

## Before you start

- Have a working config file. See [Configure your project](/guides/configuration/).
- Have one page you can capture twice without changing it. Use it to test each setting.
- Know the CSS selectors of the elements that change on every load, such as a price, a date or a chat button.

## What happens during a capture

You rarely need to change anything, because VisualGuard already does a lot by default. For each page, in this order, it:

1. Opens a fresh browser context, so cookies and storage never leak between pages. Requests that match `blockRequests` are blocked.
2. Installs a controllable clock, and fixes the date if you set `freezeTime`.
3. Runs your `beforeNavigate` hook.
4. Opens the page and waits for the `load` event.
5. Adds CSS that stops animations and transitions, hides scrollbars and the text cursor, and hides the selected elements.
6. Waits for the route's `waitFor` selector, if it has one.
7. Waits for web fonts.
8. Scrolls down the page and back to the top, so lazy content loads.
9. Waits for images to finish loading.
10. Waits until the network is quiet.
11. Runs your `beforeCapture` hook.
12. Pauses videos and SVG animations at their first frame, then pauses the page clock.
13. Takes screenshots until two in a row are the same, with masked elements covered.

If any step fails, VisualGuard tries the whole page again in a new context. It retries 2 times by default.

## 1. Tune the `stabilize` settings

Each step above has a setting. The defaults suit most sites.

| Option | What it does | Default |
| --- | --- | --- |
| `disableAnimations` | Sets CSS animation and transition times to zero. | `true` |
| `freezeTime` | An ISO date such as `"2026-01-01T00:00:00Z"`. The page's `Date` always returns this time. `false` leaves the real time. | `false` |
| `pauseClock` | Pauses JavaScript timers and `requestAnimationFrame` just before the screenshot, so script-driven animations stop. | `true` |
| `pauseMedia` | Pauses videos and SVG animations at their first frame. | `true` |
| `waitForFonts` | Waits for web fonts to load, for up to 5 seconds. | `true` |
| `networkQuietMs` | How long no request may be in flight before the page counts as settled, in milliseconds. WebSocket and event-stream connections are ignored. | `500` |
| `networkQuietTimeoutMs` | The longest wait for a quiet network. After this, the capture continues anyway. | `10000` |
| `scrollToLoad` | Scrolls through the page to load lazy images and sections. | `true` |
| `hideDefaults` | Hides common cookie banners and chat widgets. | `true` |
| `hide` | CSS selectors to make invisible on every page. | `[]` |
| `mask` | CSS selectors to cover with a solid box on every page. | `[]` |
| `blockRequests` | URL patterns that are never loaded, such as `"**/analytics.js"`. | `[]` |
| `retries` | How many more times to try a page after a failure (0 to 5). | `2` |
| `stabilityAttempts` | How many extra screenshots to take while waiting for two identical ones (1 to 10). | `3` |
| `stabilityIntervalMs` | The wait between those screenshots, in milliseconds. | `150` |

`hideDefaults` covers banners and widgets from OneTrust, Cookiebot, Usercentrics, TrustArc, Osano, Cookie Consent, Cookie Law Info, HubSpot, Intercom, Crisp, Drift and Zendesk.

:::tip
Use `freezeTime` when the page shows "today", a countdown or a relative date like "3 days ago". Use the same value on both sites. `pauseClock` alone stops movement but still shows the real date.
:::

## 2. Choose screenshot settings

| Option | What it does | Default |
| --- | --- | --- |
| `screenshot.fullPage` | Captures the whole page height. `false` captures only the visible window. | `true` |
| `screenshot.maxHeight` | The tallest full-page screenshot, in pixels. Longer pages are cut at this height. Scrolling for lazy content also stops here. | `15000` |

A page cut at the maximum height shows "cut at max height" in the report's page health details. Raise `maxHeight` if the bottom of the page matters. Very tall screenshots take longer to compare.

## 3. Mask or hide changing elements

Masking and hiding both stop an element from causing differences. They work differently:

| | `mask` | `hide` |
| --- | --- | --- |
| What the screenshot shows | A solid magenta box (`#FF00FF`) where the element is, on both sides. | Nothing. The element is invisible and the page background shows through. |
| Space in the layout | Kept. | Kept. It uses `visibility: hidden`, so the element still takes up its space. |
| Is the element's position and size still compared? | Yes. If the box moves or changes size, that is a difference. | No. Only the space it leaves is compared. |
| Use it for | Content that changes but whose place matters: a live price, a timestamp, an avatar, an order number. | Things that are not part of your design: a promo bar, a chat launcher, a third-party ad. |

Set them for every page in `stabilize`, or for one page on the route:

```ts
stabilize: {
  mask: ["[data-testid=live-price]", ".relative-time"],
  hide: [".promo-banner"],
},
routes: [
  { path: "/checkout", mask: ["[data-testid=order-id]"] },
],
```

Masked areas keep their size. Mask a container with a fixed size, not text whose width changes. Otherwise the box itself changes size and shows up as a difference.

:::caution
A mask or hide also hides real bugs inside that element. Keep selectors narrow, and never mask a whole section to make a page pass.
:::

### Mark elements in your own markup

If you own the page, mark changing elements with an attribute instead of writing selectors:

```html
<!-- Covered with a solid box, like mask -->
<span data-visualguard-ignore>1,204 people viewing</span>

<!-- Made invisible, like hide -->
<div data-visualguard-ignore="hide">Rotating news ticker</div>
```

The attribute works on every page without any config. Any value other than `"hide"` masks the element.

## 4. Block requests you do not need

`blockRequests` stops matching requests before they leave the browser. Use it for analytics, ads or A/B testing scripts that change the page at random. The patterns are URL globs: `**` matches any part of the URL.

```ts
stabilize: {
  blockRequests: ["**/gtag/js*", "**/optimizely*.js", "https://ads.example.net/**"],
},
```

Blocked requests are not reported as failed requests.

## 5. Use hooks for anything else

Hooks are functions in your config that run inside each capture. Both receive `{ page, env, route, url, viewport }`. `page` is a Playwright page, and `env` is `"production"` or `"staging"`.

```ts
hooks: {
  // Before the page opens: set cookies or local storage.
  beforeNavigate: async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("newsletter-dismissed", "1"));
  },
  // After the page settles, just before the screenshot: close or remove things.
  beforeCapture: async ({ page, route }) => {
    if (route === "/") await page.evaluate(() => document.querySelector(".carousel")?.remove());
  },
},
```

Use `beforeCapture` to remove an element from the layout completely. `hide` keeps the element's space; removing it closes the gap. Remember that the same hook runs on both sites.

## Example: a product page with live data

A shop's product page shows a live stock counter, a "Sale ends in 02:14:09" timer, a review carousel and a chat button. Each run showed small differences on an unchanged page. The team added:

```ts
stabilize: {
  freezeTime: "2026-03-01T09:00:00Z",     // The sale timer now shows the same value.
  mask: ["[data-testid=stock-count]"],    // The counter area is still checked for position.
  hide: ["#support-chat-button"],         // Not part of the page design.
},
hooks: {
  beforeCapture: async ({ page }) => {
    // Always show the first review slide.
    await page.evaluate(() => document.querySelector(".reviews-carousel")?.scrollTo(0, 0));
  },
},
```

The chat button was not in the default list, so it needed its own `hide`.

## Check that captures are stable

Compare a site with itself. Any difference you see is noise, not a change:

```bash
npx visualguard test --production http://localhost:3000 --staging http://localhost:3000 --route /products/blue-mug --no-ai
npx visualguard report
```

You should see the page as `pass`. If it is not:

- Look for the finding "The page kept changing between screenshots; mask or hide animated areas." It means two screenshots in a row never matched.
- Open the report's **Diff** view to see which pixels changed, then mask, hide or freeze that part.
- Run the same command a few times. A stable setup passes every time.

Next, make a small visible change on staging and run again. The change must still appear. If it does not, a mask or hide is too wide.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "The page kept changing between screenshots" | Something is still moving. Mask or hide it, set `freezeTime`, or raise `stabilityAttempts` and `stabilityIntervalMs`. |
| Dates or countdowns differ | Set `freezeTime` to a fixed ISO date. |
| Lazy images are missing at the bottom | Keep `scrollToLoad: true`, raise `screenshot.maxHeight` if the page is long, and add a route `waitFor` for important content. |
| Captures are slow on sites with constant polling | Lower `networkQuietTimeoutMs`, or add the polling URL to `blockRequests`. |
| Text looks different on each run | Fonts were not ready. Keep `waitForFonts: true`, and serve fonts from both sites the same way. |
| A cookie banner still shows | Add its selector to `stabilize.hide`, or set the consent cookie in `beforeNavigate`. |
| A masked box changes size | Mask a fixed-size parent instead of the changing text. |
| `Capture failed after 3 attempt(s)` | Read the error after the colon. It is usually a timeout or a page error. See [Capture troubleshooting](/troubleshooting/capture/). |

## Next steps

- [Tune differences and noise](/guides/diff-and-noise/): decide how much change is allowed and how the noise map works.
- [Choose routes and discovery](/guides/routes/): add `waitFor`, `mask` and `hide` for single pages.
- [Inspect and share reports](/guides/reports/): read the diff and page health details.
- [Configuration reference](/reference/configuration/): every `stabilize` and `screenshot` field.
