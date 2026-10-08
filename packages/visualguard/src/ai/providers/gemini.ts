import { ApiError, GoogleGenAI, type Part as GeminiPart } from "@google/genai";
import {
  AIError,
  BaseProvider,
  repairInstruction,
  type Completion,
  type CompletionRequest,
} from "../provider.js";

/** A moving alias, so the default follows Google's current Flash model. Override with ai.model. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export interface GeminiOptions {
  apiKey: string;
  model?: string;
  /** For tests and proxies. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Attempts per request, including the first (SDK retries 408/429/5xx). */
  retryAttempts?: number;
}

/**
 * Gemini through the official `@google/genai` SDK, with structured output (a JSON schema) and the
 * SDK's retries for 408/429/5xx. Images are sent inline.
 */
export class GeminiProvider extends BaseProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly capabilities = { vision: true, structuredOutput: true, maxImages: 16 };
  private readonly client: GoogleGenAI;

  constructor(options: GeminiOptions) {
    super();
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
      httpOptions: {
        baseUrl: options.baseUrl,
        timeout: options.timeoutMs ?? 120_000,
        retryOptions: { attempts: options.retryAttempts ?? 4, initialDelay: 2, maxDelay: 30 },
      },
    });
  }

  protected async complete(request: CompletionRequest): Promise<Completion> {
    const parts: GeminiPart[] = request.parts.map((part) =>
      part.type === "text"
        ? { text: part.text }
        : { inlineData: { mimeType: part.mimeType, data: part.data.toString("base64") } },
    );
    if (request.repair) parts.push({ text: repairInstruction(request.repair) });

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          responseJsonSchema: request.jsonSchema,
          temperature: 0.1,
          abortSignal: request.signal,
        },
      });
      return {
        text: response.text ?? "",
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (error) {
      throw toAIError(error, this.model);
    }
  }

  /** Model ids available to this key (for `doctor` and `init`). */
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

function toAIError(error: unknown, model: string): AIError {
  if (error instanceof AIError) return error;
  const status = error instanceof ApiError ? error.status : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429) {
    return new AIError("Gemini rate limit or quota reached", {
      retryable: true,
      status,
      cause: error,
    });
  }
  if (status === 401 || status === 403) {
    return new AIError("Gemini rejected the API key (check GEMINI_API_KEY)", {
      status,
      cause: error,
    });
  }
  if (status === 404 || (status === 400 && /model/i.test(message))) {
    return new AIError(
      `Gemini model "${model}" is not available; set ai.model to a current model id`,
      {
        status,
        cause: error,
      },
    );
  }
  return new AIError(`Gemini request failed: ${message}`, {
    retryable: status === undefined || status >= 500,
    status,
    cause: error,
  });
}
