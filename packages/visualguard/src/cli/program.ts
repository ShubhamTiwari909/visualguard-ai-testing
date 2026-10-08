import { Command } from "commander";
import { VERSION } from "../core/version.js";
import { registerTestCommand } from "./commands/test.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("visualguard")
    .description(
      "AI visual regression agent: compare production and staging, explain every difference.",
    )
    .version(VERSION, "-v, --version")
    .showHelpAfterError()
    // Throw instead of exiting so main.ts can map usage errors to exit code 2.
    .exitOverride();

  registerTestCommand(program);
  return program;
}
