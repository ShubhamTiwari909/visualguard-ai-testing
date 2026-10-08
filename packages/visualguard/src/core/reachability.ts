import { EnvironmentError, errorMessage } from "./errors.js";
import type { Env } from "./types.js";

export interface ReachabilityResult {
  env: Env;
  url: string;
  status: number;
}

/** Requests a base URL once. Any HTTP response counts as reachable; network errors do not. */
export async function checkReachable(
  env: Env,
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 15_000,
): Promise<ReachabilityResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    return { env, url, status: response.status };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : errorMessage(error);
    throw new EnvironmentError(`Could not reach ${env} (${url}): ${cause}`, {
      hint: "Check the URL and that the site is running. Use --staging/--production to point somewhere else.",
      cause: error,
    });
  }
}
