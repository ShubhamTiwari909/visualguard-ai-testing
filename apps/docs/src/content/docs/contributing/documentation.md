---
title: "Work on the documentation"
description: "Install, preview, build and contribute to the VisualGuard documentation website."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "Source main 69ccdf1; npm 3.2.3 availability checked"
sourcePaths: ["docs/DOCUMENTATION-WEBSITE-PLAN.md"]
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
