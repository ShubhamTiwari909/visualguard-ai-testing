import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, relative, resolve } from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadPlaywright } from "../../capture/browser.js";
import { ConfigError } from "../../core/errors.js";
import type { Env } from "../../core/types.js";
import { loadResolvedConfig } from "../shared.js";

export interface AuthFlags {
  config?: string;
  url?: string;
  out?: string;
  /** Save automatically once the page URL matches this glob (scripted logins). */
  untilUrl?: string;
  headless?: boolean;
}

export function registerAuthCommand(program: Command): void {
  program
    .command("auth")
    .description("log in once in a browser window and save the session for captures")
    .argument("<env>", "production or staging")
    .option("-c, --config <path>", "config file path")
    .option("--url <url>", "page to open (default: the environment's base URL)")
    .option("--out <path>", "where to save the session (default: .visualguard/auth/<env>.json)")
    .option(
      "--until-url <glob>",
      "save automatically when the page reaches this URL, e.g. '**/dashboard'",
    )
    .action(async (env: string, flags: AuthFlags) => {
      await runAuth(env, flags);
    });
}

/**
 * Opens a visible browser at the environment's URL; after you log in, saves cookies and storage
 * as Playwright storageState, which `environments.<env>.storageState` then uses for every
 * capture (PLAN.md §7.2).
 */
export async function runAuth(envName: string, flags: AuthFlags): Promise<string> {
  if (envName !== "production" && envName !== "staging") {
    throw new ConfigError(`Unknown environment "${envName}"`, {
      hint: "Use production or staging.",
    });
  }
  const env = envName as Env;
  const config = await loadResolvedConfig({ config: flags.config });
  const url = flags.url ?? config.baseURL[env];
  if (!url) throw new ConfigError(`No URL for ${env}: set baseURL.${env} or pass --url.`);
  const out = resolve(config.cwd, flags.out ?? `${config.output.dir}/auth/${env}.json`);

  const playwright = await loadPlaywright();
  const browser = await playwright[config.browser.name].launch({
    headless: flags.headless ?? false,
  });
  try {
    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    await page.goto(url);
    if (flags.untilUrl) {
      process.stdout.write(`  Waiting for ${flags.untilUrl}…\n`);
      await page.waitForURL(flags.untilUrl, { timeout: 10 * 60_000 });
    } else {
      process.stdout.write(
        `\n  Log in in the browser window, then press ${pc.bold("Enter")} here to save the session.\n`,
      );
      const reader = createInterface({ input: process.stdin });
      await new Promise<void>((done) => {
        reader.once("line", () => done());
        browser.once("disconnected", () => done());
      });
      reader.close();
      if (!browser.isConnected())
        throw new ConfigError("The browser was closed before the session was saved.");
    }
    mkdirSync(dirname(out), { recursive: true });
    await context.storageState({ path: out });
  } finally {
    await browser.close().catch(() => {});
  }

  const rel = relative(config.cwd, out) || out;
  process.stdout.write(
    `\n  ${pc.green("✓")} Saved the ${env} session to ${rel}\n\n  Use it in visualguard.config.ts:\n\n` +
      `    environments: { ${env}: { storageState: "${rel}" } },\n\n` +
      `  ${pc.dim("Keep this file out of git: it contains your login cookies.")}\n\n`,
  );
  return out;
}
