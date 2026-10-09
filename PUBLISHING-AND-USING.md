# Publish and Use VisualGuard from npm

This guide covers publishing the `visualguard` package and installing it in another project.

## Before publishing

The package is in [`packages/visualguard`](packages/visualguard). Its package metadata currently
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

Update `version` in [`packages/visualguard/package.json`](packages/visualguard/package.json), or
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

## 6. Install VisualGuard in another project

In the target project:

```bash
npm install --save-dev visualguard playwright
npx playwright install chromium
```

With pnpm:

```bash
pnpm add -D visualguard playwright
pnpm exec playwright install chromium
```

VisualGuard uses Playwright as a peer dependency, so install Playwright in the target project.

## 7. Add a VisualGuard configuration

Create `visualguard.config.ts` in the target project's root:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  baseURL: {
    production: "https://www.example.com",
    staging: "https://staging.example.com",
  },
  routes: ["/", "/pricing", "/checkout"],
  viewports: {
    desktop: { width: 1440, height: 900 },
    mobile: {
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
    },
  },
  ai: {
    provider: "gemini",
    model: "gemini-flash-latest",
  },
});
```

For an application with a discoverable Next.js route structure, routes can instead use:

```ts
routes: {
  discover: ["nextjs"],
  exclude: ["/admin/**"],
},
```

## 8. Configure the Gemini key safely

Create `.env.local` in the target project:

```env
GEMINI_API_KEY=your_actual_gemini_api_key
```

Add `.env.local` to the target project's `.gitignore` if it is not already ignored. Never put the
key in `visualguard.config.ts`, source code, or committed CI files.

VisualGuard loads `.env` and `.env.local` from the directory where the CLI is run. Shell
environment variables take precedence over values in those files.

For a one-time run:

```bash
GEMINI_API_KEY="your_actual_gemini_api_key" npx visualguard test --provider gemini
```

## 9. Run the comparison in the target project

Start the target project's production and staging/preview applications, then run:

```bash
npx visualguard doctor
npx visualguard test --provider gemini
npx visualguard report
```

Useful focused runs:

```bash
npx visualguard test --route /pricing
npx visualguard test --viewport mobile
npx visualguard test --list
```

The HTML report and run artifacts are written below:

```text
.visualguard/runs/
```

Add `.visualguard/` to `.gitignore` unless you intentionally commit selected baseline files.

## 10. Use baseline snapshots instead of two live environments

If the target project has only one environment, configure:

```ts
export default defineConfig({
  mode: "baseline",
  baseURL: {
    staging: "http://localhost:3000",
  },
  baseline: {
    dir: "visualguard/baselines",
  },
  routes: ["/", "/pricing"],
  ai: {
    provider: "gemini",
    model: "gemini-flash-latest",
  },
});
```

Create the initial snapshots:

```bash
npx visualguard test --provider gemini --update-baselines
```

Compare future runs:

```bash
npx visualguard test --provider gemini
npx visualguard report
```

Commit `visualguard/baselines/` when the team wants those screenshots to be the review baseline.
Only use `--update-baselines` when the visual change is intentional.

## 11. Run in CI

Store `GEMINI_API_KEY` as a repository secret, not as plain text in the workflow:

```yaml
- name: Run VisualGuard
  run: npx visualguard test --ci --provider gemini
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

For pull-request reporting, the repository's composite action can be used after installing the
project dependencies. See [`action/README.md`](action/README.md) for its inputs and outputs.
