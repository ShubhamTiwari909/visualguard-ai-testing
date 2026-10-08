import type { ParsedConfig } from "../config/schema.js";
import type { AIProvider } from "./provider.js";
import { GeminiProvider } from "./providers/gemini.js";
import { DEFAULT_OLLAMA_HOST, OllamaProvider } from "./providers/ollama.js";

export type ProviderName = ParsedConfig["ai"]["provider"];

export interface ProviderResult {
  provider: AIProvider | undefined;
  /** Why there is no provider, when AI was requested but can't run. */
  reason?: string;
}

/**
 * Creates the configured provider. A missing key is not an error: VisualGuard falls back to its
 * heuristics and says why (PLAN.md §2, principle 2).
 */
export function createProvider(
  ai: Pick<ParsedConfig["ai"], "provider" | "model">,
  env: NodeJS.ProcessEnv = process.env,
): ProviderResult {
  switch (ai.provider) {
    case "none":
      return { provider: undefined };
    case "gemini": {
      const apiKey = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
      if (!apiKey) {
        return { provider: undefined, reason: "GEMINI_API_KEY is not set; using heuristics only" };
      }
      return {
        provider: new GeminiProvider({
          apiKey,
          model: ai.model,
          baseUrl: env.VISUALGUARD_GEMINI_BASE_URL,
        }),
      };
    }
    case "ollama":
      return {
        provider: new OllamaProvider({
          host: env.OLLAMA_HOST ?? DEFAULT_OLLAMA_HOST,
          model: ai.model,
        }),
      };
  }
}
