---
title: "Prepare a package release"
description: "Understand Changesets, package inspection, artifact validation and publication confirmation."
audience: "contributor"
docType: "how-to"
channel: "source"
lastReviewed: "2026-10-20"
verifiedAgainst: "visualguard 3.2.3 / source 69ccdf1"
sourcePaths: ["PUBLISHING-AND-USING.md"]
sidebar: {"order": 6}
---

## Before you start

This page is for authorized maintainers with repository/npm release access. Use a clean release branch, the documented Node/pnpm versions and the release's required checks. Publication, version changes and live deployment are explicit maintainer actions. Do not infer successful publication from a local manifest or Git tag.

Under the current sequence, formatting/lint/type checks are deferred. Do not run historical full-validation commands below until that instruction is changed or the F36 boundary is reached. Focused build/pack/behavior checks are available now; record this limitation in release readiness.

## Release workflow

This guide covers publishing the `visualguard` package and installing it in another project.

## Before publishing

The package is in [`packages/visualguard`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/packages/visualguard). Its package metadata currently
declares version `0.7.0` and requires Node.js `>= 22.12`.

The package is not published automatically by `pnpm build`; build and publish are separate steps.
First confirm that the npm package name is available:

```bash
npm view visualguard version
```

If npm returns a version, the name is already registered. Choose an available package name or
publish under an npm scope, then update the package `name` and any documentation references.

## 1. Log in to npm

```bash
npm login
npm whoami
```

Use an npm account with publish permission for the package name. If the package is scoped and
should be publicly installable, publish it with `--access public`.

## 2. Choose a release version

Update `version` in [`packages/visualguard/package.json`](https://github.com/ShubhamTiwari909/visualguard-ai-testing/blob/main/packages/visualguard/package.json), or
use the repository's Changesets workflow:

```bash
pnpm changeset
pnpm version-packages
```

Review the generated version and changelog changes before publishing. Do not reuse a version that
already exists on npm; npm versions are immutable.

## 3. Build and validate

From the repository root:

```bash
pnpm install
pnpm --filter visualguard exec playwright install chromium
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

The package publishes the `dist` directory because `packages/visualguard/package.json` contains:

```json
"files": ["dist"]
```

## 4. Inspect the package tarball

Create a local tarball before publishing:

```bash
pnpm --filter visualguard pack
```

Inspect the generated `.tgz` file and confirm that it contains the compiled CLI, API, Playwright
entry point, type declarations, and report assets. It must not contain `.env` files, API keys,
source secrets, or workspace-only files.

## 5. Publish

For the unscoped package:

```bash
cd packages/visualguard
npm publish
```

For a public scoped package:

```bash
cd packages/visualguard
npm publish --access public
```

Verify the published package:

```bash
npm view visualguard version
```

The repository also has a Changesets release script:

```bash
pnpm release
```

Use that only after configuring the repository's release credentials and trusted publishing
workflow. It builds the package and runs `changeset publish`.



## Confirm the published artifact

Query the registry, install that exact version in a fresh consumer project, and compare package metadata with the CLI-reported build version. Test the report, optional dashboard assets and generated scaffold dependency version. Do not label a release published until registry/artifact evidence confirms it.

Consumer instructions live in [installation](/start/install/) and [baseline guides](/guides/local-baselines/); keep the npm README small and its links release-appropriate. Update central website release data only after publication is verified.
