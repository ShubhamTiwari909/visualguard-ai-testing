/**
 * @file Gemini SDK transport: image/schema requests, thinking/detail settings, retry/quota
 * handling and returned model/token metadata.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import {
  ApiError,
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type Part as GeminiPart,
  type ThinkingConfig,
} from "@google/genai";
import {
  AIError,
  BaseProvider,
  repairInstruction,
  type Completion,
  type CompletionRequest,
} from "../provider.js";

/**
 * A moving alias, so the default follows Google's current Flash model. Override with ai.model.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /**
   * For tests and proxies.
   */
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Attempts per request, including the first (SDK retries 408/429/5xx).
   */
  retryAttempts?: number;
  /**
   * How much the model reasons before answering. Thinking is billed as output and is most of a
   * Flash call's latency; classifying a visual diff needs little of it. Default "low".
   */
  thinking?: GeminiThinking;
  /**
   * Tokens spent per image. "medium" is plenty for region crops. Default "medium".
   */
  imageDetail?: ImageDetail;
}

export type GeminiThinking = "off" | "low" | "default";
export type ImageDetail = "low" | "medium" | "high";

const MEDIA_RESOLUTION: Record<ImageDetail, MediaResolution> = {
  low: MediaResolution.MEDIA_RESOLUTION_LOW,
  medium: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  high: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

/**
 * Gemini 3 models take a thinking level, Gemini 2.5 models a token budget, and some models take
 * neither. We try them in that order and remember what the model accepted.
 */
type ThinkingStyle = "level" | "budget" | "none";
const THINKING_STYLES: readonly ThinkingStyle[] = ["level", "budget", "none"];

/**
 * Map VisualGuard's thinking preference to the setting supported by this Gemini model. Return
 * undefined when defaults should be used or the model does not support a thinking option.
 */
function thinkingConfig(
  thinking: GeminiThinking,
  style: ThinkingStyle,
): ThinkingConfig | undefined {
  if (thinking === "default" || style === "none") return undefined;
  if (style === "level") {
    return { thinkingLevel: thinking === "off" ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW };
  }
  return { thinkingBudget: thinking === "off" ? 0 : 1024 };
}

/**
 * Waits longer than this are not worth it: the quota is per day, or the run would stall.
 */
const MAX_RETRY_WAIT_MS = 60_000;

/**
 * The server's suggested wait from a 429 ("retryDelay":"17s" or "Please retry in 1h2m3s").
 *
 * Read a provider-suggested retry delay and convert hours, minutes or seconds into
 * milliseconds. Return undefined when the message contains no recognizable wait instruction.
 */
export function retryDelayMs(message: string): number | undefined {
  const field = message.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (field) return Number(field[1]) * 1000;
  const prose = message.match(/retry in ((?:\d+(?:\.\d+)?[hms])+)/i);
  if (!prose) return undefined;
  let ms = 0;
  for (const [, value, unit] of prose[1]!.matchAll(/(\d+(?:\.\d+)?)([hms])/g)) {
    ms += Number(value) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);
  }
  return ms;
}

/**
 * Gemini through the official `@google/genai` SDK, with structured output (a JSON schema).
 * Retries 408/429/5xx itself, so a daily quota error fails at once instead of retrying. Images
 * are sent inline.
 */
