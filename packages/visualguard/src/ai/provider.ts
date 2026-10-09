/**
 * @file Provider contract and structured-output base implementation; extracts/validates JSON,
 * repairs invalid answers and records usage.
 *
 * This module runs on Node.js unless a function explicitly enters the browser with
 * page.evaluate/addInitScript. async functions return Promises; await waits for a result
 * without blocking the event loop. Relative .js imports refer to the JavaScript files produced
 * from these TypeScript sources.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { z } from "zod";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; data: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" };

export interface GenerateRequest<T> {
  budget?: import("./budget.js").AIBudget;
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  /**
   * Includes thinking tokens, which are billed as output.
   */
  outputTokens: number;
  /**
   * Tokens the model spent reasoning (part of outputTokens).
   */
  thinkingTokens?: number;
}

/**
 * Accumulate one response's token counts into an existing total object. Optional thinking
 * tokens are added only when the provider reports them.
 */
export function addUsage(total: Usage, more: Usage): void {
  total.inputTokens += more.inputTokens;
  total.outputTokens += more.outputTokens;
  if (more.thinkingTokens) total.thinkingTokens = (total.thinkingTokens ?? 0) + more.thinkingTokens;
}

export interface GenerateResult<T> {
  modelVersion?: string;
  data: T;
  usage: Usage;
}

/**
 * What each AI provider implements (PLAN.md §10.1): one structured-output primitive. Prompts,
 * schemas and validation live in the tasks, so they are shared by every provider.
 */
export interface AIProvider {
  readonly supportsBudget?: boolean;
  readonly name: string;
  readonly model: string;
  readonly capabilities: { vision: boolean; structuredOutput: boolean; maxImages: number };
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export class AIError extends Error {
  readonly retryable: boolean;
  readonly status: number | undefined;
  /**
   * The provider won't answer any request in this run (bad key, unknown model, daily quota used
   * up), so the remaining jobs shouldn't try.
   */
  readonly stopsRun: boolean;

  /**
   * Create an AI-specific error with retry, HTTP status and stop-run metadata. The original
   * cause is preserved so callers can show a readable message without losing diagnostic
   * information.
   */
  constructor(
    message: string,
    options: { retryable?: boolean; status?: number; stopsRun?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AIError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.stopsRun = options.stopsRun ?? false;
  }
}

/**
 * A raw model call: returns the response text, expected to be JSON.
 */
export interface CompletionRequest {
  budget?: import("./budget.js").AIBudget;
  system: string;
  parts: Part[];
  jsonSchema: Record<string, unknown>;
  /**
   * Set on the repair attempt: what was wrong with the previous answer.
   */
  repair?: string;
  signal?: AbortSignal;
}

export interface Completion {
  modelVersion?: string;
  text: string;
  usage: Usage;
}

/**
 * Converts a zod schema to the JSON schema sent to providers for structured output.
 *
 * Convert the validation schema into the JSON Schema sent to a model. Remove the schema-version
 * field because provider APIs do not all accept that field.
 */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/**
 * Pulls a JSON object out of a model answer, tolerating code fences and surrounding prose.
 *
 * Parse a model answer that may wrap JSON in Markdown fences or explanatory prose. Invalid JSON
 * still throws; callers decide whether another generation should repair the answer.
 */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("The response is not JSON");
  }
}

/**
 * Base class: providers implement `complete`; `generate` adds JSON parsing, schema validation
 * and one repair attempt when the answer doesn't match the schema (PLAN.md §10.6).
 */
export abstract class BaseProvider implements AIProvider {
  readonly supportsBudget = true;
  abstract readonly name: string;
  abstract readonly model: string;
  abstract readonly capabilities: AIProvider["capabilities"];

  /**
   * Provider subclasses implement this transport boundary: send the request and return raw text
   * plus usage. Keeping parsing in generate gives every provider the same validation rules.
   */
  protected abstract complete(request: CompletionRequest): Promise<Completion>;

  /**
   * Request an answer, parse its JSON and validate it against the requested schema. Allow one
   * schema-repair generation, account for usage, and throw an AIError if both answers fail
   * validation.
   */
  async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = jsonSchemaFor(request.schema);
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let problem: string | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      request.budget?.generation();
      const completion = await this.complete({
        budget: request.budget,
        system: request.system,
        parts: request.parts,
        jsonSchema,
        repair: problem,
        signal: request.signal,
      });
      addUsage(usage, completion.usage);
      request.budget?.record(completion.usage);
      try {
        const parsed = request.schema.safeParse(extractJSON(completion.text));
        if (parsed.success)
          return { data: parsed.data, usage, modelVersion: completion.modelVersion };
        problem = parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
    }
    throw new AIError(`${this.name} returned an invalid answer twice: ${problem}`);
  }
}

/**
 * Turn the previous validation problem into a short follow-up instruction. The model is asked
 * to return schema-compatible JSON instead of more explanatory prose.
 */
export const repairInstruction = (problem: string) =>
  `Your previous answer did not match the required JSON schema (${problem}). Answer again with only valid JSON that matches the schema.`;
