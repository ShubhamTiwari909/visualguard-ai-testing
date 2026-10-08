import { BaseProvider, type Completion, type CompletionRequest } from "../../src/ai/provider.js";

export type Responder = (request: CompletionRequest, call: number) => unknown;

/** A scripted provider: `respond` returns an object (sent as JSON) or a raw string. */
export class MockProvider extends BaseProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  readonly capabilities: { vision: boolean; structuredOutput: boolean; maxImages: number };
  readonly requests: CompletionRequest[] = [];

  constructor(
    private readonly respond: Responder,
    maxImages = 16,
  ) {
    super();
    this.capabilities = { vision: true, structuredOutput: true, maxImages };
  }

  protected async complete(request: CompletionRequest): Promise<Completion> {
    this.requests.push(request);
    const answer = this.respond(request, this.requests.length);
    if (answer instanceof Error) throw answer;
    return {
      text: typeof answer === "string" ? answer : JSON.stringify(answer),
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  }
}

export const analysis = (classification: string, extra: Record<string, unknown> = {}) => ({
  classification,
  confidence: 0.9,
  title: `Looks like ${classification}`,
  summary: "Something changed.",
  evidence: ["the button moved"],
  affected: [],
  ...extra,
});
