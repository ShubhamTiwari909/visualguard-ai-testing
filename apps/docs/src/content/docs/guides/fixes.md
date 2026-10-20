---
title: "Propose and verify a repair"
description: "Let VisualGuard find the source of a visual regression, propose an edit, apply it after you confirm and prove the page matches again."
audience: "developer"
docType: "how-to"
channel: "both"
lastReviewed: "2026-10-20"
sourcePaths: ["packages/visualguard/src/cli/commands/fix.ts", "packages/visualguard/src/fixer/fix.ts", "packages/visualguard/src/fixer/auto.ts", "packages/visualguard/src/fixer/verify.ts", "packages/visualguard/src/fixer/files.ts", "packages/visualguard/src/fixer/edits.ts", "packages/visualguard/src/cli/commands/report.ts", "packages/visualguard/src/config/schema.ts"]
sidebar: {"order": 12}
---

This page shows how to use `visualguard fix`. It reads a finished run, finds the source files most likely behind each regression, proposes a small edit and shows you the diff. After you say yes, it applies the edit, runs your checks and captures the page again on your local dev server. It keeps the edit only if the page now matches the reference screenshot.

Use it when a run finds regressions caused by your own code, such as a changed class or CSS value. You can run it in the terminal, from the HTML report, or fully automatically on a new Git branch.

## Before you start

- Have a finished run with at least one **regression** (or **review**, with `--include-review`). See [Run your first visual test](/start/quickstart/).
- Work in a Git repository. `fix` refuses to run without one, so every change can be reviewed and undone.
- Commit or stash your work first. By default, `fix` refuses to run on a working tree with uncommitted changes, including new untracked files. VisualGuard's own `.visualguard` folder and `visualguard.accepted.json` are ignored.
- Know how to start your app locally (for example `npm run dev`). VisualGuard needs a local server to check its edits.
- Optional: an AI provider ([Gemini](/guides/ai-gemini/) or [Ollama](/guides/ai-ollama/)) for changes the built-in rules cannot fix.
- Run commands from your app's root folder, where `visualguard.config.ts` lives.

## How a fix works

For each selected page, VisualGuard:

1. **Finds likely source files.** It matches the changed elements' classes, text and styles against your source files inside `fix.include`, and follows the page's imports. It ranks up to 5 candidate files. Files changed since `fix.compareRef` rank higher.
2. **Proposes an edit.** First it tries a **deterministic** fix with no AI: if a computed style changed and the source sets it in one obvious place, it puts the reference value back. This covers CSS declarations and common Tailwind classes for layout, spacing and colour. If that is not possible, it asks the AI provider for a search-and-replace edit.
3. **Shows you the diff** and asks before changing anything.
4. **Applies the edit and runs `fix.verify.commands`**, such as a type check. A failing command reverts the edit.
5. **Captures the page again** on `fix.verify.server` and compares it with the saved reference screenshot from the run. The page must now **pass**. If it does not, the edit is reverted and VisualGuard tries again with feedback, up to `fix.maxAttempts`.
6. **Checks the whole batch.** After all pages, it captures every page of the original run again to catch side effects. If any page changed that should not have, all edits from this batch are reverted.

The verification capture uses VisualGuard's own checks only. It does not use AI, and it turns off the noise map, so the repaired page must match the reference on its own.

## 1. Turn fixing on

Fixing is off by default. Add a `fix` block to `visualguard.config.ts`:

```ts
import { defineConfig } from "visualguard";

export default defineConfig({
  // ...your existing baseURL, routes and viewports
  fix: {
    enabled: true,
    include: ["app/**", "components/**", "styles/**"],
    verify: {
      server: {
        command: "npm run dev",
        url: "http://localhost:3000",
      },
      commands: ["npx tsc --noEmit"],
    },
  },
});
```

`verify.server.url` is where your local dev server answers. If something already answers there, VisualGuard uses it. If not, it runs `command`, waits for the URL to respond, and stops the server when it finishes. Use only commands your project already has in `verify.commands`, or leave the list empty.

