import { Command } from "commander";
import { VERSION } from "../core/version.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("visualguard")
    .description(
      "AI visual regression agent: compare production and staging, explain every difference.",
    )
    .version(VERSION, "-v, --version");

  return program;
}
