import type { Page } from "playwright";
import type { HealthSignals } from "../core/types.js";

/** Attach before navigation to retain events from the entire page lifetime. */
export function instrumentHealth(page: Page): { health: HealthSignals; dispose(): void } {
  const health: HealthSignals = { consoleErrors: [], failedRequests: [], brokenImages: [] };
  const consoleError = (message: import("playwright").ConsoleMessage) => {
    if (message.type() === "error") health.consoleErrors.push(message.text().slice(0, 500));
  };
  const pageError = (error: Error) => health.consoleErrors.push(error.message.slice(0, 500));
  const failed = (request: import("playwright").Request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (!reason.includes("ERR_BLOCKED_BY_CLIENT"))
      health.failedRequests.push(`${reason} ${request.url()}`);
  };
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
    dispose() {
      page.off("console", consoleError);
      page.off("pageerror", pageError);
      page.off("requestfailed", failed);
      page.off("response", response);
    },
  };
}