You should see no error when you run `npx --no-install visualguard fix` next. Without `enabled: true`, it stops with `Fixing is turned off.`

### Fix options

| Option | What it does | Default |
| --- | --- | --- |
| `fix.enabled` | Allows `fix` and the report's **Generate fix** button. | `false` |
| `fix.requireConfirmation` | Ask before applying each proposal. | `true` |
| `fix.include` | Globs, relative to the project, for files the fixer may read and edit. | `["src/**", "app/**", "pages/**", "components/**", "styles/**", "lib/**"]` |
| `fix.compareRef` | Git ref, such as `"origin/main"`. Files changed since it rank first as likely causes. | none |
| `fix.verify.server.url` | Local server used to check each edit. Without a server, edits are applied but marked **unverified**. | none |
| `fix.verify.server.command` | Command that starts that server. Omit it to use a server you start yourself. | none |
| `fix.verify.server.readyTimeoutMs` | How long to wait for the server to respond. | `60000` |
| `fix.verify.commands` | Shell commands run after each edit. Any failure reverts the edit. | `[]` |
| `fix.verify.commandTimeoutMs` | Time limit for each command. | `300000` |
| `fix.maxAttempts` | Attempts per page (1 to 5). Only the first attempt tries the deterministic fix. | `2` |
| `fix.allowSourceUpload` | Consent in advance to send source excerpts to the AI provider. Needed for `--auto` with AI. | `false` |

### Files the fixer never edits

Whatever `fix.include` says, VisualGuard never reads or edits:

- `.env` files, lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`), any `*.config.js` or `*.config.ts` style file, and `visualguard.*` files.
- Files in `node_modules`, `.git`, `.next`, `dist`, `build`, `out`, `.turbo`, `.visualguard` and `coverage`, and other hidden folders.
- Files larger than 300 KB, and files that are not source files (it reads `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.vue`, `.svelte`, `.astro`, `.html`, `.css`, `.scss`, `.sass`, `.less`, `.md` and `.mdx`).

An AI edit is also rejected if it touches a file the model was not shown, or if its search text is missing or appears more than once.

## 2. Run fix in the terminal

```bash
npx --no-install visualguard fix
```

You should see, for each regression:

- `Likely source: components/Hero.tsx, …`
- A box titled `VisualGuard wants to modify components/Hero.tsx · deterministic` (or `· proposed by gemini`), with the reason and a coloured diff.
- The question `Apply this change?`. The default answer is **No**.

After you answer **Yes**:

- `Applied 1 edit`, then `✓` or `✖` for each verify command.
- `Re-capturing /pricing on http://localhost:3000`.
- Either `/pricing now matches production (0 differing pixels)`, or `Still differs; reverted.` followed by another attempt.

At the end, a **Summary** lists each page with a result, and the last line tells you to `Review the changes with git diff, then commit them.`

| Result | Meaning |
| --- | --- |
| `FIXED` | The edit is applied and the page now passes against the reference. |
| `UNVERIFIED` | The edit is applied, but there is no `fix.verify.server`, so it was not checked. |
| `REJECTED` | You answered No. Nothing was changed. |
| `SKIPPED` | No source file matched, no fix was found and no AI is configured, or you declined to send source code. |
| `FAILED` | Every attempt failed verification, or the batch check found a side effect. All edits for it were reverted. |

The command exits with code 0 only when every page is `FIXED`. Press Ctrl+C at a prompt to stop; changes already verified stay in place.

### Choose what to fix

```bash
# Only one route, and only the mobile viewport
npx --no-install visualguard fix /checkout --viewport mobile

# Every page under /blog, including pages marked review
npx --no-install visualguard fix "/blog/**" --include-review

# An older run, with uncommitted changes allowed
npx --no-install visualguard fix --run 12 --allow-dirty
```

