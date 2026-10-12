/**
 * @file Loads Playwright lazily, launches the selected engine and creates isolated contexts
 * with auth/render/network settings.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Browser, BrowserContext } from "playwright";
import type { ResolvedConfig } from "../config/resolve.js";
import type { ViewportConfig } from "../config/schema.js";
import { EnvironmentError, errorMessage } from "../core/errors.js";
import type { Env } from "../core/types.js";

type Playwright = typeof import("playwright");

const INSTALL_HINT =
  "Install it with: npm install -D playwright && npx playwright install chromium";

/**
 * Import Playwright only when capture needs it. Convert a missing optional installation into an
 * EnvironmentError with an actionable install hint.
 */
export async function loadPlaywright(): Promise<Playwright> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new EnvironmentError("Playwright is not installed.", {
      hint: INSTALL_HINT,
      cause: error,
    });
  }
}

/**
 * Read the installed Playwright package version for provenance. Return undefined when it cannot
 * be resolved, rather than failing an otherwise readable report.
 */
export function playwrightVersion(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return (require("playwright/package.json") as { version: string }).version;
  } catch {
    return undefined;
  }
}

/**
 * Launch the configured browser engine and turn launch failures into useful environment errors.
 * Missing browser binaries receive a specific installation command.
 */
export async function launchBrowser(config: ResolvedConfig): Promise<Browser> {
  const playwright = await loadPlaywright();
  const browserType = playwright[config.browser.name];
  try {
    return await browserType.launch({ headless: config.browser.headless });
  } catch (error) {
    const message = errorMessage(error);
    if (/Executable doesn't exist|playwright install/i.test(message)) {
      throw new EnvironmentError(`Playwright's ${config.browser.name} browser is not installed.`, {
        hint: `Run: npx playwright install ${config.browser.name}`,
        cause: error,
      });
    }
    throw new EnvironmentError(`Could not launch ${config.browser.name}: ${message}`, {
      cause: error,
    });
  }
}

/**
 * Create an isolated browser session with the chosen viewport, headers, storage and environment
 * options. A context separates cookies and storage from other capture jobs and installs
 * request-blocking rules before navigation.
 */
export async function createContext(
  browser: Browser,
  config: ResolvedConfig,
  env: Env,
  viewport: ViewportConfig,
): Promise<BrowserContext> {
  const envOptions = config.environments[env] ?? {};
  const headers = Object.fromEntries(
    Object.entries(envOptions.headers ?? {}).filter(([, value]) => value !== ""),
  );

  let storageState: string | undefined;
  if (envOptions.storageState) {
    storageState = resolve(config.cwd, envOptions.storageState);
    if (!existsSync(storageState)) {
      throw new EnvironmentError(`storageState file for ${env} not found: ${storageState}`);
    }
  }

  const supportsMobile = config.browser.name !== "firefox";
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor ?? config.browser.deviceScaleFactor,
    isMobile: supportsMobile ? viewport.isMobile : undefined,
    hasTouch: viewport.hasTouch,
    locale: config.browser.locale,
    timezoneId: config.browser.timezoneId,
    colorScheme: config.browser.colorScheme,
    reducedMotion: "reduce",
    extraHTTPHeaders: headers,
    storageState,
    // Injected stabilisation CSS must work on sites with a strict Content-Security-Policy.
    bypassCSP: true,
    ignoreHTTPSErrors: config.browser.ignoreHTTPSErrors,
    // Service workers can serve stale assets on one side only.
    serviceWorkers: "block",
  });
  context.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);
  context.setDefaultTimeout(config.browser.actionTimeoutMs);

  for (const pattern of config.stabilize.blockRequests) {
    await context.route(pattern, (route) => route.abort("blockedbyclient"));
  }
  return context;
}
