---
title: "Select routes and discovery"
description: "Map paths across environments and discover routes with explicit include, exclude and dynamic parameters."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["README.md", "packages/visualguard/src/config/routes.ts", "packages/visualguard/src/config/schema.ts"]
sidebar: {"order": 2}
---

## Before you start

Complete [the first-comparison guide](/start/quickstart/) and keep both tested application environments running. Run commands from your application root, where `visualguard.config.ts` lives. Examples use the locally installed package; `npx --no-install` prevents accidentally running another release. Property fragments below belong inside the existing `defineConfig({ ... })` object. Shell examples use POSIX syntax; use the documented Windows alternative or WSL when shell features are needed.

## Start with explicit routes

Inside your existing config, replace `routes` with this property fragment. Keep only paths that exist in your application:

```ts
routes: [
  '/',
  { path: '/pricing', staging: '/plans' },
  { path: '/blog/[slug]', params: [{ slug: 'hello-world' }] },
  { path: '/checkout', waitFor: '[data-testid=order-summary]', mask: ['[data-testid=order-id]'] },
],
```

Paths begin with `/`; they are not full URLs. `production` and `staging` route overrides let a logical comparison use different paths. Dynamic parameters must resolve to real content. A configured base path is preserved when joining the route; base query parameters apply to each route.

## Discover routes instead

Replace the entire `routes` array with this alternative property fragment:

```ts
routes: {
  discover: ['nextjs', 'sitemap', 'crawl'],
  extra: [{ path: '/blog/[slug]', params: [{ slug: 'hello-world' }] }],
  include: ['/**'],
  exclude: ['/admin/**'],
  limit: 50,
  crawlDepth: 2,
},
```

Next.js discovery reads the tested project's route files; sitemap/crawl need reachable pages. Authenticated or unlinked routes often need explicit entries. Zero-config URL scans limit discovery to 25 routes, while configured discovery defaults to 50. Review discovered pairs before relying on them:

```sh
npx --no-install visualguard test --config visualguard.config.ts --list
npx --no-install visualguard test --config visualguard.config.ts --only '/pricing' --no-ai
```

`--only` filters the configured scope; it is not a promise to invent a missing route.


## Verify the setup

Check the resolved production/candidate URLs for every dynamic/mapped route. Capture one representative pair, including any query parameters or base path.

## Troubleshooting

If a step fails, check the installed version and exact working directory first. Run `npx --no-install visualguard doctor --config visualguard.config.ts` for capture prerequisites. [Find the matching symptom](/troubleshooting/). Do not interpret a failed/review verdict as an installation failure.

## Next steps

[Continue to the related reference](/reference/cli/). Stop foreground report servers with Ctrl+C when finished; keep application servers running while capturing. Local evidence remains in the configured output directory.
