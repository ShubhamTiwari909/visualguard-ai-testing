/**
 * @file Defines categorized usage/environment errors, exit codes and readable error messages.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

/**
 * Exit codes, see PLAN.md §3.5.
 */
export const ExitCode = {
  Ok: 0,
  Failed: 1,
  Usage: 2,
  Environment: 3,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class VisualGuardError extends Error {
  readonly exitCode: ExitCode;
  readonly hint: string | undefined;

  /**
   * Create a package error with an exit code, optional user hint and original cause.
   * new.target.name identifies the actual subclass so diagnostics preserve its specific error
   * name.
   */
  constructor(message: string, options: { exitCode: ExitCode; hint?: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.exitCode = options.exitCode;
    this.hint = options.hint;
  }
}

/**
 * Invalid config file or invalid CLI usage (exit code 2).
 */
export class ConfigError extends VisualGuardError {
  /**
   * Create a configuration/usage error with the package's usage exit code. Spread the caller's
   * options first and then set the category-specific code.
   */
  constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, { ...options, exitCode: ExitCode.Usage });
  }
}

/**
 * Missing browser, unreachable URL, misconfigured provider (exit code 3).
 */
export class EnvironmentError extends VisualGuardError {
  /**
   * Create an environment error with the package's environment exit code. This distinguishes
   * missing dependencies or unreachable services from test regressions.
   */
  constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, { ...options, exitCode: ExitCode.Environment });
  }
}

/**
 * Extract a readable message from an unknown caught value. JavaScript can throw strings or
 * other values as well as Error instances, so String handles the fallback.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
