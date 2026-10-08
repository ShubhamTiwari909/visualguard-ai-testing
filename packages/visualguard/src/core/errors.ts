/** Exit codes, see PLAN.md §3.5. */
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

  constructor(message: string, options: { exitCode: ExitCode; hint?: string; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.exitCode = options.exitCode;
    this.hint = options.hint;
  }
}

/** Invalid config file or invalid CLI usage (exit code 2). */
export class ConfigError extends VisualGuardError {
  constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, { ...options, exitCode: ExitCode.Usage });
  }
}

/** Missing browser, unreachable URL, misconfigured provider (exit code 3). */
export class EnvironmentError extends VisualGuardError {
  constructor(message: string, options: { hint?: string; cause?: unknown } = {}) {
    super(message, { ...options, exitCode: ExitCode.Environment });
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
