import { z } from "zod";
import type { Env } from "../core/types.js";

/** Context passed to the capture hooks. `page` is a Playwright `Page`. */
export interface CaptureHookContext {
  page: import("playwright").Page;
  env: Env;
  route: string;
  url: string;
  viewport: string;
}

export type CaptureHook = (context: CaptureHookContext) => void | Promise<void>;

const isHttpURL = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const urlSchema = z
  .string()
  .refine(isHttpURL, { message: "expected an http(s) URL, e.g. https://example.com" });

export const routePathSchema = z.string().refine((value) => value.startsWith("/"), {
  message: 'routes must be paths starting with "/" (e.g. "/pricing"), not full URLs',
});

const selectorListSchema = z.array(z.string().min(1));

export const routeObjectSchema = z.object({
  path: routePathSchema,
  /** Display name; defaults to the path. */
  name: z.string().min(1).optional(),
  /** Wait for this selector to be visible before capturing. */
  waitFor: z.string().min(1).optional(),
  /** Values for dynamic segments, one job per entry: `[{ slug: "hello-world" }]`. */
  params: z.array(z.record(z.string(), z.union([z.string(), z.array(z.string())]))).optional(),
  /** Path to use on production when it differs from `path`. */
  production: routePathSchema.optional(),
  /** Path to use on staging when it differs from `path`. */
  staging: routePathSchema.optional(),
  /** Masked areas keep their size, so mask fixed-size containers rather than variable text. */
  mask: selectorListSchema.optional(),
  hide: selectorListSchema.optional(),
});

export const routeInputSchema = z.union([routePathSchema, routeObjectSchema]);

export const discoverySourceSchema = z.enum(["nextjs", "sitemap", "crawl"]);

export const routeDiscoverySchema = z.object({
  discover: z.array(discoverySourceSchema).min(1),
  /** Routes discovery cannot find, e.g. "/search?q=shoes". */
  extra: z.array(routeInputSchema).optional(),
  /** Only keep discovered paths matching one of these globs. */
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  limit: z.number().int().positive().default(50),
  crawlDepth: z.number().int().min(0).max(5).default(2),
});

export const viewportSchema = z.object({
  width: z.number().int().min(200).max(7680),
  height: z.number().int().min(200).max(4320),
  isMobile: z.boolean().optional(),
  hasTouch: z.boolean().optional(),
  deviceScaleFactor: z.number().positive().max(4).optional(),
});

const environmentOptionsSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  storageState: z.string().optional(),
});

const hookSchema = z.custom<CaptureHook>((value) => typeof value === "function", {
  message: "expected a function",
});

/**
 * The full config schema. Everything is optional for users; defaults are filled in here.
 * Nested objects use `.prefault({})` so their own defaults are applied (zod 4 semantics).
 */
