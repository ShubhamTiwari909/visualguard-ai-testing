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
}

export interface CaptureResult {
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
  /** Plain-language findings from heuristics (no AI). */
  findings?: string[];
  analysis?: Analysis;
  acceptedBy?: { hash: string; at: string; note?: string };
  error?: { stage: "capture" | "diff" | "mapping" | "ai"; message: string };
  durationMs: number;
}

export interface RunManifest {
  schemaVersion: 1;
  id: string;
  number: number;
  startedAt: string;
  durationMs: number;
  mode: "compare" | "baseline" | "scan";
  tool: { version: string; playwright?: string; node: string; browser?: string };
  config: {
    baseURL: Partial<Record<Env, string>>;
    viewports: Record<string, Size>;
    ai: { provider: string; model?: string };
    failOn: FailOn;
  };
  summary: Record<Status, number>;
  usage?: { aiCalls: number; inputTokens: number; outputTokens: number };
  jobs: JobResult[];
}
