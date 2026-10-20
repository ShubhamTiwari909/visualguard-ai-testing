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

Search is generated during the build. Output is `apps/docs/dist`, and Astro's cache is `apps/docs/.astro`; both are ignored. Do not add a nested lockfile or Git repository. Edit Markdown/MDX under `src/content/docs`. Navigation uses explicit per-page `sidebar.order` within named groups. Use root-relative article links; the Markdown plugin applies the deployment base.

`DOCS_BASE_PATH` controls a project deployment path (default `/`). `DOCS_SITE_URL` controls canonical metadata (default `https://shubhamtiwari909.github.io`). Builds are noindex by default; only production deployment sets `DOCS_PRODUCTION=true`. These are public build settings, never credentials.

Formatting, lint and semantic type checks are deferred under the repository's current instructions. A documentation production build does not constitute a passed type check.
