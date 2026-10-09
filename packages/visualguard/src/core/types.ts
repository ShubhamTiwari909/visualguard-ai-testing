/**
 * @file Shared data contracts for jobs, captures, health, pixel regions, DOM deltas, AI
 * analysis and manifests; type-only.
 *
 * TypeScript declarations describe data and compile-time contracts. They help editors and the
 * compiler; type-only declarations are removed from the JavaScript build and do not validate
 * runtime JSON.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

/**
 * The two comparison sides used throughout the data model. Baseline/current captures reuse
 * these keys so the same diff and report code can process them.
 */
export type Env = "production" | "staging";
export const ENVS: readonly Env[] = ["production", "staging"];

/**
 * The final job verdict. pass/accepted are successful results, review needs a decision,
 * regression is a detected problem, and error means the comparison could not complete.
 */
export type Status = "pass" | "accepted" | "review" | "regression" | "error";
export const STATUSES: readonly Status[] = ["pass", "accepted", "review", "regression", "error"];

/**
 * The policy used to translate job verdicts into a process failure. It changes the CI exit
 * decision rather than the underlying recorded status.
 */
export type FailOn = "regression" | "review" | "any";

/**
 * Image or viewport dimensions in pixels. A TypeScript interface specifies this object shape
 * without creating a runtime object.
 */
export interface Size {
  width: number;
  height: number;
}

/**
 * A rectangle in page/image pixels, with x/y at its top-left corner. Width and height describe
 * its extent along each axis.
 */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One route × viewport comparison.
 */
/**
 * The planned input for one route and viewport, before any capture has happened. It carries
 * both environment URLs and per-route stabilization overrides.
 */
export interface JobSpec {
  /**
   * e.g. "checkout__desktop"
   */
  id: string;
  /**
   * Route as configured, after params are applied, e.g. "/blog/hello-world".
   */
  route: string;
  name: string;
  viewport: string;
  urls: Record<Env, string>;
  waitFor?: string;
  mask: string[];
  hide: string[];
}

/**
 * Evidence observed while loading a page: HTTP, console, network, image and optional
 * independent checks. An absent optional metric means it was not available, not that it
 * measured zero.
 */
export interface HealthSignals {
  status?: number;
  finalURL?: string;
  consoleErrors: string[];
  failedRequests: string[];
  brokenImages: string[];
  /**
   * Document is wider than the viewport.
   */
  horizontalOverflow?: { documentWidth: number; viewportWidth: number };
  /**
   * axe-core violations (`checks.accessibility`).
   */
  accessibility?: A11yViolation[];
  /**
   * Load metrics (`checks.performance`).
   */
  performance?: PerfMetrics;
  /**
   * Checks that couldn't run, e.g. "accessibility: axe-core did not finish in time".
   */
  checkErrors?: string[];
}

/**
 * The severity labels supplied by axe-core. These describe accessibility rules and are separate
 * from VisualGuard job statuses.
 */
export type A11yImpact = "minor" | "moderate" | "serious" | "critical";

/**
 * A compact accessibility rule failure with its count and a few affected selectors. Keeping a
 * summary avoids embedding axe's entire browser result.
 */
export interface A11yViolation {
  /**
   * axe rule id, e.g. "color-contrast".
   */
  id: string;
  impact: A11yImpact;
  help: string;
  helpUrl: string;
  /**
   * Elements that fail the rule.
   */
  count: number;
  /**
   * Selectors of the first few.
   */
  targets: string[];
}

/**
 * Observable page-load metrics. Timing suffix Ms means milliseconds, payload suffix KB means
 * kilobytes, and CLS is a unitless layout-shift score.
 */
export interface PerfMetrics {
  ttfbMs?: number;
  fcpMs?: number;
  lcpMs?: number;
  /**
   * Cumulative layout shift during load.
   */
  cls: number;
  loadMs?: number;
  requests: number;
  /**
   * Bytes transferred, in KB (responses the page may measure).
   */
  transferKB: number;
  jsKB: number;
  domNodes: number;
}

/**
 * The saved result of one live or baseline capture. Image/DOM paths are relative to the run
 * directory so copied artifacts remain portable.
 */
export interface CaptureResult {
  /**
   * "baseline" when the image came from a stored snapshot instead of a live capture.
   */
  source?: "live" | "baseline";
  /**
   * Path relative to the run directory.
   */
  image: string;
  /**
   * DOM snapshot path relative to the run directory, when captured.
   */
  dom?: string;
  size: Size;
  /**
   * The page was cut at `screenshot.maxHeight`.
   */
  truncated?: boolean;
  /**
   * Two consecutive screenshots never matched within `stabilityAttempts`.
   */
  unstable?: boolean;
  durationMs: number;
  attempts: number;
  health: HealthSignals;
}

/**
 * Measurements and optional artifacts from comparing the image pair. diffRatio is a fraction
 * (0.01 means 1%), while diffPixels is an absolute count.
 */
export interface DiffResult {
  width: number;
  height: number;
  sizeMismatch?: Record<Env, Size>;
  diffPixels: number;
  diffRatio: number;
  /**
   * Path relative to the run directory.
   */
  image?: string;
  /**
   * Layout shift detected: content below `fromY` moved by `deltaY` pixels.
   */
  shift?: { fromY: number; deltaY: number };
  /**
   * Areas that differed between two loads of the same page and were left out of the diff
   * (`diff.noiseMap`). `skipped` says why they weren't, when they weren't.
   */
  noise?: { env: Env; boxes: Box[]; ignoredPixels: number; skipped?: string };
}

