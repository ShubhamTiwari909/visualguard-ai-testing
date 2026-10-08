#!/usr/bin/env node
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