| Flag | What it does | Default |
| --- | --- | --- |
| `[routes...]` | Routes or globs to fix. | Every regression in the run |
| `--run <id>` | Run ID, ID prefix or run number. | Latest run |
| `--viewport <name>` | Only this viewport. Repeat for more. | All viewports |
| `--include-review` | Also try pages marked **review**. | Regressions only |
| `--allow-dirty` | Allow uncommitted changes in the working tree. | Off |
| `-y, --yes` | Apply without asking. | Off |
| `--provider <name>` | `gemini`, `ollama` or `none`. | From config |
| `--model <id>` | AI model ID. | Provider default |
| `--no-ai` | Deterministic fixes only. | AI on if configured |
| `-c, --config <path>` | Config file path. | `visualguard.config.ts` |
| `--auto` | No prompts. Fix on a new branch and commit verified fixes. See [step 4](#4-fix-automatically-on-a-branch). | Off |
| `--pr` | With `--auto`: push the branch and open a pull request. | Off |
| `--base <branch>` | With `--pr`: base branch for the pull request. | Current branch |
| `--branch <name>` | With `--auto`: branch name. | `visualguard/fix-<run>-<id>` |
| `--in-place` | With `--auto`: use the current checkout instead of a separate worktree (for CI). | Off |
| `--keep-worktree` | With `--auto`: keep the worktree for inspection. | Off |

`--pr`, `--branch`, `--in-place` and `--keep-worktree` only work together with `--auto`.

:::note
In CI, or when the terminal is not interactive, VisualGuard cannot ask questions. Without `--yes` or `--auto`, every proposal is shown and then **rejected**.
:::

### Sending source code to the AI

The deterministic fix never sends anything anywhere. An AI proposal needs your source code, so the first time VisualGuard wants to use the AI it shows the list of files and asks `Allow sending source excerpts to gemini?` (default **No**).

What an AI proposal sends: the regression's description and AI analysis, up to two cropped screenshots (production and staging, when the provider accepts images), and excerpts of up to 5 candidate files. A file of 250 lines or fewer is sent whole; for longer files, about 25 lines around each match are sent.

Your answer is saved per provider in `.visualguard/consent.json`, so you are asked once. To give consent in advance, for example for `--auto`, set `fix.allowSourceUpload: true`. To take it back, delete `consent.json` and set `allowSourceUpload` to `false`.

AI patch requests share the same token and attempt budgets as analysis for that run. See [Control AI policy and cost](/guides/ai-policy-and-budgets/).

## 3. Fix from the HTML report

The served report has a **Generate fix** button on review and regression pages when `fix.enabled` is `true`.

```bash
npx --no-install visualguard report
```

1. Open a changed page and select **Generate fix**. The dialog shows `Finding the source and proposing a change…`.
2. Read the summary and diff. The label says `(deterministic)` or `(proposed by the AI provider)`.
3. Select **Apply and verify**. The dialog shows `Applying, running checks and re-capturing the page…`.
4. You should see a green message such as `/pricing now matches production (0 differing pixels)`, or a red `Reverted: …` message. Select **Close**; the report reloads after a success.

Differences from the terminal flow:

- The report makes **one** attempt per click, with no automatic retry.
- It cannot ask for consent. If an AI proposal needs it, the message tells you to run `npx visualguard fix` once in a terminal, or set `fix.allowSourceUpload: true`.
- It does not check for a clean working tree. Commit first so you can undo with Git.
- A proposal expires after one hour, and only one fix can be applied at a time.
- After the edit, it checks every page of the run for side effects before keeping it.

A static report opened from disk (`--no-serve`) cannot change files, so it has no **Generate fix** button.

## 4. Fix automatically on a branch

`--auto` runs without prompts. It never touches your current checkout: it creates a new branch in a separate Git worktree under `.visualguard/worktrees/`, links your `node_modules` into it, applies and verifies fixes there, and commits only **verified** fixes.

```bash
npx --no-install visualguard fix --auto
```

You should see `Working in … on branch visualguard/fix-12-ab12cd`, progress for each page, a result line per page and `Committed 1a2b3c4 on visualguard/fix-12-ab12cd`. If nothing could be verified, it prints `No fix could be verified; nothing was committed.` and deletes the branch.

`--auto` requires:

- `fix.verify.server`. Every automatic fix must be checked visually.
- Consent for AI in advance, either saved by an earlier terminal `fix` or `fix.allowSourceUpload: true`. Otherwise it stops with `Sending source code to … hasn't been allowed.`
- In a worktree, no server already running at `verify.server.url`, because that server would show your main checkout instead of the edits. Stop it, or use `--in-place`.

To also push the branch and open a pull request:

```bash
npx --no-install visualguard fix --auto --pr --base main
```

VisualGuard uses the GitHub CLI (`gh`) if it is signed in. Otherwise it uses the GitHub API with `GITHUB_TOKEN` (or `GH_TOKEN`), which needs `pull-requests: write`. The pull request lists each page's result and the diff of every verified fix.

In CI, where a separate worktree is not useful, add `--in-place`. It creates the branch in the current checkout, which must be clean.

## Where results are saved

Everything is saved inside the run folder, `.visualguard/runs/<run-id>/`:

| Path | What it holds |
| --- | --- |
| `fixes/<job>-<attempt>.json` | Each proposal: edits, diff, source (deterministic or AI), candidate files and the source revision. |
| `fixes/<job>-<attempt>.verification.json` | The result of checking that proposal, including command output. |
| `fix-checks/` | The verification captures, saved as small runs you can open. |
| `fix-results.json` | Final outcome for every page, AI usage, the source revision and the list of verification runs. |
| `ai-usage.json` | Running AI token and attempt totals for the run. |

## Example: undo three seeded regressions

The [Next.js example](/guides/nextjs-example/) seeds three Tailwind class changes: `items-center` to `items-start`, `bg-blue-600` to `bg-violet-600` and `p-6` to `p-3`. After `visualguard test` finds them, `visualguard fix --include-review --allow-dirty` proposes deterministic edits that put the original classes back, runs `pnpm exec tsc --noEmit`, re-captures each page on `http://localhost:3100` and reports `FIXED` for each. No AI is needed.

## Verify a fix before you keep it

1. Read the diff with `git diff`. A proposal is a suggestion, not proof.
2. Check the result is `FIXED`, not `UNVERIFIED`. Unverified edits were never captured.
3. Run your normal test suite.
4. Run `npx --no-install visualguard test` again. The fixed pages should now pass.
5. To see rollback work, try a fix in a throwaway branch with a verify command that fails, such as `"exit 1"`. The edit should be reverted.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `Fixing is turned off.` | Set `fix: { enabled: true }` in `visualguard.config.ts`. |
| `The working tree has uncommitted changes` | Commit or stash, or pass `--allow-dirty`. |
| `No source files matched this change (check fix.include).` | Add the folders that hold your components and styles to `fix.include`. |
| `No deterministic fix found, and no AI provider is configured` | Set up [Gemini](/guides/ai-gemini/) or [Ollama](/guides/ai-ollama/), or fix it by hand. |
| `Nothing is answering at http://…` | Start your dev server, or set `fix.verify.server.command`. |
| `The dev server didn't respond at …` | Raise `readyTimeoutMs`, or check the command output shown under the error. |
| `A server is already running at …` with `--auto` | Stop that server so VisualGuard can start one from the worktree, or use `--in-place`. |
| Every proposal ends as `REJECTED` in CI | The terminal is not interactive. Use `--auto`, or `--yes` if you accept unchecked edits. |
| `GITHUB_TOKEN is not set` with `--pr` | Sign in with `gh auth login`, or set `GITHUB_TOKEN` with `pull-requests: write`. |

Pages that need sign-in or custom hooks are re-captured with your current config, so keep [authentication](/guides/application-auth/) working. See [Troubleshooting](/troubleshooting/) for more.

## Next steps

- [Next.js example](/guides/nextjs-example/): try `fix` on seeded regressions.
- [Control AI policy and cost](/guides/ai-policy-and-budgets/): budgets shared by analysis and fixes.
- [Accept intentional changes](/guides/accepting-changes/): when a change is wanted, accept it instead of fixing it.
- [CLI reference](/reference/cli/): every command and flag.
