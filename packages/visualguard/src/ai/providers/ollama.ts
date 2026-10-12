/**
 * @file Ollama HTTP transport for multimodal structured generation, local model settings,
 * timeouts and cancellation.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import {
  AIError,
  BaseProvider,
  repairInstruction,
  type Completion,
  type CompletionRequest,
} from "../provider.js";

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
/**
 * A vision-capable model that reads UI screenshots well. Override with ai.model.
 */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5vl";

export interface OllamaOptions {
  host?: string;
  model?: string;
  timeoutMs?: number;
}

interface ChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Local models through Ollama's REST API (PLAN.md §10.3): `format` carries the JSON schema.
 * Small local models do better with one composite image, so `maxImages` is 1 and the task
 * combines production, staging and diff side by side.
 */
export class OllamaProvider extends BaseProvider {
  readonly name = "ollama";
  readonly model: string;
  readonly host: string;
  readonly capabilities = { vision: true, structuredOutput: true, maxImages: 1 };
  private readonly timeoutMs: number;

  /**
   * Store the Ollama host, vision model and timeout, filling in defaults for omitted options.
   * No request is made until complete or listModels is called.
   */
  constructor(options: OllamaOptions = {}) {
    super();
    this.host = options.host ?? DEFAULT_OLLAMA_HOST;
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL;
    this.timeoutMs = options.timeoutMs ?? 300_000;
  }

  /**
   * Send text, base64 images and a JSON schema to Ollama's chat endpoint. Combine timeout and
   * caller cancellation, reject HTTP failures and normalize its token counters to the shared
   * provider result.
   */
  protected async complete(request: CompletionRequest): Promise<Completion> {
    const text = request.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");
    const images = request.parts
      .filter((part) => part.type === "image")
      .map((part) => part.data.toString("base64"));

    let response: Response;
    request.budget?.network();
    try {
      response = await fetch(new URL("/api/chat", this.host), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: request.jsonSchema,
          options: { temperature: 0.1 },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: text, images },
            ...(request.repair
              ? [{ role: "user", content: repairInstruction(request.repair) }]
              : []),
          ],
        }),
        signal: request.signal
          ? AbortSignal.any([request.signal, AbortSignal.timeout(this.timeoutMs)])
          : AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AIError(`Ollama is not reachable at ${this.host}`, {
        retryable: true,
        cause: error,
      });
    }

    const body = (await response.json().catch(() => ({}))) as ChatResponse;
    if (!response.ok) {
      const detail = body.error ?? `HTTP ${response.status}`;
      if (response.status === 404 || /not found/i.test(detail)) {
        throw new AIError(
          `Ollama model "${this.model}" is not installed. Run: ollama pull ${this.model}`,
          {
            status: response.status,
          },
        );
      }
      throw new AIError(`Ollama request failed: ${detail}`, {
        retryable: response.status >= 500,
        status: response.status,
      });
    }
    return {
      text: body.message?.content ?? "",
      usage: { inputTokens: body.prompt_eval_count ?? 0, outputTokens: body.eval_count ?? 0 },
    };
  }

  /**
   * Installed models, and whether each reports the "vision" capability (newer Ollama versions).
   *
   * List locally installed Ollama models and ask for each model's capabilities. Missing
   * capability metadata stays unknown rather than incorrectly declaring that vision is
   * unsupported.
   */
  async listModels(): Promise<Array<{ name: string; vision?: boolean }>> {
    const tags = await fetch(new URL("/api/tags", this.host), {
      signal: AbortSignal.timeout(5_000),
    });
    const { models = [] } = (await tags.json()) as { models?: Array<{ name: string }> };
    return Promise.all(
      models.map(async ({ name }) => {
        try {
          const show = await fetch(new URL("/api/show", this.host), {
            method: "POST",
            body: JSON.stringify({ model: name }),
            signal: AbortSignal.timeout(5_000),
          });
          const info = (await show.json()) as { capabilities?: string[] };
          return {
            name,
            vision: info.capabilities ? info.capabilities.includes("vision") : undefined,
          };
        } catch {
          return { name };
        }
      }),
    );
  }
}
