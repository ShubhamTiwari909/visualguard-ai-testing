---
title: "Prepare a package release"
description: "Describe changes with Changesets, choose a version, check the package and publish the visualguard npm package safely."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
sourcePaths: ["PUBLISHING-AND-USING.md", ".changeset/config.json", ".github/workflows/release.yml", "packages/visualguard/package.json", "packages/visualguard/CHANGELOG.md", "scripts/pack-smoke.mjs", "scripts/standalone-dashboard-smoke.mjs", "apps/docs/src/data/releases.json"]
sidebar: {"order": 6}
---

This page explains how a change in this repository becomes a new version of the `visualguard` npm package. Read it when you add a user-visible change (you will write a changeset), and when you are the maintainer who versions and publishes a release.

Only one package is published: `visualguard`, from `packages/visualguard`. The dashboard app (`@visualguard/platform`) and the docs site (`@visualguard/docs`) are private workspace packages. They are never published on their own; the dashboard reaches users inside the `visualguard` package.

## Before you start

- A [source checkout](/contributing/local-setup/) that builds and passes its [tests](/contributing/testing/).
- For writing a changeset: nothing else.
- For publishing: write access to the GitHub repository and publish rights for `visualguard` on npm. Publishing is a deliberate maintainer action. Nobody else should run the publish steps.

Examples use macOS/Linux shells; on Windows use WSL.

## How a release flows

