---
title: "Scan URLs without a config"
description: "Compare two URLs or scan one site without writing a configuration file, and understand how snapshots change."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/cli/commands/zero-config.ts", "packages/visualguard/src/core/run.ts"]
sidebar: {"order": 1}
---

A zero-config command is the fastest way to inspect a reachable page. It uses the same browser and comparison engine as a configured test. You still need the installed package and browser; “zero config” does not mean zero dependencies.

## Before you start

[Install VisualGuard and Chromium](/start/install/). Run these commands from the folder where you installed the package. Both sites must be reachable from this machine. To try the examples locally, keep the [quickstart demo](/start/quickstart/) running on ports 4100 and 4101.

Examples use `--no-ai` so no AI service is contacted. Replace the demo addresses with your real sites when ready.

## Compare two pages

```sh
npx --no-install visualguard http://127.0.0.1:4100/ http://127.0.0.1:4101/ --no-ai
```

The first address is the reference; the second is the candidate. The demo differs by one button color. Open the saved report separately:

```sh
npx --no-install visualguard report
```

Stop the report server with Ctrl+C before using that terminal again. A bare origin can discover linked routes; a URL with a path selects that page. A trailing `/` at the root is still a bare origin.

## Compare pages with different paths

These example addresses must exist in your app:

```sh
npx --no-install visualguard https://shop.example.com/pricing https://preview.example.com/plans --no-ai
```

That compares `/pricing` with `/plans`. If only one address has a page path, VisualGuard uses that path on both sites. Include query strings inside quotes when needed so your shell does not interpret `&`.

## Scan one site

```sh
npx --no-install visualguard http://127.0.0.1:4101 --no-ai
```

On the first scan, VisualGuard saves snapshots for the selected/discovered pages. It still checks page health; creating the first reference is not proof the site is correct. A later scan compares with those snapshots and updates them. This rolling scan behavior differs from explicit [local baseline mode](/guides/local-baselines/), which keeps reference updates under your control.

Zero-config discovery checks sitemaps and links and limits the scope to 25 routes by default. Missing or protected routes may need an explicit URL or [configured discovery](/guides/routes/). Inspect the run to see what was actually captured.

## Reuse settings when needed

A config can still supply viewports, capture stabilization, authentication and AI settings to positional URL commands:

```sh
npx --no-install visualguard http://127.0.0.1:4100 http://127.0.0.1:4101 --config visualguard.config.ts --viewport desktop --no-ai
```

Only use `--viewport desktop` if that viewport exists in the selected config. Use `--only '/pricing'` to filter an existing scope; this flag does not create a missing route. Run `npx --no-install visualguard --help` for the positional command's options. Options of `visualguard test`, such as its route-listing mode, are not automatically available to the positional command.

## AI and privacy

Without a config, an available `GEMINI_API_KEY` can enable Gemini automatically. Always pass `--no-ai` when you want deterministic-only analysis. API keys, application sessions and screenshots belong on the capture machine; a public report may contain private page content. See [AI policy](/guides/ai-policy-and-budgets/) before enabling a provider.

## Check the result

Open the report and confirm the final page URL, captured route/viewport and findings. Repeat the changed-page comparison, then the same address on both sides to inspect an unchanged control. Use a fresh disposable folder if you want an isolated first-scan reference instead of replacing evidence from a previous trial.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No meaningful difference | Both URLs may serve the same build, login page or error page. Inspect the actual screenshots. |
| Too many or too few pages | A root URL permits discovery; a page URL scopes the comparison. Use a config for a stable explicit suite. |
| A second scan no longer flags a change | Scans roll snapshots forward; use explicit baselines for controlled approval. |
| Connection or browser error | Keep both app servers running, install Chromium and use the same machine/network as the command. |

## Next steps

[Create a repeatable project config](/guides/configuration/), [select routes](/guides/routes/), or [save controlled baselines](/guides/local-baselines/).
