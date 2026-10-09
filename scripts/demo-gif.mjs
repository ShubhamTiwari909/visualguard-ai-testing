// Records the README demo GIF (docs/assets/demo.gif): a real `visualguard test` run against the
// fixture site, played back in a terminal, followed by three views of the HTML report.
//
//   pnpm demo:gif        builds first, then runs this script
//
// Storyboard: 1. terminal output line by line, 2. the /hidden regression in the report,
// 3. /dynamic-change in the diff view (red = real change, blue = ignored dynamic content),
// 4. /alignment side by side with its findings.
/* global document */ // used inside page.evaluate callbacks, which run in the browser
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import gifenc from "gifenc";
import { startFixtureServer } from "./fixture-server.mjs";

const { GIFEncoder, quantize, applyPalette } = gifenc;

const repoRoot = resolve(import.meta.dirname, "..");
const pkgDir = join(repoRoot, "packages/visualguard");
const cli = join(pkgDir, "dist/cli.js");
const output = join(repoRoot, "docs/assets/demo.gif");

// Playwright and pngjs are dependencies of the package, not of the workspace root.
const requireFromPkg = createRequire(join(pkgDir, "package.json"));
const { chromium } = requireFromPkg("playwright");
const { PNG } = requireFromPkg("pngjs");

const WIDTH = 960;
const HEIGHT = 600;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_DURATION_MS = 16_000;
const ROUTES = ["/identical", "/text-change", "/dynamic-change", "/alignment", "/hidden"];

// Frame timings (ms).
const PROMPT_MS = 600;
const LINE_MS = 120;
const TERMINAL_HOLD_MS = 2000;

/** Report scenes: hash route, hold time, and an optional element to scroll to the top. */
const SCENES = [
  { hash: "#/jobs/hidden__desktop", holdMs: 2500 },
  // The diff image starts below the fold; scroll the view switcher up so the red and blue show.
  { hash: "#/jobs/dynamic-change__desktop?view=diff", holdMs: 3000, scrollTo: "Side by side" },
  { hash: "#/jobs/alignment__desktop?view=side", holdMs: 2500 },
];

const execFileAsync = promisify(execFile);

/**
 * Runs `visualguard test --ci` against both fixture servers in a temp project and returns
 * { stdout, reportPath, cleanup }. The CLI runs asynchronously so the in-process servers can answer.
 */
