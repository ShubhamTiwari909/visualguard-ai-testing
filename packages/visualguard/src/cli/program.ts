/**
 * @file Creates the Commander program and registers every subcommand plus positional URL mode.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { Command } from "commander";
import { VERSION } from "../core/version.js";
import { registerAcceptCommand } from "./commands/accept.js";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerAuthCommand } from "./commands/auth.js";
import { registerCommentCommand } from "./commands/comment.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixCommand } from "./commands/fix.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMergeCommand } from "./commands/merge.js";
import { registerMonitorCommand } from "./commands/monitor.js";
import { registerReportCommand } from "./commands/report.js";
import { registerTestCommand } from "./commands/test.js";
import { registerWatchCommand } from "./commands/watch.js";
import { registerZeroConfigCommand } from "./commands/zero-config.js";

/**
 * Build the root Commander program and register all subcommands. The returned object can parse
 * real CLI arguments or be inspected by tests without running a command immediately.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("visualguard")
    .description(
      "AI visual regression agent: compare production and staging, explain every difference.",
    )
    .version(VERSION, "-v, --version")
    .showHelpAfterError()
    // Options after a subcommand belong to it: `test --viewport mobile` must not be taken by the
    // zero-config root command, which has options with the same names.
    .enablePositionalOptions()
    // Throw instead of exiting so main.ts can map usage errors to exit code 2.
    .exitOverride()
    .addHelpText(
      "after",
      `
Examples:
  $ npx visualguard https://example.com                          scan one site
  $ npx visualguard https://example.com https://staging.example.com
  $ npx visualguard init                                         set up a config
  $ npx visualguard test                                         run the configured comparison`,
    );

  registerZeroConfigCommand(program);
  registerInitCommand(program);
  registerDoctorCommand(program);
  registerTestCommand(program);
  registerMergeCommand(program);
  registerMonitorCommand(program);
  registerReportCommand(program);
  registerAnalyzeCommand(program);
  registerAcceptCommand(program);
  registerCommentCommand(program);
  registerFixCommand(program);
  registerWatchCommand(program);
  registerAuthCommand(program);
  return program;
}
