#!/usr/bin/env node
/**
 * @file Executable CLI entry: parses arguments, catches command errors and assigns process exit
 * codes.
 *
 * This is the executable entry point used by the visualguard command. It parses process
 * arguments and translates command errors into process exit codes.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { CommanderError } from "commander";
import { ExitCode } from "../core/errors.js";
import { createProgram } from "./program.js";
import { reportError } from "./shared.js";

const SUCCESS_CODES = new Set(["commander.helpDisplayed", "commander.help", "commander.version"]);

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    // Commander has already printed the message.
    process.exitCode = SUCCESS_CODES.has(error.code) ? ExitCode.Ok : ExitCode.Usage;
  } else {
    process.exitCode = reportError(error);
  }
}
