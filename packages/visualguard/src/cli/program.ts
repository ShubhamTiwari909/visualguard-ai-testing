import { Command } from "commander";
import { VERSION } from "../core/version.js";
import { registerAcceptCommand } from "./commands/accept.js";
import { registerAnalyzeCommand } from "./commands/analyze.js";
import { registerCommentCommand } from "./commands/comment.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFixCommand } from "./commands/fix.js";
import { registerInitCommand } from "./commands/init.js";
import { registerReportCommand } from "./commands/report.js";
import { registerTestCommand } from "./commands/test.js";
import { registerZeroConfigCommand } from "./commands/zero-config.js";

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
  registerReportCommand(program);
  registerAnalyzeCommand(program);
  registerAcceptCommand(program);
  registerCommentCommand(program);
  registerFixCommand(program);
  return program;
}
