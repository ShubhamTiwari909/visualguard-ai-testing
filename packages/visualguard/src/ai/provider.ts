import { z } from "zod";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; data: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp" };

export interface GenerateRequest<T> {
  system: string;
  parts: Part[];
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateResult<T> {
  data: T;
  usage: Usage;
}

/**
 * What each AI provider implements (PLAN.md §10.1): one structured-output primitive. Prompts,
 * schemas and validation live in the tasks, so they are shared by every provider.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: { vision: boolean; structuredOutput: boolean; maxImages: number };
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

export class AIError extends Error {
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AIError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

/** A raw model call: returns the response text, expected to be JSON. */
export interface CompletionRequest {
  system: string;
  parts: Part[];
  jsonSchema: Record<string, unknown>;
  /** Set on the repair attempt: what was wrong with the previous answer. */
  repair?: string;
  signal?: AbortSignal;
}

export interface Completion {
  text: string;
  usage: Usage;
}

/** Converts a zod schema to the JSON schema sent to providers for structured output. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Pulls a JSON object out of a model answer, tolerating code fences and surrounding prose. */
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
  abstract readonly name: string;
  abstract readonly model: string;
  abstract readonly capabilities: AIProvider["capabilities"];

  protected abstract complete(request: CompletionRequest): Promise<Completion>;

  async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = jsonSchemaFor(request.schema);
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let problem: string | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await this.complete({
        system: request.system,
        parts: request.parts,
        jsonSchema,
        repair: problem,
        signal: request.signal,
      });
      usage.inputTokens += completion.usage.inputTokens;
      usage.outputTokens += completion.usage.outputTokens;
      try {
        const parsed = request.schema.safeParse(extractJSON(completion.text));
        if (parsed.success) return { data: parsed.data, usage };
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

export const repairInstruction = (problem: string) =>
  `Your previous answer did not match the required JSON schema (${problem}). Answer again with only valid JSON that matches the schema.`;
