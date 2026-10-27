/**
 * @file Tests that pausing media settles quickly and never hangs, in a real browser.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { holdMedia, pauseMedia } from "../src/capture/stabilize.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
  server = await startFixtureServer("production");
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Open a fixture-origin page whose body is the given HTML, so video URLs resolve against the
 * fixture server.
 */
async function open(html: string, setup?: (page: Page) => Promise<void>) {
  const page = await browser.newPage();
  await setup?.(page);
  await page.goto(`${server.url}/identical`);
  await page.setContent(html);
  return page;
}

/** Run pauseMedia and report how long it took. */
async function timed(page: Page, timeoutMs?: number) {
  const started = Date.now();
  await pauseMedia(page, timeoutMs);
  return Date.now() - started;
}

const VIDEO = '<video autoplay muted loop playsinline src="/clip.webm"></video>';

describe("holdMedia", () => {
  it("keeps an autoplaying video on its first frame without seeking", async () => {
    const page = await browser.newPage();
    await holdMedia(page);
    await page.goto(`${server.url}/video`);
    await page.waitForFunction(() => document.querySelector("video")!.readyState >= 2);
    // Long enough for an unheld video to be several frames in.
    await page.waitForTimeout(600);
    expect(
      await page.evaluate(async () => {
        const video = document.querySelector("video")!;
        await video.play();
        return { paused: video.paused, played: video.played.length, time: video.currentTime };
      }),
    ).toEqual({ paused: true, played: 0, time: 0 });
    expect(await timed(page)).toBeLessThan(1_000);
    await page.close();
  });
});

describe("pauseMedia", () => {
  it("rewinds a playing video to its first frame", async () => {
    const page = await open(VIDEO);
    await page.waitForFunction(() => document.querySelector("video")!.currentTime > 0.2);
    expect(await timed(page)).toBeLessThan(2_000);
    expect(
      await page.evaluate(() => {
        const video = document.querySelector("video")!;
        return { paused: video.paused, time: video.currentTime, seeking: video.seeking };
      }),
    ).toEqual({ paused: true, time: 0, seeking: false });
    await page.close();
  });

  it("does not hang when the test has paused the page clock", async () => {
    const page = await open(VIDEO, async (target) => {
      await target.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
    });
    await page.waitForFunction(() => document.querySelector("video")!.readyState >= 2);
    await page.clock.pauseAt(new Date("2026-01-01T00:00:10Z"));
    expect(await timed(page)).toBeLessThan(2_000);
    expect(await page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
    await page.close();
  });

  it("returns at once for videos that will never load", async () => {
    const page = await open(
      '<video poster="/product.svg"></video><video preload="none" src="/clip.webm"></video>',
    );
    expect(await timed(page)).toBeLessThan(1_000);
    await page.close();
  });

  it("gives up after the time limit for a video that loads too slowly", async () => {
    const page = await open('<video src="/clip.webm?delay=5000"></video>');
    const elapsed = await timed(page, 300);
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(2_000);
    await page.close();
  });
});
