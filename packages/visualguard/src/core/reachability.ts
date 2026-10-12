/**
 * @file Performs an upfront base-URL reachability check and returns environment diagnostics.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { EnvironmentError, errorMessage } from "./errors.js";
import type { Env } from "./types.js";

export interface ReachabilityResult {
  env: Env;
  url: string;
  status: number;
}

/**
 * Requests a base URL once. Any HTTP response counts as reachable; network errors do not.
 *
 * Probe an environment URL with a bounded GET request before starting expensive capture work.
 * Any HTTP response proves network reachability; connection failures become an EnvironmentError
 * with a troubleshooting hint.
 */
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
