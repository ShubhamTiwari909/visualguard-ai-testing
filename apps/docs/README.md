# VisualGuard documentation workspace

Use a supported even-numbered Node release **22.22+** (Node 24 LTS is suitable) and pnpm **9.0.0**. This website has a higher development requirement than the published CLI's Node 22.12 minimum. Check `node --version` before installing; select your Node version in your normal version manager.

From the repository root:

```sh
corepack enable
corepack prepare pnpm@9.0.0 --activate
pnpm install --frozen-lockfile
pnpm docs:dev
```

If Corepack is unavailable, install pnpm 9 through its supported installation instructions before continuing. Open the URL printed by Astro. Stop with Ctrl+C. The docs server needs no database, Playwright browser or AI credentials.

To build and inspect production output:

```sh
pnpm docs:build
pnpm docs:preview
```

Search is generated during the build. Output is `apps/docs/dist`, and Astro's cache is `apps/docs/.astro`; both are ignored. Do not add a nested lockfile or Git repository. Edit Markdown/MDX under `src/content/docs`. Navigation and reading order come from `src/data/navigation.mjs`, shared by Starlight and the public-page coverage check. Add each new guide to that manifest. Use root-relative article links; the Markdown plugin applies the deployment base.

`DOCS_BASE_PATH` controls a project deployment path (default `/`). `DOCS_SITE_URL` controls canonical metadata (default `https://shubhamtiwari909.github.io`). Builds are noindex by default; only production deployment sets `DOCS_PRODUCTION=true`. These are public build settings, never credentials.

Formatting, lint and semantic type checks are deferred under the repository's current instructions. A documentation production build does not constitute a passed type check.


## Focused documentation checks

From the repository root, after installing the workspace dependencies:

```sh
pnpm docs:test
pnpm docs:build
pnpm docs:check-links
```

`docs:test` checks article metadata, missing/duplicate/unlisted navigation routes, heading-level migration coverage, the quickstart config, Action inputs, generated CLI/schema reference drift and link-checker behavior. It transpiles trusted source contracts with jiti without running semantic type checks. `docs:check-links` inspects generated output, so build first. It checks internal pages, assets and anchor targets; it does not certify external URLs or cloud deployments.

After changing CLI registration or config fields, run `node scripts/docs/generate-reference.mjs`, review the generated tables and commit them with the feature. Do not hand-edit content below `generated-reference` markers. No CLI/platform build is needed for ordinary article edits or reference extraction.

`pnpm docs:smoke` is an optional, slower live guide check. It downloads pinned npm dependencies into a disposable project, uses existing matching Playwright browsers, starts its own demo on ports 4100/4101, compares changed/matching pages, runs the exact public API and custom reporter examples, and verifies SQLite dashboard persistence. Keep those ports free. It deletes its temporary project and stops owned processes afterward; it does not exercise cloud providers or use your private settings.

`pnpm docs:smoke:host` checks the source dashboard host with real Chromium: a saved project profile, Run test without a private runner credential, progress, stored evidence and history after restart. Install the workspace Chromium browser first. It uses disposable SQLite storage and local fixture servers, without external databases or AI services.

Migration tracking lives in `src/data/coverage.json`; assign each source heading a destination or an explicit historical/superseded reason. The release record is `src/data/releases.json`. Change verified versions only after inspecting the actual registry artifact and testing the claimed scope. Do not replace legacy guides until the public site is reachable.