export const configSchema = z.object({
  /**
   * "compare": production vs staging, both live. "baseline": the site (baseURL.staging) vs
   * screenshots committed in `baseline.dir` (PLAN.md §14.2).
   */
  mode: z.enum(["compare", "baseline"]).default("compare"),
  baseline: z
    .object({
      /** Commit this directory (Git LFS works well for the images). */
      dir: z.string().default("visualguard/baselines"),
    })
    .prefault({}),

  baseURL: z
    .object({
      production: urlSchema.optional(),
      staging: urlSchema.optional(),
    })
    .prefault({}),

  routes: z.union([z.array(routeInputSchema), routeDiscoverySchema]).optional(),

  viewports: z
    .record(
      z.string().regex(/^[a-z0-9-]+$/i, "viewport names may only use letters, digits and -"),
      viewportSchema,
    )
    .refine((value) => Object.keys(value).length > 0, { message: "define at least one viewport" })
    .default({ desktop: { width: 1440, height: 900 } }),

  browser: z
    .object({
      name: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
      locale: z.string().default("en-US"),
      timezoneId: z.string().default("UTC"),
      colorScheme: z.enum(["light", "dark", "no-preference"]).default("light"),
      deviceScaleFactor: z.number().positive().max(4).default(1),
      navigationTimeoutMs: z.number().int().positive().default(30_000),
      /** Timeout for waits such as a route's `waitFor` selector. */
      actionTimeoutMs: z.number().int().positive().default(15_000),
      headless: z.boolean().default(true),
      ignoreHTTPSErrors: z.boolean().default(false),
    })
    .prefault({}),

  environments: z
    .object({
      production: environmentOptionsSchema.optional(),
      staging: environmentOptionsSchema.optional(),
    })
    .prefault({}),

  stabilize: z
    .object({
      disableAnimations: z.boolean().default(true),
      /** ISO timestamp to freeze `Date` at, or false. */
      freezeTime: z.union([z.string(), z.literal(false)]).default(false),
      /**
       * Pause the page clock (timers and requestAnimationFrame) right before the screenshot, so
       * JavaScript-driven animations stop. Uses Playwright's Clock API.
       */
      pauseClock: z.boolean().default(true),
      /** Pause videos and SVG animations at their first frame. */
      pauseMedia: z.boolean().default(true),
      waitForFonts: z.boolean().default(true),
      networkQuietMs: z.number().int().min(0).default(500),
      networkQuietTimeoutMs: z.number().int().positive().default(10_000),
      scrollToLoad: z.boolean().default(true),
      /** Hide common cookie banners and chat widgets. */
      hideDefaults: z.boolean().default(true),
      hide: selectorListSchema.default([]),
      mask: selectorListSchema.default([]),
      blockRequests: z.array(z.string()).default([]),
      retries: z.number().int().min(0).max(5).default(2),
      stabilityAttempts: z.number().int().min(1).max(10).default(3),
      stabilityIntervalMs: z.number().int().min(0).default(150),
    })
    .prefault({}),

  screenshot: z
    .object({
      fullPage: z.boolean().default(true),
      maxHeight: z.number().int().positive().default(15_000),
    })
    .prefault({}),

  diff: z
    .object({
      engine: z.enum(["pixelmatch"]).default("pixelmatch"),
      /** Per-pixel colour tolerance, 0–1. */
      threshold: z.number().min(0).max(1).default(0.1),
      /** The job passes if at most this many pixels differ… */
      maxDiffPixels: z.number().int().min(0).default(20),
      /** …or if at most this share of pixels differ (0 disables the ratio check). */
      maxDiffRatio: z.number().min(0).max(1).default(0),
      ignoreAntialiasing: z.boolean().default(true),
      maxRegions: z.number().int().positive().default(10),
      regionCellSize: z.number().int().min(4).max(64).default(16),
      regionMergeDistance: z.number().int().min(0).default(32),
      regionPadding: z.number().int().min(0).default(24),
      detectShift: z.boolean().default(true),
    })
    .prefault({}),

  ai: z
    .object({
      provider: z.enum(["gemini", "ollama", "none"]).default("none"),
      /** Model id; defaults per provider. */
      model: z.string().min(1).optional(),
      /** Upper bound on AI calls per run; remaining jobs fall back to heuristics. */
      maxCallsPerRun: z.number().int().min(0).default(30),
      concurrency: z.number().int().min(1).max(8).default(2),
      /** "noise" results at or above this confidence become `pass`. */
      noiseConfidence: z.number().min(0).max(1).default(0.8),
      maxRegionsPerJob: z.number().int().min(1).max(10).default(3),
    })
    .prefault({}),

  report: z
    .object({
      /** Write a self-contained HTML report (index.html) into every run directory. */
      html: z.boolean().default(true),
      /** Where the report is published, for links in PR comments. */
      publicURL: urlSchema.optional(),
      /** Write a JUnit XML file here (relative to the project), for CI test dashboards. */
      junit: z.string().optional(),
      /** Append a Markdown summary to $GITHUB_STEP_SUMMARY when it is set. */
      githubSummary: z.boolean().default(true),
      /** POST a JSON summary here after each run (n8n, Slack workflows, Zapier…). */
      webhook: urlSchema.optional(),
    })
    .prefault({}),

  output: z
    .object({
      dir: z.string().default(".visualguard"),
      keepRuns: z.number().int().positive().default(10),
      /** Changes accepted as intentional; commit this file. */
      acceptedFile: z.string().default("visualguard.accepted.json"),
    })
    .prefault({}),

  fix: z
    .object({
      /** `visualguard fix` refuses to run unless this is true. */
      enabled: z.boolean().default(false),
      requireConfirmation: z.boolean().default(true),
      /** Only files matching these globs (relative to the project) are read or edited. */
      include: z
        .array(z.string())
        .default(["src/**", "app/**", "pages/**", "components/**", "styles/**", "lib/**"]),
      /** Files changed since this git ref rank first as likely causes, e.g. "origin/main". */
      compareRef: z.string().optional(),
      verify: z
        .object({
          /** Dev server for visual verification. Without it, fixes are applied but unverified. */
          server: z
            .object({
              /** Started by VisualGuard; omit to use a server that's already running. */
              command: z.string().optional(),
              url: urlSchema,
              readyTimeoutMs: z.number().int().positive().default(60_000),
            })
            .optional(),
          /** Run after each edit, e.g. "pnpm tsc --noEmit"; any failure reverts the edit. */
          commands: z.array(z.string()).default([]),
          commandTimeoutMs: z.number().int().positive().default(300_000),
        })
        .prefault({}),
      maxAttempts: z.number().int().min(1).max(5).default(2),
      /** Consent to send source excerpts to the AI provider without asking (needed for --auto). */
      allowSourceUpload: z.boolean().default(false),
    })
    .prefault({}),

  concurrency: z.number().int().min(1).max(32).optional(),

  hooks: z
    .object({
      beforeNavigate: hookSchema.optional(),
      beforeCapture: hookSchema.optional(),
    })
    .prefault({}),
});

/** What users write in `visualguard.config.ts`. */
export type VisualGuardConfig = z.input<typeof configSchema>;
/** The config after defaults are applied. */
export type ParsedConfig = z.output<typeof configSchema>;
export type RouteInput = z.output<typeof routeInputSchema>;
export type RouteObject = z.output<typeof routeObjectSchema>;
export type RouteDiscovery = z.output<typeof routeDiscoverySchema>;
export type DiscoverySource = z.output<typeof discoverySourceSchema>;
export type ViewportConfig = z.output<typeof viewportSchema>;
