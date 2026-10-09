/**
 * @file Mock structured AI provider, canned analysis responses and usage for deterministic
 * tests.
 *
 * Tests are executable examples: describe groups a scenario, it/test names one expectation, and
 * expect checks the result. Helpers below create controlled data or temporary resources so
 * assertions do not depend on a developer's environment.
 *
 * Beginner reference: docs/READING-THE-CODE.md in the repository root.
 */

import { BaseProvider, type Completion, type CompletionRequest } from "../../src/ai/provider.js";

export type Responder = (request: CompletionRequest, call: number) => unknown;

/**
 * A scripted provider: `respond` returns an object (sent as JSON) or a raw string.
 */
export class MockProvider extends BaseProvider {
  readonly name = "mock";
  readonly model = "mock-1";
  readonly capabilities: { vision: boolean; structuredOutput: boolean; maxImages: number };
  readonly requests: CompletionRequest[] = [];

  /**
   * Store a configurable response callback and advertised image limit. The mock uses the real
   * structured-provider base class, so parsing/repair behavior is still exercised.
   */
  constructor(
    private readonly respond: Responder,
    maxImages = 16,
  ) {
    super();
    this.capabilities = { vision: true, structuredOutput: true, maxImages };
  }

  /**
   * Record each raw request and ask the fixture callback for an answer or error. Normalize
   * object answers to JSON and return fixed token usage without any network call.
   */
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

/**
 * Build a schema-shaped visual analysis with a chosen classification and optional overrides.
 * Fixed default evidence/confidence keeps test setup concise and repeatable.
 */
export const analysis = (classification: string, extra: Record<string, unknown> = {}) => ({
  classification,
  confidence: 0.9,
  title: `Looks like ${classification}`,
  summary: "Something changed.",
  evidence: ["the button moved"],
  affected: [],
  ...extra,
});
