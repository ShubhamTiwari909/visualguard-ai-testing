import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AIError } from "../src/ai/provider.js";
import { GeminiProvider, retryDelayMs } from "../src/ai/providers/gemini.js";
import { OllamaProvider } from "../src/ai/providers/ollama.js";

interface Received {
  method: string;
  url: string;
  body: Record<string, unknown>;
}

let server: Server | undefined;
afterEach(
  () => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())),
);

async function fake(
  handler: (request: Received) => { status?: number; body: unknown },
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  server = createServer((request: IncomingMessage, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const entry = {
        method: request.method ?? "",
        url: request.url ?? "",
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      };
      received.push(entry);
      const { status = 200, body } = handler(entry);
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, received };
}

const schema = z.object({
  classification: z.enum(["regression", "noise"]),
  confidence: z.number(),
});
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("GeminiProvider", () => {
  it("sends structured-output requests with inline images", async () => {
    const { url, received } = await fake(() => ({
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: '{"classification":"regression","confidence":0.8}' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 40 },
      },
    }));
    const provider = new GeminiProvider({
      apiKey: "test-key",
      model: "gemini-test",
      baseUrl: url,
      retryAttempts: 1,
    });
    const result = await provider.generate({
      system: "You review diffs.",
      parts: [
        { type: "text", text: "Route: /" },
        { type: "image", mimeType: "image/png", data: png },
      ],
      schema,
    });
    expect(result).toEqual({
      data: { classification: "regression", confidence: 0.8 },
      usage: { inputTokens: 1200, outputTokens: 40 },
    });

    const request = received[0]!;
    expect(request.url).toMatch(/models\/gemini-test:generateContent/);
    expect(JSON.stringify(request.body.systemInstruction)).toContain("You review diffs.");
    const config = request.body.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toMatchObject({ type: "object" });
    expect(JSON.stringify(request.body.contents)).toContain(png.toString("base64"));
    // Defaults: little thinking and medium image detail.
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });
    expect(config.mediaResolution).toBe("MEDIA_RESOLUTION_MEDIUM");
  });

  it("counts thinking tokens as output", async () => {
    const { url } = await fake(() => ({
      body: {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: '{"classification":"noise","confidence":1}' }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 50, thoughtsTokenCount: 700 },
      },
    }));
    const provider = new GeminiProvider({ apiKey: "k", baseUrl: url, retryAttempts: 1 });
    const result = await provider.generate({ system: "", parts: [], schema });
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 750, thinkingTokens: 700 });
  });

  it("falls back to a thinking budget, then to no thinking setting, when the model refuses", async () => {
    const { url, received } = await fake((request) => {
      const config = request.body.generationConfig as { thinkingConfig?: Record<string, unknown> };
      if (config.thinkingConfig)
        return {
          status: 400,
          body: {
            error: { code: 400, message: "Thinking is not supported", status: "INVALID_ARGUMENT" },
          },
        };
      return {
        body: {
          candidates: [
            {
              content: {
                role: "model",
                parts: [{ text: '{"classification":"noise","confidence":1}' }],
              },
            },
          ],
        },
      };
    });
    const provider = new GeminiProvider({
      apiKey: "k",
      baseUrl: url,
      thinking: "off",
      retryAttempts: 1,
    });
    await provider.generate({ system: "", parts: [], schema });
    const configs = received.map(
      (request) => (request.body.generationConfig as { thinkingConfig?: unknown }).thinkingConfig,
    );
    expect(configs).toEqual([{ thinkingLevel: "MINIMAL" }, { thinkingBudget: 0 }, undefined]);
    // The provider remembers what worked.
    await provider.generate({ system: "", parts: [], schema });
    expect(received).toHaveLength(4);
  });

  it("fails at once when the daily quota is used up", async () => {
    const message =
      "You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, model: gemini-3.8-flash. Please retry in 17h39m37.1s. GenerateRequestsPerDayPerProjectPerModel-FreeTier";
    const { url, received } = await fake(() => ({
      status: 429,
      body: { error: { code: 429, message, status: "RESOURCE_EXHAUSTED" } },
    }));
    const provider = new GeminiProvider({ apiKey: "k", baseUrl: url, retryAttempts: 4 });
    const error = (await provider
      .generate({ system: "", parts: [], schema })
      .catch((caught: unknown) => caught)) as AIError;
    expect(error.message).toBe("Gemini quota used up for gemini-3.8-flash; it resets in 17h 40m");
    expect(error.stopsRun).toBe(true);
    expect(received).toHaveLength(1);
  });

  it("retries short rate limits after the suggested delay", async () => {
    let calls = 0;
    const { url } = await fake(() =>
      ++calls === 1
        ? {
            status: 429,
            body: {
              error: {
                code: 429,
                message: 'Rate limited {"retryDelay":"0s"}',
                status: "RESOURCE_EXHAUSTED",
              },
            },
          }
        : {
            body: {
              candidates: [
                {
                  content: {
                    role: "model",
                    parts: [{ text: '{"classification":"noise","confidence":1}' }],
                  },
                },
              ],
            },
          },
    );
    const provider = new GeminiProvider({ apiKey: "k", baseUrl: url, retryAttempts: 3 });
    const result = await provider.generate({ system: "", parts: [], schema });
    expect(result.data.classification).toBe("noise");
    expect(calls).toBe(2);
  });

  it("reads retry delays from 429 messages", () => {
    expect(retryDelayMs('{"retryDelay":"63577s"}')).toBe(63_577_000);
    expect(retryDelayMs("Please retry in 1h2m3s.")).toBe(3_723_000);
    expect(retryDelayMs("Please retry in 17.5s")).toBe(17_500);
    expect(retryDelayMs("nothing here")).toBeUndefined();
  });

  it("explains rate limits and bad keys", async () => {
    const { url } = await fake(() => ({
      status: 429,
      body: { error: { code: 429, message: "Resource exhausted", status: "RESOURCE_EXHAUSTED" } },
    }));
    const provider = new GeminiProvider({ apiKey: "k", baseUrl: url, retryAttempts: 1 });
    const error = await provider
      .generate({ system: "", parts: [], schema })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).message).toMatch(/rate limit/);
    expect((error as AIError).retryable).toBe(true);
  });
});

