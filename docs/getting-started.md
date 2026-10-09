# Getting started with VisualGuard

VisualGuard compares your production site with staging, explains every visual difference it finds,
and can fix the regressions for you.

![VisualGuard testing a site in the terminal, then the HTML report showing a regression, a colour change with ignored dynamic content, and an explained alignment change](assets/demo.gif)

This page gets you from nothing to a first report in a few minutes. Everything else is in the
[full reference](../packages/visualguard/README.md).

## Try it in one command

You need Node.js 22.12 or newer and a Playwright browser:

```bash
npx playwright install chromium
```

Scan one site. VisualGuard finds the routes (`sitemap.xml`, then links), captures them, checks
their health and saves snapshots. The next scan compares against them:

```bash
npx visualguard https://example.com
```

Or compare production with staging. Routes are discovered from the first URL:

```bash
npx visualguard https://example.com https://staging.example.com
```

Then open the report:

```bash
npx visualguard report
```

No config file needed. You get side-by-side screenshots, a diff image and a plain-language
reason for each difference.

## Add it to your project

Install VisualGuard and Playwright as dev dependencies:

```bash
npm install -D visualguard playwright
npx playwright install chromium
```

Set it up. `init` asks for your URLs and writes `visualguard.config.ts`:

```bash
npx visualguard init
```

Run the comparison and open the report:

```bash
npx visualguard test
npx visualguard report
```

A minimal config looks like this:

```ts
// visualguard.config.ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://example.com",
    staging: "https://staging.example.com",
  },
  routes: ["/", "/pricing", "/checkout"],
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  },
});
```

Want to test your local dev server? Override staging for one run:
`npx visualguard test --staging http://localhost:3000`. Run `npx visualguard doctor` if something
doesn't connect.

## How it works

1. **Capture both sides in a stable way.** Animations and transitions are off, the page clock is
   paused, fonts are loaded, and the page is scrolled through so lazy content loads. Screenshots
   are taken until two in a row match.
2. **Diff the pixels, minus dynamic content.** When a page differs, the reference side is loaded a
   second time and whatever changes between those loads (a carousel, a timestamp, an ad) is left
   out of the diff. You can also mark elements with `data-visualguard-ignore`.
3. **Explain each difference.** Changed regions are mapped to the DOM: computed styles, text,
   position, added or removed elements. Optionally, an AI provider (Gemini or Ollama) classifies
   what's left. It sees crops of the changed regions and the DOM changes, never your source code.
4. **Give every page a status.** `pass`, `review` (a change worth a look), `regression` (missing
   controls, overlaps, low contrast, broken images, overflow, HTTP errors) or `accepted` (a change
   you marked as intentional).
5. **Write an HTML report** with side-by-side, slider, onion-skin and diff views. It's a single
   run directory, so you can upload it as a CI artifact.
6. **Fix regressions, if you want.** `visualguard fix` proposes an edit, shows you the diff, asks
   before changing anything, and checks the result against production.

## What you get

| Feature                               | Command or setting                                  |
| ------------------------------------- | --------------------------------------------------- |
| Explanations without AI               | On by default, or `--no-ai` to skip AI              |
| AI analysis                           | `ai: { provider: "gemini" }` or `"ollama"`          |
| Accept intentional changes            | `visualguard accept /pricing` (or `--all`)          |
| Propose and verify fixes              | `visualguard fix` with `fix: { enabled: true }`     |
| Re-test on save against your dev site | `visualguard watch`                                 |
| Compare with committed screenshots    | `mode: "baseline"`, `test --update-baselines`       |
| Nightly checks of the live site       | `visualguard monitor` (`--workflow` for a schedule) |
| Accessibility and performance checks  | `--a11y` `--perf`, or `checks` in the config        |
| Split large sites over several jobs   | `test --shard 2/4`, then `visualguard merge`        |
| Checks inside your Playwright tests   | `import { test } from "visualguard/playwright"`     |
| Logged-in pages                       | `visualguard auth staging`                          |

## Run it on pull requests

`npx visualguard init --workflow` also writes `.github/workflows/visualguard.yml`. It runs the
tests, uploads the report as an artifact, posts one sticky comment on the PR (updated on every
push) and fails the job if there are regressions. The workflow needs `pull-requests: write`.

If each PR gets a preview deployment (Vercel, Netlify…), pass its URL as staging:

```yaml
env:
  VISUALGUARD_STAGING_URL: ${{ github.event.deployment_status.environment_url }}
```

Prefer a single step? Use the GitHub Action:

```yaml
- uses: ShubhamTiwari909/visualguard-ai-testing/action@v1
```

## Inside Playwright tests

Already have Playwright tests that log in and click around? Check the page they leave you on:

```ts
import { expect, test } from "visualguard/playwright";

test("checkout summary", async ({ page, visualguard }) => {
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Apply coupon" }).click();
  await visualguard.check(page, { name: "after-coupon" });
});
```

`check` captures the same path on `baseURL.production` (or compares with a stored baseline),
explains the difference, attaches the screenshots to the Playwright report and fails the test on a
regression.

## Next steps

- [Commands](../packages/visualguard/README.md#commands) and
  [configuration](../packages/visualguard/README.md#configuration)
- [Explanations, with or without AI](../packages/visualguard/README.md#explanations-with-or-without-ai)
- [Fixing regressions](../packages/visualguard/README.md#fixing-regressions)
- [CI and pull requests](../packages/visualguard/README.md#ci-and-pull-requests), including
  sharding and the GitHub Action
- [Monitoring production](../packages/visualguard/README.md#monitoring-production) and
  [baseline mode](../packages/visualguard/README.md#baseline-mode)
- [How captures stay stable](../packages/visualguard/README.md#how-captures-stay-stable)
- [visualguard on npm](https://www.npmjs.com/package/visualguard)
- Found a bug or have a question?
  [Open an issue](https://github.com/ShubhamTiwari909/visualguard-ai-testing/issues).
