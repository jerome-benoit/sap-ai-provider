/**
 * Unit tests for SAP AI Language Model V2 (Facade).
 *
 * These tests focus on:
 * 1. Delegation to V3 implementation
 * 2. V3 → V2 format transformations
 * 3. V2-specific properties (specificationVersion)
 *
 * Business logic is tested in sap-ai-language-model.test.ts (V3).
 * Format conversions are unit-tested in sap-ai-adapters-v3-to-v2.test.ts.
 */

import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";

import { describe, expect, it, vi } from "vitest";

import { SAPAILanguageModelV2 } from "./sap-ai-language-model-v2.js";

describe("SAPAILanguageModelV2", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  /**
   * Helper to read all parts from a V2 stream.
   * @param stream - The V2 stream to read from
   * @returns Promise resolving to array of all stream parts
   */
  async function readAllParts(
    stream: ReadableStream<LanguageModelV2StreamPart>,
  ): Promise<LanguageModelV2StreamPart[]> {
    const parts: LanguageModelV2StreamPart[] = [];
    const reader = stream.getReader();
    let done = false;
    while (!done) {
      const { done: streamDone, value } = await reader.read();
      done = streamDone;
      if (value) {
        parts.push(value);
      }
    }
    return parts;
  }

  describe("V2-specific properties", () => {
    it("should have V2 specification version", () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      expect(model.specificationVersion).toBe("v2");
    });

    it("should expose correct modelId and provider", () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai");
    });
  });

  describe("Delegation to V3", () => {
    it("should delegate doGenerate to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(mockDoGenerate).toHaveBeenCalledTimes(1);
    });

    it("should delegate doStream to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(mockDoStream).toHaveBeenCalledTimes(1);
    });

    it("should forward all call options to V3 doGenerate", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const controller = new AbortController();
      const options = {
        abortSignal: controller.signal,
        headers: { "x-custom": "value" },
        prompt: [{ content: [{ text: "Test", type: "text" as const }], role: "user" as const }],
        providerOptions: { "sap-ai": { modelParams: { temperature: 0.9 } } },
        responseFormat: { type: "json" as const },
        tools: [],
      };

      await model.doGenerate(options);

      expect(mockDoGenerate).toHaveBeenCalledWith(options);
    });

    it("should forward all call options to V3 doStream", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const controller = new AbortController();
      const options = {
        abortSignal: controller.signal,
        headers: { "x-custom": "value" },
        prompt: [{ content: [{ text: "Test", type: "text" as const }], role: "user" as const }],
        providerOptions: { "sap-ai": { streaming: true } },
      };

      await model.doStream(options);

      expect(mockDoStream).toHaveBeenCalledWith(options);
    });
  });

  describe("V3 → V2 Format Conversion: FinishReason", () => {
    it.each([
      { expected: "stop", finishReason: { raw: "stop", unified: "stop" } },
      { expected: "length", finishReason: { raw: "length", unified: "length" } },
      {
        expected: "content-filter",
        finishReason: { raw: "content_filter", unified: "content-filter" },
      },
      { expected: "tool-calls", finishReason: { raw: "tool_calls", unified: "tool-calls" } },
      { expected: "error", finishReason: { raw: "error", unified: "error" } },
      { expected: "other", finishReason: { raw: "some_unknown", unified: "other" } },
    ])(
      "should convert V3 finish reason '$expected' to V2 string",
      async ({ expected, finishReason }) => {
        const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

        const mockDoGenerate = vi.fn().mockResolvedValue({
          content: [{ text: "Test", type: "text" }],
          finishReason,
          usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } },
          warnings: [],
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
        (model as any).v3Model.doGenerate = mockDoGenerate;

        const result = await model.doGenerate({
          prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        });

        expect(result.finishReason).toBe(expected);
        expect(typeof result.finishReason).toBe("string");
      },
    );
  });

  describe("V3 → V2 Format Conversion: Usage", () => {
    it("should convert usage from V3 nested format to V2 flat format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: { cacheRead: 5, total: 100 },
          outputTokens: { reasoning: 10, total: 50 },
        },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.usage).toEqual({
        cachedInputTokens: 5,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 10,
        totalTokens: 150,
      });
    });

    it("should handle usage with only total fields", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: { cacheRead: undefined, total: 50 },
          outputTokens: { reasoning: undefined, total: 25 },
        },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.usage).toEqual({
        cachedInputTokens: undefined,
        inputTokens: 50,
        outputTokens: 25,
        reasoningTokens: undefined,
        totalTokens: 75,
      });
    });

    it("should handle usage with all optional fields populated", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: 20,
            cacheWrite: 10,
            noCache: 70,
            total: 100,
          },
          outputTokens: {
            reasoning: 15,
            text: 35,
            total: 50,
          },
        },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.usage).toEqual({
        cachedInputTokens: 20,
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 15,
        totalTokens: 150,
      });
    });
  });

  describe("V3 → V2 Format Conversion: Warnings", () => {
    it("should convert V3 unsupported warning to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [{ details: "Tool not supported", feature: "custom-tool", type: "unsupported" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        message: "Unsupported feature: custom-tool. Tool not supported",
        type: "other",
      });
    });

    it("should convert V3 compatibility warning to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [
          {
            details: "Some compatibility issue",
            feature: "special-feature",
            type: "compatibility",
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        message: "Compatibility mode: special-feature. Some compatibility issue",
        type: "other",
      });
    });

    it("should convert V3 other warning to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [{ message: "Some other warning", type: "other" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toEqual({
        message: "Some other warning",
        type: "other",
      });
    });

    it("should handle empty warnings array", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.warnings).toEqual([]);
    });
  });

  describe("Stream V3 → V2 Format Conversion", () => {
    it("should convert V3 stream to V2 stream format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ delta: "Hello", id: "text-0", type: "text-delta" });
          controller.enqueue({ delta: " world", id: "text-0", type: "text-delta" });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 2 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Say hello", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      expect(textDeltas).toHaveLength(2);

      const finish = parts.find((p) => p.type === "finish");
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        // V2 format: finishReason is string, not object
        expect(typeof finish.finishReason).toBe("string");
        expect(finish.finishReason).toBe("stop");
        // V2 format: usage is flat, not nested
        expect(finish.usage).toHaveProperty("totalTokens");
        expect(finish.usage.totalTokens).toBe(7);
      }
    });

    it("should convert stream finish reasons to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            finishReason: { raw: "length", unified: "length" },
            type: "finish",
            usage: {
              inputTokens: { cacheRead: 5, total: 100 },
              outputTokens: { reasoning: 10, total: 50 },
            },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);
      const finish = parts.find((p) => p.type === "finish");

      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(finish.finishReason).toBe("length");
        expect(finish.usage).toEqual({
          cachedInputTokens: 5,
          inputTokens: 100,
          outputTokens: 50,
          reasoningTokens: 10,
          totalTokens: 150,
        });
      }
    });

    it("should convert stream-start warnings from V3 to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: [
              { details: "Feature not supported", feature: "custom-feature", type: "unsupported" },
            ],
          });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);
      const streamStart = parts.find((p) => p.type === "stream-start");

      expect(streamStart).toBeDefined();
      if (streamStart?.type === "stream-start") {
        expect(streamStart.warnings).toHaveLength(1);
        expect(streamStart.warnings[0]).toEqual({
          message: "Unsupported feature: custom-feature. Feature not supported",
          type: "other",
        });
      }
    });

    it("should handle pass-through stream events (text-delta, tool-call, etc.)", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ delta: "Hello", id: "text-0", type: "text-delta" });
          controller.enqueue({
            input: { location: "Paris" },
            toolCallId: "call-123",
            toolName: "get_weather",
            type: "tool-call",
          });
          controller.enqueue({
            finishReason: { raw: "tool-calls", unified: "tool-calls" },
            type: "finish",
            usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Weather", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);

      // Text deltas pass through unchanged
      const textDelta = parts.find((p) => p.type === "text-delta");
      expect(textDelta).toBeDefined();

      // Tool calls pass through unchanged
      const toolCall = parts.find((p) => p.type === "tool-call");
      expect(toolCall).toBeDefined();
      if (toolCall?.type === "tool-call") {
        expect(toolCall.toolName).toBe("get_weather");
      }

      // Finish event is converted
      const finish = parts.find((p) => p.type === "finish");
      if (finish?.type === "finish") {
        expect(finish.finishReason).toBe("tool-calls");
      }
    });
  });
});