describe("OllamaProvider", () => {
  it("sends the schema as `format` and images as base64", async () => {
    const { url, received } = await fake(() => ({
      body: {
        message: { role: "assistant", content: '{"classification":"noise","confidence":0.95}' },
        prompt_eval_count: 900,
        eval_count: 30,
      },
    }));
    const provider = new OllamaProvider({ host: url, model: "qwen2.5vl" });
    const result = await provider.generate({
      system: "System",
      parts: [
        { type: "text", text: "Region 1" },
        { type: "image", mimeType: "image/png", data: png },
      ],
      schema,
    });
    expect(result.data).toEqual({ classification: "noise", confidence: 0.95 });
    expect(result.usage).toEqual({ inputTokens: 900, outputTokens: 30 });
    const body = received[0]!.body;
    expect(received[0]!.url).toBe("/api/chat");
    expect(body).toMatchObject({ model: "qwen2.5vl", stream: false, format: { type: "object" } });
    expect(body.messages).toEqual([
      { role: "system", content: "System" },
      { role: "user", content: "Region 1", images: [png.toString("base64")] },
    ]);
  });

  it("tells you to pull a missing model", async () => {
    const { url } = await fake(() => ({
      status: 404,
      body: { error: "model 'qwen2.5vl' not found" },
    }));
    const provider = new OllamaProvider({ host: url });
    await expect(provider.generate({ system: "", parts: [], schema })).rejects.toThrow(
      /ollama pull qwen2\.5vl/,
    );
  });

  it("reports an unreachable host", async () => {
    const provider = new OllamaProvider({ host: "http://127.0.0.1:9" });
    await expect(provider.generate({ system: "", parts: [], schema })).rejects.toThrow(
      /not reachable/,
    );
  });
});