export class GeminiProvider extends BaseProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly capabilities = { vision: true, structuredOutput: true, maxImages: 16 };
  private readonly client: GoogleGenAI;
  private readonly thinking: GeminiThinking;
  private readonly imageDetail: ImageDetail;
  private thinkingStyle: ThinkingStyle = "level";
  private mediaResolutionSupported = true;
  private readonly retryAttempts: number;

  /**
   * Create the Gemini SDK client and store model/image/retry preferences. SDK retries are
   * disabled here so this provider can explicitly account for each network attempt.
   */
  constructor(options: GeminiOptions) {
    super();
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.thinking = options.thinking ?? "low";
    this.imageDetail = options.imageDetail ?? "medium";
    this.retryAttempts = options.retryAttempts ?? 4;
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        baseUrl: options.baseUrl,
        timeout: options.timeoutMs ?? 120_000,
        retryOptions: { attempts: 1 },
      },
    });
  }

  /**
   * Encode text and PNG bytes for Gemini, issue a budgeted request and return the answer with
   * token usage. Retry eligible transport failures with bounded waits, and step down
   * unsupported model options when possible.
   */
  protected async complete(request: CompletionRequest): Promise<Completion> {
    const parts: GeminiPart[] = request.parts.map((part) =>
      part.type === "text"
        ? { text: part.text }
        : { inlineData: { mimeType: part.mimeType, data: part.data.toString("base64") } },
    );
    if (request.repair) parts.push({ text: repairInstruction(request.repair) });

    for (let attempt = 1; ; attempt++) {
      request.budget?.network();
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: request.system,
            responseMimeType: "application/json",
            responseJsonSchema: request.jsonSchema,
            temperature: 0.1,
            thinkingConfig: thinkingConfig(this.thinking, this.thinkingStyle),
            mediaResolution: this.mediaResolutionSupported
              ? MEDIA_RESOLUTION[this.imageDetail]
              : undefined,
            abortSignal: request.signal,
          },
        });
        const usage = response.usageMetadata;
        const thinkingTokens = usage?.thoughtsTokenCount ?? 0;
        return {
          modelVersion: response.modelVersion,
          text: response.text ?? "",
          usage: {
            inputTokens: usage?.promptTokenCount ?? 0,
            // Thinking tokens are billed as output.
            outputTokens: (usage?.candidatesTokenCount ?? 0) + thinkingTokens,
            thinkingTokens,
          },
        };
      } catch (error) {
        if (this.dropUnsupportedOption(error)) continue;
        const failure = toAIError(error, this.model);
        if (!failure.retryable || failure.stopsRun || attempt >= this.retryAttempts) throw failure;
        const message = error instanceof Error ? error.message : "";
        const wait = retryDelayMs(message) ?? Math.min(30_000, 2000 * 2 ** (attempt - 1));
        await sleep(Math.min(wait, MAX_RETRY_WAIT_MS), request.signal);
      }
    }
  }

  /**
   * Steps down to settings the model accepts after a 400 about them. Returns true to retry.
   *
   * Handle a 400 response that identifies an unsupported thinking or media-resolution setting.
   * Update this provider instance and return true only when another request can use a different
   * option.
   */
  private dropUnsupportedOption(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 400) return false;
    if (/thinking/i.test(error.message) && this.thinking !== "default") {
      const next = THINKING_STYLES[THINKING_STYLES.indexOf(this.thinkingStyle) + 1];
      if (!next) return false;
      this.thinkingStyle = next;
      return true;
    }
    if (/media.?resolution/i.test(error.message) && this.mediaResolutionSupported) {
      this.mediaResolutionSupported = false;
      return true;
    }
    return false;
  }

  /**
   * Model ids available to this key (for `doctor` and `init`).
   *
   * Ask Gemini for models available to these credentials, reading a bounded number from its
   * async pager. Async iteration waits for additional API pages as they are needed.
   */
  async listModels(): Promise<string[]> {
    try {
      const pager = await this.client.models.list();
      const names: string[] = [];
      for await (const model of pager) {
        if (model.name) names.push(model.name.replace(/^models\//, ""));
        if (names.length >= 200) break;
      }
      return names;
    } catch (error) {
      throw toAIError(error, this.model);
    }
  }
}

/**
 * Translate SDK or network errors into the shared AIError shape. HTTP status and model
 * information determine whether retrying is reasonable and what guidance the CLI can show.
 */
function toAIError(error: unknown, model: string): AIError {
  if (error instanceof AIError) return error;
  const status = error instanceof ApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) {
    const wait = retryDelayMs(message);
    if (/PerDay/i.test(message) || (wait !== undefined && wait > MAX_RETRY_WAIT_MS)) {
      const model = message.match(/model:\s*([\w-]+(?:\.[\w-]+)*)/)?.[1];
      return new AIError(
        `Gemini quota used up${model ? ` for ${model}` : ""}${wait ? `; it resets in ${formatWait(wait)}` : ""}`,
        { status, stopsRun: true, cause: error },
      );
    }
    return new AIError("Gemini rate limit reached", { retryable: true, status, cause: error });
  }
  if (status === 401 || status === 403) {
    return new AIError("Gemini rejected the API key (check GEMINI_API_KEY)", {
      status,
      stopsRun: true,
      cause: error,
    });
  }
  if (status === 404 || (status === 400 && /model/i.test(message))) {
    return new AIError(
      `Gemini model "${model}" is not available; set ai.model to a current model id`,
      {
        status,
        stopsRun: true,
        cause: error,
      },
    );
  }
  return new AIError(`Gemini request failed: ${message}`, {
    retryable: status === undefined || status === 408 || status >= 500,
    status,
    cause: error,
  });
}

/**
 * Format a long retry delay as minutes or hours for the error message. The input is
 * milliseconds, so divide by 60,000 before rounding.
 */
function formatWait(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Wait asynchronously for a retry delay, but reject promptly when cancellation arrives. A
 * Promise allows other work to run while the timer is pending.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason as Error);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}
