/**
 * @file Finds the associated GitHub PR and posts/updates a sticky Markdown run-summary comment.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Command } from "commander";
import { findRun, readManifest } from "../../core/runs.js";
import { githubContext, findPullForCommit, upsertComment } from "../../reporters/github-comment.js";
import { renderMarkdown } from "../../reporters/markdown.js";
import { loadResolvedConfig, parsePositiveInt } from "../shared.js";

export interface CommentFlags {
  config?: string;
  run?: string;
  link?: string;
  pr?: number;
  repo?: string;
  dryRun?: boolean;
}

/**
 * Register the comment command, its arguments and flags on the shared Commander program.
 * Registration describes what the CLI accepts; its action callback runs only when the user
 * invokes the command.
 */
export function registerCommentCommand(program: Command): void {
  program
    .command("comment")
    .description("post or update the VisualGuard comment on the pull request (CI)")
    .option("-c, --config <path>", "config file path")
    .option("--run <id>", "run id, id prefix or run number (default: latest)")
    .option("--link <url>", "link to the full report, e.g. the uploaded artifact URL")
    .option(
      "--pr <number>",
      "pull request number (default: from the GitHub event)",
      parsePositiveInt,
    )
    .option("--repo <owner/name>", "repository (default: GITHUB_REPOSITORY)")
    .option("--dry-run", "print the comment instead of posting it")
    .action(async (flags: CommentFlags) => {
      await runCommentCommand(flags);
    });
}

/**
 * Upserts one sticky comment per PR (PLAN.md §12.3). Run it after uploading the report so the
 * comment can link to it. Outside a PR (and with no PR for the commit) it does nothing.
 *
 * Load a finished run and post or update its marked GitHub PR comment. Resolve the PR from
 * explicit flags or CI context, and leave non-PR runs without a matching PR alone.
 */
export async function runCommentCommand(
  flags: CommentFlags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = await loadResolvedConfig({ config: flags.config });
  const { dir } = findRun(config.outputDir, flags.run);
  const manifest = readManifest(dir);
  const body = renderMarkdown(manifest, {
    marker: true,
    reportURL: flags.link || config.report.publicURL,
  });

  if (flags.dryRun) {
    process.stdout.write(`${body}\n`);
    return;
  }

  const context = githubContext(env, { repo: flags.repo, pr: flags.pr });
  const pullNumber = context.pullNumber ?? (await findPullForCommit(context));
  if (!pullNumber) {
    process.stdout.write(
      "  No pull request for this run; skipping the comment (the job summary still has the results).\n",
    );
    return;
  }
  const result = await upsertComment(context, pullNumber, body);
  process.stdout.write(
    `  ${result.action === "created" ? "Posted" : "Updated"} the VisualGuard comment on PR #${pullNumber}: ${result.url}\n`,
  );
}
