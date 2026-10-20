---
title: "Work on the documentation"
description: "Run, write, check and publish the VisualGuard documentation website, and follow its writing style."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
sourcePaths: ["apps/docs/astro.config.mjs", "apps/docs/src/data/navigation.mjs", "scripts/docs/smoke-dashboard-host.mjs", "apps/docs/src/content.config.ts", "apps/docs/src/components/PageTitle.astro", "apps/docs/src/data/coverage.json", "apps/docs/src/data/releases.json", "scripts/docs/check-content.mjs", "scripts/docs/check-examples.mjs", "scripts/docs/check-links.mjs", "scripts/docs/generate-reference.mjs", "scripts/docs/smoke-quickstart.mjs", ".github/workflows/docs-check.yml", ".github/workflows/docs-deploy.yml"]
sidebar: {"order": 5}
---

This page is the complete guide to the documentation website you are reading. It shows how to run the site on your computer, add or edit a page, write in the house style, pass the automated checks and publish the site to GitHub Pages.

The site lives in `apps/docs`. It is a static site built with [Astro](https://astro.build/) and its documentation theme, [Starlight](https://starlight.astro.build/). It needs no database, no AI key and no Playwright browser.

## Before you start

- A clone of the repository and Git.
- **Node.js 22.22 or newer** on an even-numbered (long-term support) release. Node 24 is recommended. The docs app needs a newer Node than the published CLI, which only needs Node 22.12.
- **pnpm 9.0.0**, the version pinned in the root `package.json`.
- Run every command on this page from the **repository root**, not from `apps/docs`.

Examples use macOS or Linux shells; on Windows use WSL.

## 1. Install and start the site

Check your tools first, so a version problem shows up before the install.

```bash
node --version
pnpm --version
```

You should see `v22.22.0` or newer (for example `v24.13.0`) and `9.0.0`.

If pnpm is missing, turn it on through Corepack. If Corepack is not available, follow the [pnpm installation guide](https://pnpm.io/installation).

```bash
corepack enable
corepack prepare pnpm@9.0.0 --activate
```

Install the workspace and start the development server.

```bash
pnpm install --frozen-lockfile
pnpm docs:dev
```

You should see Astro print a local address such as `http://127.0.0.1:4321/`. Open it. The page reloads when you save a file. Press Ctrl+C to stop the server.

:::note
Do not add a separate lockfile or a nested Git repository inside `apps/docs`. The site is one package in the main pnpm workspace.
:::

### Documentation commands

| Command | What it does |
| --- | --- |
| `pnpm docs:dev` | Starts the development server on `127.0.0.1` with live reload. |
| `pnpm docs:build` | Builds the static site into `apps/docs/dist` and generates the search index. |
| `pnpm docs:preview` | Serves the built `dist` folder so you can check the production output. Run `docs:build` first. |
| `pnpm docs:test` | Runs the content, example and generated-reference checks. See [step 5](#5-run-the-checks). |
| `pnpm docs:check-links` | Checks every internal link, asset and heading anchor in the built site. Run `docs:build` first. |
| `pnpm docs:smoke` | Optional, slower. Runs the published-package quickstart, API/reporter examples and local dashboard guide in a throwaway project. |
| `pnpm docs:smoke:host` | Optional. Exercises source dashboard-host capture with real Chromium and SQLite, without a runner credential. Install Chromium first. |

The build output (`apps/docs/dist`) and Astro's cache (`apps/docs/.astro`) are ignored by Git.

## 2. Find where pages live

Every page is a Markdown (`.md`) or MDX (`.mdx`) file under `apps/docs/src/content/docs/`. The file path becomes the page address. For example, `contributing/documentation.md` is served at `/contributing/documentation/`.

| Folder | Sidebar group | What belongs there |
| --- | --- | --- |
| `start/` | Start here | Install, quickstart and choosing a setup. |
| `concepts/` | Understand VisualGuard | How things work, results and the [glossary](/concepts/glossary/). |
| `guides/` | Testing guides | Tasks with the CLI, configuration and reports. |
| `dashboard/` | Dashboard & teams | The shared dashboard, people, reviews, baselines and runners. |
| `ci/` | CI & pull requests | GitHub Actions, checks, sharding and preview deployments. |
| `deployment/` | Deployment & operations | Hosting, databases, backups and upgrades. |
| `reference/` | Reference | Tables of commands, options, settings and exit codes. |
| `troubleshooting/` | Troubleshooting | Symptom-to-fix pages. |
| `releases/` | Releases | Release notes and migrations. |
| `contributing/` | Contributing | Working on the repository itself. |

Other useful files:

| Path | Purpose |
| --- | --- |
| `apps/docs/astro.config.mjs` | Site settings, the shared sidebar import, base path and search-engine indexing. |
| `apps/docs/src/data/navigation.mjs` | Ordered sidebar and the required public-page inventory. |
| `apps/docs/src/content.config.ts` | The frontmatter schema every page must match. |
| `apps/docs/src/components/PageTitle.astro` | Adds the release notice under each page title. |
| `apps/docs/src/components/SetupChooser.tsx` | The React setup chooser used on the home page. |
| `apps/docs/src/lib/remark-docs-links.mjs` | Adds the base path to root-relative Markdown links. |
| `apps/docs/src/lib/urls.ts` | `docUrl()`, the helper for links inside React or MDX components. |
| `apps/docs/src/data/coverage.json` | Tracks where every heading of the old repository Markdown guides now lives. |
| `apps/docs/src/data/releases.json` | The published version and what was actually tested. |
| `apps/docs/public/` | Static files such as `favicon.svg` and `diagrams/*.svg`. |
| `scripts/docs/` | The check, generator and smoke scripts. |

Use Markdown for ordinary pages. Use MDX only when the page needs a component.

## 3. Add or edit a page

Copy an existing page from the same folder. It already has valid frontmatter (the YAML block between the `---` lines at the top) and the right shape. Then change the text.

### Frontmatter fields

The schema in `content.config.ts` rejects a page with a missing or wrong field, and `docs:test` repeats the most important checks.

| Field | Required | What it means | Allowed values |
| --- | --- | --- | --- |
| `title` | Yes | The page heading and browser tab title. Write a task, such as "Run your first test". | Text. |
| `description` | Yes | One sentence used in search results and link previews. | Text, at least 15 characters. |
| `audience` | Yes | Who the page is for. | `developer`, `reviewer`, `operator`, `contributor`. |
| `docType` | Yes | The kind of page. It decides the expected shape (see below). | `tutorial`, `how-to`, `explanation`, `reference`. |
| `channel` | Yes | Which install the page describes. It sets the badge under the title. | `published` shows **npm package**, `source` shows **Source checkout**, `both` shows **Package & source**. |
| `lastReviewed` | Yes | The date you last checked the page against the code. Shown as "Reviewed …". | A real date such as `2026-10-20`. |
| `minimumVersion` | No | The oldest release the page applies to. | Text. |
| `sourcePaths` | Yes for `docs:test` | Repository files the page describes. Reviewers use them to find what to re-check when code changes. | An array of paths that exist, relative to the repository root. |
| `sidebar` | No | Optional Starlight sidebar presentation settings. Our explicit reading order comes from `navigation.mjs`. | For example `{"order": 4}`. |
| `template` | No | Starlight page layout. Only the home page uses `splash`, which also hides the release notice. | `doc` (default) or `splash`. |
| Other Starlight fields | No | `hero` (home page banner), `head` (extra tags such as `noindex`), `pagefind: false` (leave out of search), `draft` and `editUrl`. See `index.mdx` and `404.md` for working examples. | See the [Starlight frontmatter reference](https://starlight.astro.build/reference/frontmatter/). |

Pick the `docType` that matches what the reader is doing:

| docType | The reader wants to… | Shape |
| --- | --- | --- |
| `tutorial` | Learn by doing a complete task from the start. | Must have a "Before you start" (or "Prerequisites") heading, a heading with "Verify", "Check" or "Inspect", and a "Troubleshooting" heading. The checker enforces this. |
| `how-to` | Finish one specific job. | Numbered steps, a check, troubleshooting and next steps. |
| `explanation` | Understand how or why something works. | Short sections with diagrams or examples. |
| `reference` | Look up an exact value. | Mostly tables. |

### Place the page in the sidebar

The sidebar is explicit so a new reader sees prerequisites before advanced tasks. Add the page's slug to the appropriate group in `apps/docs/src/data/navigation.mjs`. For example, a new `guides/my-task.md` page needs `{ slug: 'guides/my-task' }` in its reading position. For an `index.md` page, use the folder slug, such as `releases`.

Use an existing subgroup for a related task, or add a clearly named group with an `items` array. The same manifest drives Starlight and content checks: a missing destination, duplicate entry or public page left out of navigation makes `pnpm docs:test` fail. Home and the custom 404 are the only exceptions.

### Links and images

- Link to other pages with root-relative routes that end in a slash, such as `[Quickstart](/start/quickstart/)`. A remark plugin adds the deployment base path at build time, so the same link works locally and on GitHub Pages.
- Link to a heading by adding its anchor, such as `/contributing/documentation/#4-write-in-the-house-style`. Starlight makes the anchor from the heading text: lowercase, spaces become hyphens, punctuation is dropped. The link check fails if the anchor does not exist, so update links when you rename a heading.
- Link to repository files with a full GitHub address: `https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/<path>`.
- Put images and diagrams in `apps/docs/public/` and use them with a root-relative path, such as `![Alt text](/diagrams/execution.svg)`. Always write alt text that describes the picture.
- Inside React or MDX components, the remark plugin does not run. Build links with `docUrl()` from `src/lib/urls.ts`, or with `import.meta.env.BASE_URL`.

### Pages the scripts read

Some pages are also test input. Edit them with care:

| Page | What reads it | Keep this true |
| --- | --- | --- |
| `start/quickstart.md` | `check-examples.mjs` and `smoke-quickstart.mjs` | The first ` ```ts ` block is a valid config with `ai.provider: 'none'` and `routes: ['/']`. The first ` ```js ` block is the demo server on ports 4100 and 4101. The page uses the `visualguard@latest` installation target from `releases.json`. |
| `guides/programmatic-api.md`, `guides/reporters.md` | `smoke-quickstart.mjs` | Their first JavaScript blocks are complete runnable API/reporter files; the smoke adds the documented reporter to the API caller. |
| `dashboard/local.md` | `smoke-quickstart.mjs` | The first ` ```dotenv ` block is a working local dashboard settings file. |
| `ci/github-actions.md` | `check-examples.mjs` | Every input in `action/action.yml` is mentioned in backticks. |
| `reference/configuration.md`, `reference/cli/testing.md`, `reference/cli/dashboard.md` | `generate-reference.mjs` | Nothing below the `<!-- generated-reference -->` marker is edited by hand. |

## 4. Write in the house style

Every page should cover its topic in detail **and** read simply. A newcomer should be able to follow it without asking for help.

- **Detailed** means every real option, command, step, default, expected result and caveat that matters.
- **Simple** means plain words and short sentences, with one idea per sentence. Define jargon the first time you use it, and link to the [glossary](/concepts/glossary/). Use the active voice. Avoid slash chains such as "capture/upload/completion"; write "capture, upload and completion". Do not repeat the same legal-style hedge on every page.

### Page shape

Adapt this shape to the `docType`. Reference pages are mostly tables.

1. **Opening, with no heading.** Two or three sentences: what this page helps you do, and when you would use it.
2. **`## Before you start`.** A short bullet list of prerequisites for *this* page, with links. Do not paste a generic paragraph about shells or tools. Say "run commands from your app's root folder" once, where it matters.
3. **Body.** Tutorials and how-to pages use numbered steps such as `## 1. Install the package`. Each step has one sentence on why, then the command or code in a fenced block (` ```bash `, ` ```ts `) that the reader can copy and paste, then "You should see …" with the expected output or screen.
4. **Options in tables**, with the columns `| Option | What it does | Default |`.
5. **One realistic example** per page, such as a storefront with a pricing page.
6. **Asides for caveats.** Use Starlight's `:::note`, `:::tip` and `:::caution` blocks: a line with `:::note`, the content, then a line with `:::`. State each caveat once.
7. **`## Verify …`**, telling the reader how to confirm success. Tutorials must have a heading containing "verif", "check" or "inspect".
8. **`## Troubleshooting`**, with a page-specific `| Problem | Fix |` table of three to eight rows and a link to the matching page under `/troubleshooting/`.
9. **`## Next steps`**, with two to four specific links and one line on each.

### Rules

- Facts must be correct. Check every command, flag, configuration key, environment variable, UI label and default against the source before you write it: `packages/visualguard/src/**` (especially `cli/commands/*.ts`, `cli/program.ts`, `cli/shared.ts` and `config/schema.ts`), `apps/platform/server/**`, `apps/platform/client/**` for UI labels, and `action/action.yml`. Never invent a flag or behavior. If you are not sure, leave it out.
- Keep source and installed-package behavior clear without stamping every page with a release number. Use `visualguard@latest` in installation commands, save the resolved version and lockfile, and explain how readers can check their installed commands or dashboard capabilities. Keep version-specific history in the package changelog and migration guide. Update a task guide when its behavior changes, not just because a new package version exists.
- Keep cross-platform notes to one line: "Examples use macOS/Linux shells; on Windows use WSL."
- Remove unfinished notes, sample review-date placeholders and unfilled release markers before publishing. The content check rejects these markers.
- Keep credentials, real tokens and private screenshots out of pages. Use clearly fake example values.
- Do not rename, move or delete a published page without updating `coverage.json` and every link to it. Readers and the coverage map depend on page addresses.
- When you change behavior in code, update the matching page in the same commit as the code and its tests.

## 5. Run the checks

Run the checks before you open a pull request. The build must come before the link check, because the link check reads the built HTML.

```bash
pnpm docs:test
pnpm docs:build
pnpm docs:check-links
```

You should see three success lines, similar to:

```text
Content passed: … articles, … navigable guides, and … tracked source sections.
Examples passed: quickstart config/constraints, current-release install target and every Action input.
Configuration and CLI references match the source contracts (… configuration entries).
Links passed: … generated pages and … internal links/assets/anchors.
```

`docs:test` runs four scripts in order and stops at the first failure.

| Script | What it enforces | How to fix a failure |
| --- | --- | --- |
| `scripts/docs/checks.test.mjs` | Navigation validation catches deleted destinations, duplicated entries and unlisted new articles. The link checker finds missing anchors and paths that escape the base path. The remark plugin adds the base only to root-relative links. The deploy workflow runs only by hand from `main`, sets `DOCS_PRODUCTION=true` and is the only workflow with Pages write access. The check workflow stays read-only and runs `docs:check-links`. | Undo the workflow or plugin change that broke the rule, or update the test together with a deliberate, reviewed change. |
| `scripts/docs/check-content.mjs` | Every public guide appears exactly once in the shared navigation manifest, with no missing destinations. Every page has `title`, `description`, `audience`, `docType`, `channel` and `lastReviewed`. `sourcePaths` is an array and every path exists. `lastReviewed` is a real date. No placeholder words. Tutorials have the three required headings. Every heading in each source file listed in `coverage.json` is tracked, and every tracked entry points to an existing page. | Add the missing field, fix the path or date, or add the missing heading. For "Unmapped source section", add an entry to `coverage.json` (see below). For "Missing migration destination", point the entry at a page that exists. |
| `scripts/docs/check-examples.mjs` | The quickstart config passes the real configuration schema, a zero-width viewport fails it, AI is off and routes are `['/']`. The quickstart uses the current-release installation target in `releases.json`. `ci/github-actions.md` mentions every Action input. | Fix the quickstart code block, the install target or the Action page. |
| `scripts/docs/generate-reference.mjs --check` | The generated tables in the three reference pages match the current CLI and configuration schema. | Regenerate the reference (step 6). |

`docs:check-links` checks every `href`, `src` and `poster` in the built HTML. It reports missing pages, missing files, missing heading anchors, invalid addresses and links that escape the base path. It does not check external websites. It reads `DOCS_BASE_PATH` and `DOCS_SITE_URL`, so use the same values for the build and the link check.

### The coverage map

`apps/docs/src/data/coverage.json` records where each heading of the older repository Markdown guides (listed in its `sources` array, such as `README.md` and `docs/LOCAL-SETUP.md`) now lives on this site. When someone adds or renames a heading in one of those files, add or update an entry:

```json
{
  "source": "docs/LOCAL-SETUP.md",
  "heading": "Run the fixture demo",
  "anchor": "run-the-fixture-demo",
  "destination": "/contributing/local-setup/",
  "disposition": "migrated",
  "reason": "The website page holds the complete, maintained steps.",
  "reviewedAgainst": "899ff21753f064e6118b686d13f7d093a5599b81"
}
```

| Disposition | Use it when | `destination` |
| --- | --- | --- |
| `migrated` | The content now lives on a site page. | Must be an existing route. |
| `superseded` | A site page replaces it with different content. | Must be an existing route. |
| `retained historical` | It is kept only as history, such as old plans. | Not checked. |

Every entry needs a non-empty `reason`.

### The optional live smoke test

`pnpm docs:smoke` follows the quickstart exactly as a reader would. It is slower and needs network access, so run it when you change the quickstart, the local dashboard page or the published version.

It creates a temporary project, resolves `visualguard@latest` and `playwright@latest`, prints the installed package version and CLI label, installs matching Chromium, writes the quickstart config and demo server from the page, and starts the demo on ports **4100** and **4101**. It runs `doctor`, `test --list`, a comparison that must find the change, the HTML report, and a second comparison that must pass. With `--dashboard` (which the root script passes), it also starts a SQLite dashboard from the `dotenv` block in `dashboard/local.md`, creates a project, uploads a run and checks that the run survives a restart.

It removes `VISUALGUARD_*`, `GEMINI_*`, `GOOGLE_API_KEY`, `OLLAMA_*` and `DATABASE_URL` from its environment, so your private settings are never used. It needs network access for npm and the matching Chromium download, and ports 4100 and 4101 free. On Linux, install Playwright's required system libraries first. It stops its processes and deletes the temporary project when it finishes, even after a failure. It does not test cloud hosting, external databases or Google sign-in.

:::note
The repository's `AGENTS.md` defers formatting, lint and type-check commands during the current feature sequence. The documentation scripts do not run them. A passing docs build is not a passing type check, so do not report it as one.
:::

## 6. Regenerate the reference tables

Three reference pages contain tables generated from the source: `reference/configuration.md` (from `config/schema.ts`) and `reference/cli/testing.md` and `reference/cli/dashboard.md` (from `cli/program.ts`). Regenerate them whenever you change a CLI command, option or configuration field.

```bash
node scripts/docs/generate-reference.mjs
```

You should see `Configuration and CLI references generated from the source contracts (… configuration entries).`

The script keeps everything above the `<!-- generated-reference -->` marker and replaces everything below it. Review the diff, then commit the regenerated pages with the code change. To change the wording of a generated table, edit the generator, not the page. No package build is needed; the script reads the TypeScript source directly.

## 7. Build and preview the production site

Preview the built site before you merge, so you see search and the base path the way readers will.

```bash
pnpm docs:build
pnpm docs:preview
```

You should see a preview address. Open it and check the changed pages, the sidebar, code-copy buttons and search. Search only works in the built site, not in `docs:dev`.

### Build settings

These settings are read by `astro.config.mjs` and `check-links.mjs`. They are public values, never secrets.

| Variable | What it does | Default |
| --- | --- | --- |
| `DOCS_BASE_PATH` | The path the site is served under. Use `/visualguard-ai-testing` for the GitHub project site, or `/` for a dedicated domain. | `/` |
| `DOCS_SITE_URL` | The site origin, without a path. Used for canonical links and the sitemap. | `https://shubhamtiwari909.github.io` |
| `DOCS_PRODUCTION` | `true` lets search engines index the site. Any other value adds a `noindex, nofollow` tag to every page. Only the deploy workflow sets it. | not set (noindex) |

To preview exactly what GitHub Pages will serve, build and check with the project path:

```bash
DOCS_BASE_PATH=/visualguard-ai-testing pnpm docs:build
DOCS_BASE_PATH=/visualguard-ai-testing pnpm docs:check-links
pnpm docs:preview
```

You should see the preview under `/visualguard-ai-testing/`.

## 8. Publish to GitHub Pages

Two workflows handle the site.

| Workflow | File | When it runs | What it does |
| --- | --- | --- | --- |
| Documentation | `.github/workflows/docs-check.yml` | Pull requests and pushes to `main` that touch docs, docs scripts, the CLI or platform source, the Action, workspace files or these workflows. Also by hand. | Installs with Node 24, runs `docs:test`, `docs:build` and `docs:check-links` with the project base path, and uploads the built site as a `documentation-preview` artifact for 7 days. It has read-only permissions and never deploys. |
| Deploy documentation | `.github/workflows/docs-deploy.yml` | Only by hand, and only from `main`. | Runs the same checks with `DOCS_PRODUCTION=true`, then deploys `apps/docs/dist` to GitHub Pages. Inputs: `site_url` (default `https://shubhamtiwari909.github.io`) and `base_path` (default `/visualguard-ai-testing`). |

Neither workflow needs a dashboard database or an AI key.

### Launch steps

Follow these steps the first time the site goes live.

1. **Merge to `main`.** Get the documentation branch reviewed and merged. The deploy job refuses to run from any other branch.
2. **Turn on Pages.** In the GitHub repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. This needs administrator access.
3. **Run the deploy.** Open **Actions → Deploy documentation → Run workflow**, choose the `main` branch and keep the default inputs. For a custom domain, first set up its DNS and verify it in GitHub Pages, then use that `https://` origin as `site_url` and `/` as `base_path`.
4. **Verify the live site.** Open the address the `deploy` job prints, such as `https://shubhamtiwari909.github.io/visualguard-ai-testing/`. Check the home page, a few deep links opened directly, images and diagrams, search, and the canonical link in the page source. Confirm that the 404 page still carries `noindex`.
5. **Update links.** Only after the live site passes step 4, update the documentation links in `README.md` and the `homepage` field in `packages/visualguard/package.json`. That field reaches npm with the next published release. Keep the old repository Markdown guides reachable until then.

You should see the site at the live address, and a green run for both jobs in the Actions tab.

## Verify your change

- `pnpm docs:test`, `pnpm docs:build` and `pnpm docs:check-links` all pass.
- In `pnpm docs:preview`, the page appears in the right sidebar group and position, and the badge under the title matches its `channel`.
- You read the page from top to bottom as a beginner, and followed each command with the intended installed package and checked the advertised capabilities.
- In your pull request, record what you actually ran. Do not list a deferred check as passed.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `pnpm install` or `docs:dev` fails with an engine error | Switch to Node 22.22 or newer (Node 24 is recommended) and pnpm 9.0.0. |
| `missing source …` from `docs:test` | A path in `sourcePaths` does not exist. Fix the path or remove it. |
| `Unmapped source section: …` | A heading was added or renamed in one of the files listed in `coverage.json`. Add a matching entry. |
| `Reference drift: run node scripts/docs/generate-reference.mjs` | The CLI or configuration changed. Run the generator and commit the updated pages. |
| `missing anchor …` or `missing target …` from `docs:check-links` | A heading or page was renamed. Update the link, then rebuild before checking again. |
| `escapes configured base` | A link or asset skips the base path. Use a root-relative Markdown link, or `docUrl()` inside components. |
| A new page does not show in the sidebar | Add its slug to the right group in `src/data/navigation.mjs`; run `docs:test`. |
| `docs:smoke` stops with `Demo exited …` | Ports 4100 or 4101 are in use. Free them and run it again. |

For problems with the product itself, see [installation troubleshooting](/troubleshooting/installation/).

## Next steps

- [Set up a source checkout](/contributing/local-setup/) to run the CLI and dashboard you are documenting.
- [Run the test suites](/contributing/testing/) before you change behavior that a page describes.
- [Read the architecture](/contributing/architecture/) to find the source files behind a feature.
- [Prepare a package release](/contributing/releases/) when a documented change ships.