async function runVisualGuard() {
  const production = await startFixtureServer("production", 0);
  const staging = await startFixtureServer("staging", 0);
  const work = realpathSync(mkdtempSync(join(tmpdir(), "visualguard-demo-")));
  const cleanup = async () => {
    await Promise.all([production.close(), staging.close()]);
    rmSync(work, { recursive: true, force: true });
  };
  try {
    const config = {
      baseURL: { production: production.url, staging: staging.url },
      routes: ROUTES,
      viewports: { desktop: { width: 1280, height: 800 } },
    };
    writeFileSync(
      join(work, "visualguard.config.ts"),
      `export default ${JSON.stringify(config, null, 2)};\n`,
    );
    let stdout;
    try {
      ({ stdout } = await execFileAsync("node", [cli, "test", "--ci"], {
        cwd: work,
        encoding: "utf8",
        // Heuristics only, whatever the caller's environment says.
        env: { ...process.env, VISUALGUARD_AI_PROVIDER: "none", NO_COLOR: "1" },
      }));
    } catch (error) {
      // Exit code 1 means "regressions found", which /hidden guarantees. Anything else is a failure.
      if (error.code !== 1) throw error;
      stdout = error.stdout;
    }
    const report = /Report\s+(\S+index\.html)/.exec(stdout)?.[1];
    if (!report) throw new Error(`No report path in CLI output:\n${stdout}`);
    return { stdout, reportPath: resolve(work, report), work, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

/** Strips ANSI codes and machine paths so only `.visualguard/...` relative paths remain. */
function cleanOutput(stdout, work) {
  return stdout
    .replace(/\x1b\[[0-9;]*m/g, "") // eslint-disable-line no-control-regex
    .replaceAll(`${work}/`, "")
    .replaceAll(work, ".")
    .replace(/\s+$/, "")
    .split("\n");
}

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const STATUS_COLOURS = { PASS: "#4ade80", REVIEW: "#fbbf24", REGRESSION: "#f87171" };

/** One terminal line as HTML, with the status words coloured. */
const lineHtml = (line) =>
  escapeHtml(line).replace(
    /\b(PASS|REVIEW|REGRESSION)\b/g,
    (word) => `<span style="color:${STATUS_COLOURS[word]};font-weight:600">${word}</span>`,
  );

/** The terminal page; every line starts hidden and the recorder reveals them one by one. */
function terminalHtml(lines) {
  const body = lines.map((line) => `<div class="line">${lineHtml(line) || " "}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #0f172a; overflow: hidden; }
    .bar { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 14px;
      background: #1e293b; border-bottom: 1px solid #334155; }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .screen { padding: 18px 22px; color: #e2e8f0;
      font: 14px/20px Menlo, Monaco, "SF Mono", Consolas, "DejaVu Sans Mono", monospace; }
    .line { white-space: pre-wrap; min-height: 20px; }
    .line.hidden { display: none; }
    .prompt { color: #4ade80; }
  </style></head><body>
    <div class="bar"><span class="dot" style="background:#f87171"></span>
      <span class="dot" style="background:#fbbf24"></span>
      <span class="dot" style="background:#4ade80"></span></div>
    <div class="screen">
      <div class="line"><span class="prompt">$</span> npx visualguard test</div>
      ${body.replaceAll('class="line"', 'class="line hidden"')}
    </div>
  </body></html>`;
}

/** Screenshot of the current page as raw RGBA pixels. */
async function grab(page) {
  const png = PNG.sync.read(await page.screenshot({ type: "png" }));
  return new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
}

/** Records the terminal: the prompt, then one frame per output line (blank lines ride along). */
async function recordTerminal(page, lines) {
  await page.setContent(terminalHtml(lines));
  const frames = [{ rgba: await grab(page), delay: PROMPT_MS, terminal: true }];
  for (let index = 0; index < lines.length; index++) {
    await page.evaluate(() =>
      document.querySelector(".screen .line.hidden")?.classList.remove("hidden"),
    );
    if (lines[index].trim() === "" && index < lines.length - 1) continue;
    const last = index === lines.length - 1;
    frames.push({
      rgba: await grab(page),
      delay: last ? TERMINAL_HOLD_MS : LINE_MS,
      terminal: !last,
    });
  }
  return frames;
}

/** Opens a report route and waits until the app has rendered and every image has loaded. */
async function recordScene(page, reportUrl, scene) {
  // A hash change alone keeps the previous scene's scroll position, so start from a blank page.
  await page.goto("about:blank");
  await page.goto(`${reportUrl}${scene.hash}`);
  const route = `/${scene.hash.split("/jobs/")[1].split("__")[0]}`;
  await page.locator("#job-title", { hasText: route }).waitFor();
  await page.waitForFunction(
    () =>
      document.images.length > 0 &&
      [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.evaluate(() => document.fonts.ready);
  if (scene.scrollTo) {
    await page
      .getByText(scene.scrollTo, { exact: true })
      .first()
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
  }
  await page.waitForTimeout(300); // let layout and image decoding settle
  return { rgba: await grab(page), delay: scene.holdMs };
}

/** Merges consecutive identical frames into one with the summed delay. */
function mergeDuplicates(frames) {
  const merged = [];
  for (const frame of frames) {
    const previous = merged.at(-1);
    if (previous && Buffer.compare(previous.rgba, frame.rgba) === 0) {
      previous.delay += frame.delay;
    } else {
      merged.push({ ...frame });
    }
  }
  return merged;
}

/** Encodes frames as a looping GIF, quantising each frame to its own palette. */
function encode(frames, colours) {
  const gif = GIFEncoder();
  frames.forEach((frame, index) => {
    const palette = quantize(frame.rgba, colours);
    const indexed = applyPalette(frame.rgba, palette);
    gif.writeFrame(indexed, WIDTH, HEIGHT, {
      palette,
      delay: frame.delay,
      ...(index === 0 ? { repeat: 0 } : {}),
    });
  });
  gif.finish();
  return gif.bytes();
}

/**
 * Drops every other mid-animation terminal frame, giving its time to the frame before it so the
 * total duration stays the same.
 */
function thinTerminal(frames) {
  const thinned = [];
  let skip = false;
  for (const frame of frames) {
    if (frame.terminal && skip && thinned.length > 0) thinned.at(-1).delay += frame.delay;
    else thinned.push({ ...frame });
    if (frame.terminal) skip = !skip;
  }
  return thinned;
}

const { stdout, reportPath, work, cleanup } = await runVisualGuard();
let frames;
try {
  const browser = await chromium.launch();
  try {
    const terminalPage = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    const terminal = await recordTerminal(terminalPage, cleanOutput(stdout, work));

    const reportPage = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const reportUrl = `file://${reportPath}`;
    const report = [];
    for (const scene of SCENES) report.push(await recordScene(reportPage, reportUrl, scene));

    frames = mergeDuplicates([...terminal, ...report]);
  } finally {
    await browser.close();
  }
} finally {
  await cleanup();
}

const duration = frames.reduce((sum, frame) => sum + frame.delay, 0);
if (duration > MAX_DURATION_MS) {
  throw new Error(`Demo is ${duration} ms long, over the ${MAX_DURATION_MS} ms budget`);
}

// Fit under 3 MB: fewer colours first, then fewer terminal frames.
let bytes;
let colours = 256;
for (;;) {
  bytes = encode(frames, colours);
  if (bytes.length <= MAX_BYTES) break;
  if (colours > 64) colours /= 2;
  else if (thinTerminal(frames).length < frames.length) frames = thinTerminal(frames);
  else throw new Error(`GIF is ${bytes.length} bytes even at ${colours} colours`);
}

mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, bytes);
console.log(
  `demo.gif: ${frames.length} frames · ${(duration / 1000).toFixed(1)}s · ` +
    `${(bytes.length / 1024).toFixed(0)} KB · ${colours} colours → ${output}`,
);
