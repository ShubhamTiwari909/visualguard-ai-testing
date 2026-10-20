---
title: "Work on the documentation"
description: "Install, preview, build and contribute to the VisualGuard documentation website."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["scripts/docs/check-content.mjs"]
sidebar: {"order": 5}
---

## Before you start

Use Node **22.22+** on a supported even-numbered release and pnpm **9.0.0**. Node 24 is recommended for this workspace. The published VisualGuard CLI still declares Node 22.12+. Git and a clone of this repository are required. The documentation needs no database, AI key or browser installation.

## 1. Install and start

From the repository root:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm docs:dev
```

If pnpm is missing, run `corepack enable` and `corepack prepare pnpm@9.0.0 --activate`, or follow [pnpm installation](https://pnpm.io/installation) if Corepack is unavailable. Open Astro's printed local URL. Keep the process running; Ctrl+C stops it.

## 2. Write an article

Create `.md` or `.mdx` under `apps/docs/src/content/docs/GROUP/`. Use Markdown for ordinary prose and MDX for components. Each article needs a title, description, audience, docType, channel, lastReviewed, verifiedAgainst and sourcePaths. Existing pages demonstrate valid metadata. Set `sidebar.order` to place the article in its learning sequence.

State prerequisites, working directory, every required file, commands in order, environment loading, verification and troubleshooting. Label incomplete property fragments. Keep credentials and private screenshot evidence out of articles. Use root-relative article links such as `/start/quickstart/`; the build adds the host base path. React/MDX component links must use the shared `docUrl` helper or `import.meta.env.BASE_URL`.

## 3. Build and preview

From the root:

```sh
pnpm docs:build
pnpm docs:preview
```

Open the printed preview URL. Verify the article, navigation, code copying and production search. Generated output is `apps/docs/dist`; the cache is `.astro`. Both are ignored. The production build is not a semantic type check.

## Deployment settings

`DOCS_BASE_PATH` defaults to `/`; use `/visualguard-ai-testing` for the proposed GitHub project site. `DOCS_SITE_URL` controls canonical metadata. Builds are noindex unless `DOCS_PRODUCTION=true`. These settings are public, not secrets. Verify links and search again whenever the base changes.

## Verification and review

Read the rendered article on desktop and mobile, follow its commands against the stated version, and record what was actually tested. Keep implementation, documentation and focused checks in the same feature commit. Formatting, lint and type checks remain deferred under the current repository instruction. Do not invoke them indirectly through a docs script.


## Run focused content and contract checks

```sh
pnpm docs:test
pnpm docs:build
pnpm docs:check-links
```

Build before the link check. `docs:test` checks metadata, planned routes, source-heading coverage, examples, Action inputs and generated CLI/configuration drift. It does not run formatting, lint or semantic type checks. Update tables with `node scripts/docs/generate-reference.mjs` after a source contract changes and review the generated diff. Keep every source heading represented in `apps/docs/src/data/coverage.json` with an accurate migrated, superseded or historical disposition.

The optional `pnpm docs:smoke` executes the pinned published quickstart and local SQLite workflow in a temporary project using local Playwright browsers and free ports 4100/4101. It installs test dependencies and cleans up its processes/data afterward. It does not configure real cloud, database or Google accounts.


## Publish the static documentation

The deployment workflow is manual and runs only from accepted `main`. After reviewing/merging the documentation branch, an administrator enables **Settings → Pages → GitHub Actions**, then runs **Actions → Deploy documentation** with canonical origin `https://shubhamtiwari909.github.io` and base `/visualguard-ai-testing`. The workflow rebuilds/checks the site before publishing the static artifact. It needs no dashboard database or AI secret.

For a dedicated custom domain, configure its verified DNS/Pages domain and use that HTTPS origin with base `/`. Repeat search, asset, deep-link and canonical checks. Preview articles are noindex by default; only the production workflow sets `DOCS_PRODUCTION=true`. The error page stays noindex.

Do not change npm homepage links to an unverified public URL. Keep legacy Markdown headings/links navigable until the live site passes the release checklist. Repository maintainers can follow the [complete launch checklist](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/docs/DOCUMENTATION-WEBSITE-LAUNCH.md) for review, publication, cutover and rollback. The documentation implementation itself does not claim a public deployment.