/**
 * An element chosen to explain a changed region. counterpart identifies the matched element on
 * the other comparison side when one exists.
 */
export interface ElementMatch {
  selector: string;
  tag: string;
  text?: string;
  component?: string;
  /**
   * Present on the other side under this selector, if matched.
   */
  counterpart?: string;
  box?: Box;
}

/**
 * A changed computed CSS property for one selector. Production is the reference value and
 * staging is the observed current value.
 */
export interface StyleDelta {
  kind: "style";
  selector: string;
  property: string;
  production: string;
  staging: string;
}

/**
 * A changed visible text value for a matched element. The kind literal lets a caller
 * distinguish this from other delta shapes.
 */
export interface TextDelta {
  kind: "text";
  selector: string;
  production: string;
  staging: string;
}

/**
 * A geometry difference with old/new rectangles. This records position or size rather than a
 * guessed CSS cause.
 */
export interface BoxDelta {
  kind: "box";
  selector: string;
  production: Box;
  staging: Box;
}

/**
 * An added or removed element. presentIn says which capture contains it; the other side is
 * missing it.
 */
export interface PresenceDelta {
  kind: "presence";
  selector: string;
  /**
   * Which side has the element.
   */
  presentIn: Env;
}

/**
 * A discriminated union of DOM change shapes. Checking delta.kind narrows the object to the
 * fields supported by that specific change.
 */
export type Delta = StyleDelta | TextDelta | BoxDelta | PresenceDelta;

/**
 * A grouped changed area with its geometry, pixel count, optional crops and DOM explanation. It
 * connects screenshot evidence to report/AI descriptions.
 */
export interface RegionResult {
  id: number;
  /**
   * "shift" marks the inserted or removed band of a layout shift.
   */
  kind?: "pixels" | "shift";
  box: Box;
  diffPixels: number;
  /**
   * Crops relative to the run directory.
   */
  crops?: Record<Env | "diff", string>;
  elements: ElementMatch[];
  deltas: Delta[];
  heuristic?: string;
}

/**
 * The model's explanation category for a visual change. This is separate from Status because
 * deterministic evidence and AI policy decide the final verdict.
 */
export type Classification = "regression" | "intentional" | "content" | "noise";

/**
 * A cleaned AI answer plus provider/prompt/cache provenance. confidence is model-reported and
 * should not be treated as a measured probability of correctness.
 */
export interface Analysis {
  modelVersion?: string;
  intent?: { title: string; description?: string; changedFiles: string[] };
  classification: Classification;
  confidence: number;
  title: string;
  summary: string;
  likelyCause?: string;
  evidence: string[];
  affected: { selector: string; component?: string }[];
  suggestedFix?: { description: string; snippet?: string };
  provider: string;
  model: string;
  promptVersion: string;
  cached: boolean;
}

/**
 * Severity for one explanatory finding. info records context without worsening a job;
 * review/regression can raise its verdict.
 */
export type FindingSeverity = "regression" | "review" | "info";

/**
 * A deterministic explanatory message with severity and source. Several findings can support
 * one job result.
 */
export interface Finding {
  severity: FindingSeverity;
  message: string;
  source: "health" | "heuristic" | "baseline";
}

/**
 * The completed or attempted result for one planned job. Optional captures/diff/analysis
 * reflect which steps actually produced evidence.
 */
export interface JobResult {
  /**
   * Capture settings retained for faithful repair replay; credentials and hooks stay in config.
   */
  capturePolicy?: import("./provenance.js").CapturePolicy;
  id: string;
  route: string;
  name: string;
  viewport: string;
  status: Status;
  urls: Record<Env, string>;
  captures: Partial<Record<Env, CaptureResult>>;
  diff?: DiffResult;
  regions: RegionResult[];
  /**
   * Plain-language findings from health checks and heuristics (no AI).
   */
  findings?: Finding[];
  analysis?: Analysis;
  /**
   * Status from the pixel diff, heuristics and health checks, before AI analysis.
   */
  baseStatus?: Status;
  /**
   * `match` says whether the screenshots were identical or the same change was found again.
   */
  acceptedBy?: { hash: string; at: string; note?: string; match?: "exact" | "similar" };
  error?: { stage: "capture" | "diff" | "mapping" | "ai"; message: string };
  durationMs: number;
}

/**
 * The persisted record for a complete run or shard, including jobs, policy, provenance, summary
 * and AI usage. Later report, analyze, accept, merge and fix commands read this JSON-shaped
 * contract.
 */
export interface RunManifest {
  provenance?: {
    group: string;
    fingerprint: string;
    sourceRevision?: string;
    expectedJobs: string[];
  };
  incomplete?: boolean;
  schemaVersion: 1;
  id: string;
  number: number;
  startedAt: string;
  durationMs: number;
  mode: "compare" | "baseline" | "scan" | "monitor";
  /**
   * This run tested one shard of the jobs (`--shard`).
   */
  shard?: { index: number; total: number };
  /**
   * Runs combined by `visualguard merge`.
   */
  mergedFrom?: string[];
  tool: { version: string; playwright?: string; node: string; browser?: string };
  config: {
    baseURL: Partial<Record<Env, string>>;
    viewports: Record<string, Size>;
    ai: { provider: string; model?: string };
    failOn: FailOn;
  };
  summary: Record<Status, number>;
  usage?: {
    aiCalls: number;
    generationAttempts?: number;
    networkAttempts?: number;
    inputTokens: number;
    /**
     * Includes thinking tokens.
     */
    outputTokens: number;
    thinkingTokens?: number;
  };
  jobs: JobResult[];
}
