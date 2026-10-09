export type Env = "production" | "staging";
export const ENVS: readonly Env[] = ["production", "staging"];

export type Status = "pass" | "accepted" | "review" | "regression" | "error";
export const STATUSES: readonly Status[] = ["pass", "accepted", "review", "regression", "error"];

export type FailOn = "regression" | "review" | "any";

export interface Size {
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One route × viewport comparison. */
export interface JobSpec {
  /** e.g. "checkout__desktop" */
  id: string;
  /** Route as configured, after params are applied, e.g. "/blog/hello-world". */
  route: string;
  name: string;
  viewport: string;
  urls: Record<Env, string>;
  waitFor?: string;
  mask: string[];
  hide: string[];
}

export interface HealthSignals {
  status?: number;
  finalURL?: string;
  consoleErrors: string[];
  failedRequests: string[];
  brokenImages: string[];
  /** Document is wider than the viewport. */
  horizontalOverflow?: { documentWidth: number; viewportWidth: number };
  /** axe-core violations (`checks.accessibility`). */
  accessibility?: A11yViolation[];
  /** Load metrics (`checks.performance`). */
  performance?: PerfMetrics;
  /** Checks that couldn't run, e.g. "accessibility: axe-core did not finish in time". */
  checkErrors?: string[];
}

export type A11yImpact = "minor" | "moderate" | "serious" | "critical";

export interface A11yViolation {
  /** axe rule id, e.g. "color-contrast". */
  id: string;
  impact: A11yImpact;
  help: string;
  helpUrl: string;
  /** Elements that fail the rule. */
  count: number;
  /** Selectors of the first few. */
  targets: string[];
}

export interface PerfMetrics {
  ttfbMs?: number;
  fcpMs?: number;
  lcpMs?: number;
  /** Cumulative layout shift during load. */
  cls: number;
  loadMs?: number;
  requests: number;
  /** Bytes transferred, in KB (responses the page may measure). */
  transferKB: number;
  jsKB: number;
  domNodes: number;
}

export interface CaptureResult {
  /** "baseline" when the image came from a stored snapshot instead of a live capture. */
  source?: "live" | "baseline";
  /** Path relative to the run directory. */
  image: string;
  /** DOM snapshot path relative to the run directory, when captured. */
  dom?: string;
  size: Size;
  /** The page was cut at `screenshot.maxHeight`. */
  truncated?: boolean;
  /** Two consecutive screenshots never matched within `stabilityAttempts`. */
  unstable?: boolean;
  durationMs: number;
  attempts: number;
  health: HealthSignals;
}

export interface DiffResult {
  width: number;
  height: number;
  sizeMismatch?: Record<Env, Size>;
  diffPixels: number;
  diffRatio: number;
  /** Path relative to the run directory. */
  image?: string;
  /** Layout shift detected: content below `fromY` moved by `deltaY` pixels. */
  shift?: { fromY: number; deltaY: number };
  /**
   * Areas that differed between two loads of the same page and were left out of the diff
   * (`diff.noiseMap`). `skipped` says why they weren't, when they weren't.
   */
  noise?: { env: Env; boxes: Box[]; ignoredPixels: number; skipped?: string };
}

export interface ElementMatch {
  selector: string;
  tag: string;
  text?: string;
  component?: string;
  /** Present on the other side under this selector, if matched. */
  counterpart?: string;
  box?: Box;
}

export interface StyleDelta {
  kind: "style";
  selector: string;
  property: string;
  production: string;
  staging: string;
}

export interface TextDelta {
  kind: "text";
  selector: string;
  production: string;
  staging: string;
}

export interface BoxDelta {
  kind: "box";
  selector: string;
  production: Box;
  staging: Box;
}

export interface PresenceDelta {
  kind: "presence";
  selector: string;
  /** Which side has the element. */
  presentIn: Env;
}

export type Delta = StyleDelta | TextDelta | BoxDelta | PresenceDelta;

export interface RegionResult {
  id: number;
  /** "shift" marks the inserted or removed band of a layout shift. */
  kind?: "pixels" | "shift";
  box: Box;
  diffPixels: number;
  /** Crops relative to the run directory. */
  crops?: Record<Env | "diff", string>;
  elements: ElementMatch[];
  deltas: Delta[];
  heuristic?: string;
}

export type Classification = "regression" | "intentional" | "content" | "noise";

export interface Analysis {
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

export type FindingSeverity = "regression" | "review" | "info";

export interface Finding {
  severity: FindingSeverity;
  message: string;
  source: "health" | "heuristic" | "baseline";
}

export interface JobResult {
  id: string;
  route: string;
  name: string;
  viewport: string;
  status: Status;
  urls: Record<Env, string>;
  captures: Partial<Record<Env, CaptureResult>>;
  diff?: DiffResult;
  regions: RegionResult[];
  /** Plain-language findings from health checks and heuristics (no AI). */
  findings?: Finding[];
  analysis?: Analysis;
  /** Status from the pixel diff, heuristics and health checks, before AI analysis. */
  baseStatus?: Status;
  /** `match` says whether the screenshots were identical or the same change was found again. */
  acceptedBy?: { hash: string; at: string; note?: string; match?: "exact" | "similar" };
  error?: { stage: "capture" | "diff" | "mapping" | "ai"; message: string };
  durationMs: number;
}

export interface RunManifest {
  schemaVersion: 1;
  id: string;
  number: number;
  startedAt: string;
  durationMs: number;
  mode: "compare" | "baseline" | "scan" | "monitor";
  /** This run tested one shard of the jobs (`--shard`). */
  shard?: { index: number; total: number };
  /** Runs combined by `visualguard merge`. */
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
    inputTokens: number;
    /** Includes thinking tokens. */
    outputTokens: number;
    thinkingTokens?: number;
  };
  jobs: JobResult[];
}
