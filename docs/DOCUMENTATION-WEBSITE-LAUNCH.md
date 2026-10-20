# Launch the documentation website

The implementation is on `codex/documentation-website`. The local website and production artifacts are verified. **Public publication and README/homepage cutover remain pending** while this work stays on its separate review branch. A read-only Pages API check on 20 October 2026 returned no configured site; no Pages setting was changed.

## 1. Review and merge the branch

Review the phase commits and [implementation evidence](DOCUMENTATION-WEBSITE-IMPLEMENTATION.md). Keep the CLI package edit and unrelated local assets outside the docs change. Use Node 24 and pnpm 9 for the website. Before merging, follow the repository's current deferred-check instruction: this implementation did not run formatting, lint or semantic type checks. Existing repository CI may define those jobs separately.

For local verification, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs:test
pnpm docs:build
pnpm docs:check-links
pnpm docs:preview
```

Open the printed URL and stop preview with `pnpm docs:preview stop` when using Astro's background preview mode. `pnpm docs:dev` starts the editing server. The optional `pnpm docs:smoke` needs matching Playwright browsers and free demo ports 4100/4101; it installs a temporary published consumer and verifies capture/SQLite behavior.

## 2. Enable GitHub Pages after review

An authorized repository administrator opens **Settings → Pages → Build and deployment** and chooses **GitHub Actions**. Confirm that the repository/account supports Pages and the intended audience is public. This is separate from the private/login-protected VisualGuard dashboard product.

The new deployment workflow is manual and accepts only `main`; it cannot publish this feature branch. In **Actions → Deploy documentation → Run workflow**, select `main` after merge and keep the initial settings:

- `site_url`: `https://shubhamtiwari909.github.io`
- `base_path`: `/visualguard-ai-testing`

The build runs focused docs contracts, static build and generated-link checks before uploading only `apps/docs/dist`. The deployment job has Pages/OIDC permissions; PR check jobs have read-only repository access. A successful job returns the actual page URL. Do not assume the proposed URL is live until that job succeeds.

See [Astro's official GitHub Pages guide](https://docs.astro.build/en/guides/deploy/github/) if GitHub UI or hosting requirements change.

## 3. Verify the public result

At the returned URL:

1. Open the homepage and use all three setup links.
2. Open the quickstart directly in a new tab and refresh it.
3. Search for MongoDB, upload token, private runner and baseline; follow results and heading anchors.
4. Inspect the favicon, execution diagram and code-copy controls.
5. Open/refresh nested dashboard/reference pages and the error document.
6. Verify light/dark mode and mobile menu, plus a dense reference table at a narrow width.
7. Inspect canonical/sitemap URLs: all must use the production origin and configured base.
8. Confirm ordinary production articles do not carry preview noindex metadata. The 404 should stay noindex.

`robots.txt` at a project subpath does not control the origin's crawler policy. Preview pages use noindex independently. On a dedicated domain, serve the generated robots file at its root.

## 4. Cut over entry links only after success

Once the live URL passes the smoke checklist, update the root/npm README documentation links and the package homepage in a scoped follow-up change. Coordinate any package-manifest edit with its owner/release; do not include unrelated version edits. Preserve the npm README's standalone install snippet and correct version context.

Keep old Markdown setup URLs/anchors usable. The website cannot redirect GitHub Markdown links: replace old articles only with heading-preserving navigation after checking the migration map at `apps/docs/src/data/coverage.json`. Historical plans/changelogs/validation records retain their original scope. Do not remove them or rewrite old claims as current certification.

## 5. Updates, custom domains and rollback

Run **Deploy documentation** again from an accepted main revision for each content publication. This workflow intentionally does not publish automatically on a push. For a dedicated domain, configure its verified DNS/Pages domain, use that HTTPS origin and base `/`, rebuild and repeat all link/search checks. Retain the former path or redirects as appropriate for already shared links.

Record the last known-good deployment revision. Roll back by redeploying that accepted revision through the repository's approved deployment process; the docs have no database migration. A dashboard rollback is a separate operational procedure.