[Changesets](https://github.com/changesets/changesets) manages versions and the changelog. A **changeset** is a small Markdown file in `.changeset/` that names the package, the size of the version bump and a summary for the changelog.

1. A contributor adds a changeset in the same pull request as the change.
2. The pull request merges to `main`.
3. The **Release** workflow (`.github/workflows/release.yml`) runs on every push to `main`. While changesets are waiting, it opens or updates a pull request named "Version Packages". That pull request runs `pnpm version-packages`, which bumps the version in `packages/visualguard/package.json`, writes `packages/visualguard/CHANGELOG.md` and deletes the used changeset files.
4. A maintainer reviews and merges the "Version Packages" pull request.
5. The workflow runs again. With no changesets left, it runs `pnpm release` (`pnpm build && changeset publish`). Changesets publishes any package version that is not on npm yet.

The workflow publishes with npm **trusted publishing**: GitHub's OpenID Connect token (`id-token: write`) proves the run's identity, so no npm token is stored in the repository. `NPM_CONFIG_PROVENANCE=true` adds a provenance statement that links the package to the workflow run. The `visualguard` package on npm must list this repository and workflow as a trusted publisher for this to work.

## 1. Add a changeset to your pull request

Add a changeset whenever a change affects people who install the package: a new feature, a fix, a changed default or a migration step.

```bash
pnpm changeset
```

You should see prompts. Select `visualguard`, choose the bump type and write the summary. A new file appears in `.changeset/` with a random name, such as:

```md
---
"visualguard": minor
---

Let the dashboard run **Run test** itself with just the signed-in user's authorization. Add `VISUALGUARD_BUILT_IN_RUNNER` and `VISUALGUARD_BUILT_IN_RUNNER_CONCURRENCY`.
```

Choose the bump with [semantic versioning](https://semver.org/):

| Bump | Use it for | Example |
| --- | --- | --- |
| `patch` | A fix that changes no public behavior people rely on. | 1.2.0 to 1.2.1 |
| `minor` | A new feature or option that keeps old configs working. | 1.2.0 to 1.3.0 |
| `major` | A change that breaks existing configs, commands, outputs or stored data. | 1.2.0 to 2.0.0 |

Write the summary for the person upgrading. Say what changed, and any action they must take, such as a new setting, a database backup or a migration. Rename the file to something readable if you like, such as `dashboard-built-in-runner.md`. Commit it with the code, tests and documentation of the change.

:::tip
Changes that only touch the docs site, tests or repository scripts do not need a changeset.
:::

## 2. Review the version and changelog

The "Version Packages" pull request shows the next version and the changelog entry. You can also produce them locally to check before merging:

```bash
pnpm version-packages
git diff -- packages/visualguard/package.json packages/visualguard/CHANGELOG.md
```

You should see the new version in `package.json` and the changeset summaries under a new heading in `CHANGELOG.md`. Undo the local result with `git restore` and `git clean` if you only wanted to look; the workflow makes the real version commit.

Check three things:

- **The version is new.** npm versions can never be reused, even after an unpublish. Compare with the registry:

  ```bash
  npm view visualguard version
  ```

  The command reports the current published version; compare that live result with the proposed version.
- **The starting version is right.** Changesets bumps from whatever is in `packages/visualguard/package.json`. Compare that file with the registry result and the proposed changeset bump; do not assume they start at the same version. Do not hand-edit the version and also add changesets unless you mean both.
- **The changelog explains upgrades.** Every breaking change and migration has clear steps.

## 3. Build and check the package

Run the same checks CI runs before any version is published, from the repository root.

```bash
pnpm install --frozen-lockfile
pnpm --filter visualguard exec playwright install chromium
pnpm build
pnpm test
pnpm test:pack
pnpm platform:test
pnpm platform:build
pnpm --filter visualguard build:dashboard
pnpm platform:test:package
```

You should see every suite pass. `test:pack` prints `pack smoke test passed: visualguard <version>`. That check installs the packed tarball in a throwaway project and fails if `npx visualguard --version` does not match `package.json`.

See [run the test suites](/contributing/testing/) for what each command covers.

:::caution
CI also runs `pnpm lint`, `pnpm format:check` and `pnpm typecheck` on every pull request. The repository's `AGENTS.md` defers these three commands locally during the current feature sequence (until after F36). Do not run them locally while that rule stands, and do not report them as passed. A release must still wait for a green CI run on `main`.
:::

## 4. Inspect the tarball

Look at exactly what npm will receive. The package publishes only the `dist` folder (`"files": ["dist"]`), plus `package.json`, the README and the license that npm always includes.

```bash
pnpm --filter visualguard pack --pack-destination /tmp/visualguard-pack
tar -tzf /tmp/visualguard-pack/visualguard-*.tgz | sort
```

You should see:

| Path in the tarball | What it is |
| --- | --- |
| `package/dist/cli.js` | The `visualguard` command. |
| `package/dist/index.js`, `index.d.ts` | The programmatic API. |
| `package/dist/playwright.js`, `playwright.d.ts` | The `visualguard/playwright` fixture. |
| `package/dist/dashboard.js`, `dashboard.d.ts` | The `visualguard/dashboard` entry point and its server. |
| `package/dist/dashboard-app/` | The built dashboard web client. |
| `package/dist/report-app/` | The bundled HTML report app. |
| `package/dist/diff-worker.js` | The image-diff worker. |
| `package/dist/chunk-*.js` and `*.js.map` | Shared code chunks and their source maps. |

The tarball must **not** contain `.env` files, API keys, tokens, test fixtures, run artifacts or workspace-only files. If something unexpected appears, fix the build before going further.

## 5. Publish

Publish through the Release workflow by merging the "Version Packages" pull request. That path builds in a clean runner, uses trusted publishing and adds provenance.

If the workflow cannot be used and a maintainer must publish by hand:

```bash
npm login
npm whoami
pnpm build
cd packages/visualguard
npm publish
```

You should see `+ visualguard@<version>`. Use `npm publish --access public` only if the package ever moves under an npm scope; the unscoped `visualguard` package is already public.

:::caution
`npm publish` cannot be undone in practice: the version number is used up forever. Publish only from a clean, up-to-date `main`, after the checks in step 3, and never with uncommitted changes.
:::

## Verify the published release

Do not call a release published until the registry and a fresh install prove it.

1. Check the registry:

   ```bash
   npm view visualguard version
   npm view visualguard dist-tags
   ```

   You should see the new version as `latest`.
2. Install that exact version in a new, empty project and confirm the CLI version:

   ```bash
   npm install --save-dev --save-exact visualguard@<version>
   npx --no-install visualguard --version
   ```

   You should see the same concrete version in the package metadata and CLI output. Investigate a mismatch as a build-label problem before declaring release validation complete.
3. Run the [quickstart](/start/quickstart/) against the new version, open the report, and start the [local dashboard](/dashboard/local/). Run `visualguard dashboard init --target cloud-run --out /tmp/vg-scaffold` and check that the generated project depends on the new version.
4. Run `pnpm docs:test` and `pnpm docs:smoke`. Installation examples and the smoke test resolve `@latest`, so a routine release does not require editing version numbers across pages. Record the actual tested package and CLI labels in release validation evidence, and refresh the dated validation scope when it changes. See [work on the documentation](/contributing/documentation/).
5. Update guides when behavior, commands or prerequisites change. Explain availability through installed commands and dashboard status, and keep version-specific history in the package changelog and migration guide.

People who install the package follow [installation](/start/install/) and the [baseline guides](/guides/local-baselines/). Keep the npm README short and its links correct for the release.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| No "Version Packages" pull request appears | Check that a changeset file exists in `.changeset/` on `main` and that the Release workflow ran. |
| The workflow fails with an npm authentication or `403` error | Check the trusted publisher settings for `visualguard` on npmjs.com. They must name this repository and `release.yml`. |
| `npm publish` says the version already exists | That version is taken forever. Add a changeset or bump the version again. |
| `test:pack` fails with `Expected version …` | The built CLI reports a different version from `package.json`. Rebuild with `pnpm build` after the version change. |
| The tarball is missing the dashboard or report | Run `pnpm build` from the root; it builds the report app and copies the dashboard client into `dist/dashboard-app`. |
| The version jumped further than expected | Changesets bumps from the version already in `package.json`. Check for a manual edit. |

For install problems that users report after a release, see [installation troubleshooting](/troubleshooting/installation/).

## Next steps

- [Run the test suites](/contributing/testing/) that guard a release.
- [Update the documentation](/contributing/documentation/) for the new version.
- [Read the upgrade notes](/releases/migration/) that users follow between releases.
