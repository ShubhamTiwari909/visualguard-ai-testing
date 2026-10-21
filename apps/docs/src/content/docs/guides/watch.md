---
title: "Watch local development"
description: "Re-test only the pages affected by the files you save, comparing your local dev server with production while you work."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths:
  [
    "packages/visualguard/src/cli/commands/watch.ts",
    "packages/visualguard/src/fixer/verify.ts",
    "packages/visualguard/src/config/schema.ts",
  ]
sidebar: { "order": 14 }
---

This page shows how to use `visualguard watch`. It keeps running while you code. Each time you save a file, it works out which pages use that file, captures just those pages on your local dev server and compares them with production. Use it to see the visual effect of a change within seconds, before you open a pull request.

## Before you start

- Finish [Run your first visual test](/start/quickstart/) so you have a working `visualguard.config.ts` with `baseURL.production` and your routes.
- Know your local dev server's URL, such as `http://localhost:3000`.
- Run commands from your app's root folder, where `visualguard.config.ts` lives.

Watch works with any framework. Tracing a saved file to specific pages works for Next.js apps (pages in `app/` or `pages/`). In other projects, every save re-tests all routes.

## 1. Choose the local site

Watch needs to know which local URL to capture. It uses the first of these that is set:

1. The `--staging <url>` flag.
2. `fix.verify.server.url` in your config.
3. `baseURL.staging` in your config.

The reference is `baseURL.production`. Watch stops with `Set baseURL.production (or use mode: "baseline").` if it is missing. In [baseline mode](/guides/local-baselines/), watch compares with your stored baselines instead.

## 2. Start watching

Start your dev server in one terminal (for example `npm run dev`). In another terminal, run:

```bash
npx --no-install visualguard watch --staging http://localhost:3000
```

You should see:

```text
VisualGuard watch · https://www.example.com vs http://localhost:3000

[10:42:01] Initial run
  ...the usual test output for every route...
Watching for changes… (Ctrl+C to stop)
```

The first run tests every route. After that, save a file. About half a second later you should see a line such as:

```text
[10:43:17] components/Hero.tsx changed → /, /pricing
```

followed by results for just those routes. Open the report for the latest run with `npx --no-install visualguard report` in a third terminal.

Press Ctrl+C to stop watching.

### Let watch start the dev server

If you set `fix.verify.server` and its `url` matches the local site, watch starts the server for you when nothing answers at that URL, and stops it when you press Ctrl+C:

```ts
fix: {
  verify: {
    server: { command: "npm run dev", url: "http://localhost:3000" },
  },
},
```

Then run `npx --no-install visualguard watch` with no flags. You do not need `fix.enabled` for this.

## Which files are watched

Watch uses `fix.include` to decide which files to watch, even when fixing is off. The default is `src/**`, `app/**`, `pages/**`, `components/**`, `styles/**` and `lib/**`. Add your own folders if your code lives elsewhere:

```ts
fix: {
  include: ["src/**", "app/**", "packages/ui/src/**"],
},
```

It ignores `node_modules`, `.next`, `.git`, `.visualguard` and `dist`, and the temporary files editors write (hidden files, `~` backups, `.swp` and `.tmp`).

## How watch picks pages to test

1. It reads the import statements of your source files to build a map of who imports what.
2. For each saved file, it follows importers up to 4 levels, looking for Next.js page files.
3. It re-tests the routes of the pages it found.
4. If any saved file cannot be traced to a page, for example global CSS, a config file or a deeply shared helper, it re-tests **all** routes.

Saves that happen close together are grouped into one run. Saves during a run are queued and tested when the run finishes, so runs never overlap.

## Options

| Flag                  | What it does                               | Default                                         |
| --------------------- | ------------------------------------------ | ----------------------------------------------- |
| `[routes...]`         | Watch only these routes or globs.          | All configured routes                           |
| `--staging <url>`     | Local URL to test.                         | `fix.verify.server.url`, then `baseURL.staging` |
| `--viewport <name>`   | Run only this viewport. Repeat for more.   | All viewports                                   |
| `--provider <name>`   | AI provider: `gemini`, `ollama` or `none`. | From config                                     |
| `--model <id>`        | AI model ID.                               | Provider default                                |
| `--no-ai`             | Skip AI analysis.                          | AI on if configured                             |
| `-c, --config <path>` | Config file path.                          | `visualguard.config.ts`                         |

:::tip
If AI is turned on in your config, every save can cost model calls. Add `--no-ai` while you iterate, and keep a single viewport with `--viewport desktop` for faster feedback.
:::

## Things to know

- **Every run is saved.** Each re-test is a normal run in `.visualguard/runs/`, with its own HTML report. VisualGuard keeps the last `output.keepRuns` runs (default 10), so a busy watch session replaces older runs. Copy any run you want to keep.
- **Accessibility and performance flags are not available.** Turn those checks on in `checks` in your config if you want them during watch.
- **A dev server is not production.** Development builds can show overlays, warnings or different fonts. Hide dev-only elements with `stabilize.hide`, as the [Next.js example](/guides/nextjs-example/) does with `nextjs-portal`.
- **Watch does not accept changes or fix them.** Use [`accept`](/guides/accepting-changes/) or [`fix`](/guides/fixes/) in another terminal.

## Example: restyle a pricing card

You change the padding in `components/PricingCard.tsx` of a Next.js app. Watch prints `components/PricingCard.tsx changed → /pricing` and tests only `/pricing`, because only the pricing page imports that component. The result is **review** with a padding change on the card. You decide it is wrong, undo the change and save again. The next run shows `/pricing` as **pass**.

## Verify watch is working

1. Start watch and wait for `Watching for changes…`.
2. Save a small change in a component that one page uses.
3. You should see a `changed → /your-route` line and a new result for that route only.
4. Save a change in a global stylesheet. You should see `changed → all routes`.

## Troubleshooting

| Problem                                                                | Fix                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Nothing to watch: set fix.verify.server.url or pass --staging <url>.` | Pass `--staging`, or set `fix.verify.server.url` or `baseURL.staging`.                              |
| `Set baseURL.production (or use mode: "baseline").`                    | Add the production URL to your config.                                                              |
| Saving a file does nothing                                             | The file is outside `fix.include`. Add its folder.                                                  |
| Every save tests all routes                                            | The file is not traced to a Next.js page, or your app is not Next.js. Narrow it with `[routes...]`. |
| `Nothing is answering at http://…`                                     | Start your dev server, or set `fix.verify.server.command`.                                          |
| Every page differs from production                                     | The dev build looks different from production. Hide dev-only elements with `stabilize.hide`.        |

See [Capture problems](/troubleshooting/capture/) for more.

## Next steps

- [Next.js example](/guides/nextjs-example/): try watch on a ready-made app.
- [Propose and verify fixes](/guides/fixes/): repair a regression watch found.
- [Stable captures](/guides/stable-captures/): reduce noise between your dev server and production.
- [CLI reference](/reference/cli/): every command and flag.
