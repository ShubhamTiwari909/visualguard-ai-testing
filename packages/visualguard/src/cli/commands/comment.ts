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
