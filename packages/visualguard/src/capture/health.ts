/**
 * @file Attaches console/page-error/request listeners to a page and exposes cleanup for
 * collected signals.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import type { Page } from "playwright";
import type { HealthSignals } from "../core/types.js";

/**
 * Attach before navigation to retain events from the entire page lifetime.
 *
 * Attach event handlers and return both the collected evidence and a cleanup function. Start
 * before navigation to observe failures from the full page lifetime.
 */
export function instrumentHealth(page: Page): { health: HealthSignals; dispose(): void } {
  const health: HealthSignals = { consoleErrors: [], failedRequests: [], brokenImages: [] };
  /**
   * Record browser console messages only when their level is error. Truncate text to keep
   * report artifacts from growing without a bound per message.
   */
  const consoleError = (message: import("playwright").ConsoleMessage) => {
    if (message.type() === "error") health.consoleErrors.push(message.text().slice(0, 500));
  };
  /**
   * Record an uncaught browser JavaScript error as console-health evidence. This callback is
   * invoked by Playwright when page code throws.
   */
  const pageError = (error: Error) => health.consoleErrors.push(error.message.slice(0, 500));
  /**
   * Record a failed network request unless it was deliberately blocked by capture policy.
   * Optional chaining ?. handles a missing failure description without throwing.
   */
  const failed = (request: import("playwright").Request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (!reason.includes("ERR_BLOCKED_BY_CLIENT"))
      health.failedRequests.push(`${reason} ${request.url()}`);
  };
  /**
   * Record HTTP error responses and the final main-document status/URL. Checking both the
   * navigation request and main frame avoids mistaking an iframe response for the page.
   */
  const response = (value: import("playwright").Response) => {
    if (value.status() >= 400) health.failedRequests.push(`${value.status()} ${value.url()}`);
    if (value.request().isNavigationRequest() && value.frame() === page.mainFrame()) {
      health.status = value.status();
      health.finalURL = value.url();
    }
  };
  page.on("console", consoleError);
  page.on("pageerror", pageError);
  page.on("requestfailed", failed);
  page.on("response", response);
  return {
    health,
    /**
     * Remove exactly the event-handler functions installed by instrumentHealth. Keeping the
     * same function references is necessary for off to unregister them.
     */
    dispose() {
      page.off("console", consoleError);
      page.off("pageerror", pageError);
      page.off("requestfailed", failed);
      page.off("response", response);
    },
  };
}
