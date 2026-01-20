/** Unit tests for SAP AI Language Model V2. */

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
   * @param stream - The stream to read from.
   * @returns Array of all stream parts.
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

  describe("Model properties", () => {
    it("should have correct specification version", () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      expect(model.specificationVersion).toBe("v2");
      expect(model.provider).toBe("sap-ai");
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should delegate provider property to V3 model", () => {
      const model = new SAPAILanguageModelV2("gpt-4o-mini", {}, defaultConfig);

      expect(model.provider).toBe("sap-ai");
    });

    it("should delegate supportedUrls property to V3 model", () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      expect(model.supportedUrls).toBeDefined();
      expect(typeof model.supportedUrls).toBe("object");
    });

    it("should pass settings to V3 model", () => {
      const settings = {
        modelParams: {
          temperature: 0.7,
        },
      };

      const model = new SAPAILanguageModelV2("gpt-4o", settings, defaultConfig);

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it.each([
      "gpt-4o",
      "gpt-4o-mini",
      "o1",
      "o3-mini",
      "gemini-2.0-flash",
      "anthropic--claude-3-5-sonnet",
    ])("should handle model ID: %s", (modelId) => {
      const model = new SAPAILanguageModelV2(modelId, {}, defaultConfig);
      expect(model.modelId).toBe(modelId);
      expect(model.specificationVersion).toBe("v2");
    });

    it("should have supportedUrls getter that returns image patterns", () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);
      const urls = model.supportedUrls;

      expect(urls).toHaveProperty("image/*");
      expect(urls["image/*"]).toHaveLength(2);
      expect(urls["image/*"][0].test("https://example.com/image.png")).toBe(true);
      expect(urls["image/*"][0].test("http://example.com/image.png")).toBe(false);
      expect(urls["image/*"][1].test("data:image/png;base64,Zm9v")).toBe(true);
    });

    describe("model properties consistency", () => {
      it.each([
        "any-model",
        "gpt-4o",
        "anthropic--claude-3.5-sonnet",
        "gemini-2.0-flash",
        "amazon--nova-pro",
        "mistralai--mistral-large-instruct",
        "unknown-future-model",
      ])("should have consistent V2 interface for model %s", (modelId) => {
        const model = new SAPAILanguageModelV2(modelId, {}, defaultConfig);
        expect(model.specificationVersion).toBe("v2");
        expect(model.modelId).toBe(modelId);
        expect(model.provider).toBe("sap-ai");
        expect(model.supportedUrls).toBeDefined();
      });
    });
  });

  describe("constructor validation", () => {
    it.each([
      { name: "valid modelParams", params: { maxTokens: 1000, temperature: 0.7, topP: 0.9 } },
      { name: "empty modelParams", params: {} },
      { name: "no modelParams", params: undefined },
    ])("should accept $name", ({ params }) => {
      expect(
        () =>
          new SAPAILanguageModelV2("gpt-4o", params ? { modelParams: params } : {}, defaultConfig),
      ).not.toThrow();
    });

    it.each([
      { name: "temperature too high", params: { temperature: 3 } },
      { name: "temperature negative", params: { temperature: -1 } },
      { name: "topP out of range", params: { topP: 1.5 } },
      { name: "non-positive maxTokens", params: { maxTokens: 0 } },
      { name: "non-integer maxTokens", params: { maxTokens: 100.5 } },
      { name: "frequencyPenalty out of range", params: { frequencyPenalty: -3 } },
      { name: "presencePenalty out of range", params: { presencePenalty: 2.5 } },
    ])("should throw on $name (delegated to V3)", ({ params }) => {
      expect(
        () => new SAPAILanguageModelV2("gpt-4o", { modelParams: params }, defaultConfig),
      ).toThrow();
    });
  });

  describe("doGenerate", () => {
    it("should delegate to V3 model and transform response to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Hello, how can I help you?", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        providerMetadata: { "sap-ai": { modelId: "gpt-4o" } },
        request: { body: { messages: [] } },
        response: {
          body: { choices: [] },
          headers: { "x-request-id": "123" },
          id: "resp-123",
          modelId: "gpt-4o",
          timestamp: new Date(),
        },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      });

      expect(mockDoGenerate).toHaveBeenCalled();
      expect(result.content).toEqual([{ text: "Hello, how can I help you?", type: "text" }]);
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      });
      expect(result.warnings).toEqual([]);
      expect(result.providerMetadata).toBeDefined();
      expect(result.response?.id).toBe("resp-123");
      expect(result.response?.headers).toBeDefined();
    });

    it("should convert finish reason from V3 object to V2 string", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "length", unified: "length" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.finishReason).toBe("length");
      expect(typeof result.finishReason).toBe("string");
    });

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

    it("should convert warnings from V3 to V2 format", async () => {
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

    it("should handle tool calls in content", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [
          {
            input: { query: "weather" },
            toolCallId: "call-123",
            toolName: "get_weather",
            type: "tool-call",
          },
        ],
        finishReason: { raw: "tool-calls", unified: "tool-calls" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "What's the weather?", type: "text" }], role: "user" }],
      });

      expect(result.content).toEqual([
        {
          input: { query: "weather" },
          toolCallId: "call-123",
          toolName: "get_weather",
          type: "tool-call",
        },
      ]);
      expect(result.finishReason).toBe("tool-calls");
    });

    it("should pass through request and response metadata", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockTimestamp = new Date("2024-01-01T00:00:00Z");
      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        request: { body: { messages: [{ content: "test", role: "user" }] } },
        response: {
          body: { choices: [] },
          headers: { "content-type": "application/json" },
          id: "chatcmpl-123",
          modelId: "gpt-4o",
          timestamp: mockTimestamp,
        },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.request?.body).toEqual({ messages: [{ content: "test", role: "user" }] });
      expect(result.response?.id).toBe("chatcmpl-123");
      expect(result.response?.modelId).toBe("gpt-4o");
      expect(result.response?.timestamp).toBe(mockTimestamp);
      expect(result.response?.headers).toEqual({ "content-type": "application/json" });
    });

    it("should handle missing optional fields gracefully", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.providerMetadata).toBeUndefined();
      expect(result.request).toBeUndefined();
      expect(result.response).toBeUndefined();
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

    it("should handle provider metadata correctly", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        providerMetadata: { "sap-ai": { customField: "value", modelId: "gpt-4o" } },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.providerMetadata).toEqual({
        "sap-ai": { customField: "value", modelId: "gpt-4o" },
      });
    });

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

    it("should propagate errors from V3 doGenerate", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const testError = new Error("V3 generation failed");
      const mockDoGenerate = vi.fn().mockRejectedValue(testError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      await expect(
        model.doGenerate({
          prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        }),
      ).rejects.toThrow("V3 generation failed");
    });

    it("should handle usage with undefined optional fields", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined,
            total: 50,
          },
          outputTokens: { reasoning: undefined, text: undefined, total: 25 },
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

    it("should handle multiple tool calls in content", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [
          {
            input: { city: "Paris" },
            toolCallId: "call-1",
            toolName: "get_weather",
            type: "tool-call",
          },
          {
            input: { query: "restaurants" },
            toolCallId: "call-2",
            toolName: "search",
            type: "tool-call",
          },
        ],
        finishReason: { raw: "tool_calls", unified: "tool-calls" },
        usage: { inputTokens: { total: 20 }, outputTokens: { total: 15 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [
          { content: [{ text: "Weather and restaurants in Paris", type: "text" }], role: "user" },
        ],
      });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toMatchObject({ toolCallId: "call-1", toolName: "get_weather" });
      expect(result.content[1]).toMatchObject({ toolCallId: "call-2", toolName: "search" });
    });

    it("should handle mixed text and tool-call content", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [
          { text: "Let me check", type: "text" },
          {
            input: { query: "test" },
            toolCallId: "call-1",
            toolName: "search",
            type: "tool-call",
          },
        ],
        finishReason: { raw: "tool_calls", unified: "tool-calls" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 10 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [{ content: [{ text: "Search", type: "text" }], role: "user" }],
      });

      expect(result.content).toHaveLength(2);
      expect(result.content[0]).toMatchObject({ text: "Let me check", type: "text" });
      expect(result.content[1]).toMatchObject({ toolName: "search", type: "tool-call" });
    });
  });

  describe("doStream", () => {
    it("should delegate to V3 model and transform stream to V2 format", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "response-metadata",
            value: { id: "resp-123", modelId: "gpt-4o", timestamp: new Date() },
          });
          controller.enqueue({ delta: "Hello", id: "text-0", type: "text-delta" });
          controller.enqueue({ delta: " world", id: "text-0", type: "text-delta" });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 5 }, outputTokens: { total: 10 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({
        request: { body: { messages: [] } },
        response: { headers: { "x-request-id": "123" } },
        stream: mockV3Stream,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
      });

      expect(mockDoStream).toHaveBeenCalled();
      expect(result.stream).toBeDefined();
      expect(result.request?.body).toEqual({ messages: [] });
      expect(result.response?.headers).toEqual({ "x-request-id": "123" });

      const reader = result.stream.getReader();
      const parts = [];
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          parts.push(value);
        }
      }

      expect(parts.length).toBeGreaterThan(0);
      const textDelta = parts.find((p) => p.type === "text-delta");
      expect(textDelta).toBeDefined();

      const finish = parts.find((p) => p.type === "finish");
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(typeof finish.finishReason).toBe("string");
        expect(finish.usage).toHaveProperty("totalTokens");
      }
    });

    it("should convert V3 stream finish event to V2 format", async () => {
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

      const reader = result.stream.getReader();
      const parts = [];
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          parts.push(value);
        }
      }

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

    it("should handle text-delta events in stream", async () => {
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

      const reader = result.stream.getReader();
      const parts = [];
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          parts.push(value);
        }
      }

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0]).toMatchObject({ delta: "Hello", id: "text-0", type: "text-delta" });
      expect(textDeltas[1]).toMatchObject({ delta: " world", id: "text-0", type: "text-delta" });
    });

    it("should handle tool calls in stream", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
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
        prompt: [{ content: [{ text: "Weather in Paris?", type: "text" }], role: "user" }],
      });

      const reader = result.stream.getReader();
      const parts = [];
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          parts.push(value);
        }
      }

      const toolCall = parts.find((p) => p.type === "tool-call");
      expect(toolCall).toBeDefined();
      if (toolCall?.type === "tool-call") {
        expect(toolCall.toolName).toBe("get_weather");
        expect(toolCall.toolCallId).toBe("call-123");
        expect(toolCall.input).toEqual({ location: "Paris" });
      }
    });

    it("should handle errors in stream", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockError = new Error("Stream error");
      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ error: mockError, type: "error" });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      const reader = result.stream.getReader();
      const parts = [];
      let done = false;

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        done = streamDone;
        if (value) {
          parts.push(value);
        }
      }

      const error = parts.find((p) => p.type === "error");
      expect(error).toBeDefined();
      if (error?.type === "error") {
        expect(error.error).toBe(mockError);
      }
    });

    it("should pass through request and response metadata", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({
        request: { body: { messages: [{ content: "test", role: "user" }] } },
        response: { headers: { "content-type": "text/event-stream", "x-request-id": "req-456" } },
        stream: mockV3Stream,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.request?.body).toEqual({ messages: [{ content: "test", role: "user" }] });
      expect(result.response?.headers).toEqual({
        "content-type": "text/event-stream",
        "x-request-id": "req-456",
      });
    });

    it.each([
      { expected: "stop", finishReason: { raw: "stop", unified: "stop" } },
      { expected: "length", finishReason: { raw: "max_tokens", unified: "length" } },
      {
        expected: "content-filter",
        finishReason: { raw: "content_filter", unified: "content-filter" },
      },
      { expected: "tool-calls", finishReason: { raw: "tool_calls", unified: "tool-calls" } },
      { expected: "error", finishReason: { raw: "error", unified: "error" } },
      { expected: "other", finishReason: { raw: undefined, unified: "other" } },
    ])(
      "should convert stream finish reason to V2 string: $expected",
      async ({ expected, finishReason }) => {
        const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

        const mockV3Stream = new ReadableStream({
          start(controller) {
            controller.enqueue({
              finishReason,
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
        const finish = parts.find((p) => p.type === "finish");

        expect(finish).toBeDefined();
        if (finish?.type === "finish") {
          expect(finish.finishReason).toBe(expected);
          expect(typeof finish.finishReason).toBe("string");
        }
      },
    );

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

    it("should handle response-metadata stream part passthrough", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);
      const testTimestamp = new Date("2024-06-15T10:00:00Z");

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            id: "resp-abc123",
            modelId: "gpt-4o",
            timestamp: testTimestamp,
            type: "response-metadata",
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
      const metadata = parts.find((p) => p.type === "response-metadata");

      expect(metadata).toBeDefined();
      if (metadata?.type === "response-metadata") {
        expect(metadata.id).toBe("resp-abc123");
        expect(metadata.modelId).toBe("gpt-4o");
        expect(metadata.timestamp).toEqual(testTimestamp);
      }
    });

    it("should handle text-start and text-end stream parts", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ id: "text-block-0", type: "text-start" });
          controller.enqueue({ delta: "Hello", id: "text-block-0", type: "text-delta" });
          controller.enqueue({ id: "text-block-0", type: "text-end" });
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

      const textStart = parts.find((p) => p.type === "text-start");
      const textEnd = parts.find((p) => p.type === "text-end");

      expect(textStart).toBeDefined();
      expect(textEnd).toBeDefined();
      if (textStart?.type === "text-start" && textEnd?.type === "text-end") {
        expect(textStart.id).toBe("text-block-0");
        expect(textEnd.id).toBe("text-block-0");
      }
    });

    it("should handle tool-input stream events", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ id: "call-123", toolName: "get_weather", type: "tool-input-start" });
          controller.enqueue({ delta: '{"city":', id: "call-123", type: "tool-input-delta" });
          controller.enqueue({ delta: '"Paris"}', id: "call-123", type: "tool-input-delta" });
          controller.enqueue({ id: "call-123", type: "tool-input-end" });
          controller.enqueue({
            input: '{"city":"Paris"}',
            toolCallId: "call-123",
            toolName: "get_weather",
            type: "tool-call",
          });
          controller.enqueue({
            finishReason: { raw: "tool_calls", unified: "tool-calls" },
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

      expect(parts.some((p) => p.type === "tool-input-start")).toBe(true);
      expect(parts.filter((p) => p.type === "tool-input-delta")).toHaveLength(2);
      expect(parts.some((p) => p.type === "tool-input-end")).toBe(true);
      expect(parts.some((p) => p.type === "tool-call")).toBe(true);
    });

    it("should handle raw stream parts when passed through", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);
      const rawData = { custom: "data", internal: true };

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ rawValue: rawData, type: "raw" });
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
      const rawPart = parts.find((p) => p.type === "raw");

      expect(rawPart).toBeDefined();
      if (rawPart?.type === "raw") {
        expect(rawPart.rawValue).toEqual(rawData);
      }
    });

    it("should propagate stream setup errors", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const testError = new Error("Stream setup failed");
      const mockDoStream = vi.fn().mockRejectedValue(testError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      await expect(
        model.doStream({
          prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        }),
      ).rejects.toThrow("Stream setup failed");
    });

    it("should handle stream iteration errors via error stream part", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const streamError = new Error("Stream iteration error");
      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ delta: "Starting...", id: "text-0", type: "text-delta" });
          controller.enqueue({ error: streamError, type: "error" });
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

      const textDelta = parts.find((p) => p.type === "text-delta");
      expect(textDelta).toBeDefined();

      const errorPart = parts.find((p) => p.type === "error");
      expect(errorPart).toBeDefined();
      if (errorPart?.type === "error") {
        expect(errorPart.error).toBe(streamError);
      }
    });

    it("should handle missing optional response metadata in stream result", async () => {
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

      // No request or response in the result
      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(result.request).toBeUndefined();
      expect(result.response).toBeUndefined();
      expect(result.stream).toBeDefined();
    });

    it("should handle providerMetadata in finish stream part", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            providerMetadata: {
              "sap-ai": {
                finishReason: "stop",
                responseId: "resp-xyz",
              },
            },
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
      const finish = parts.find((p) => p.type === "finish");

      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(finish.providerMetadata).toBeDefined();
        expect(finish.providerMetadata?.["sap-ai"]).toMatchObject({
          finishReason: "stop",
          responseId: "resp-xyz",
        });
      }
    });

    it("should handle reasoning-delta stream parts", async () => {
      const model = new SAPAILanguageModelV2("o1", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ id: "reasoning-0", type: "reasoning-start" });
          controller.enqueue({
            delta: "Let me think about this...",
            id: "reasoning-0",
            type: "reasoning-delta",
          });
          controller.enqueue({
            delta: " After analysis...",
            id: "reasoning-0",
            type: "reasoning-delta",
          });
          controller.enqueue({ id: "reasoning-0", type: "reasoning-end" });
          controller.enqueue({ delta: "The answer is 42", id: "text-0", type: "text-delta" });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 10 }, outputTokens: { reasoning: 20, total: 25 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [
          { content: [{ text: "What is the meaning of life?", type: "text" }], role: "user" },
        ],
      });

      const parts = await readAllParts(result.stream);

      expect(parts.some((p) => p.type === "reasoning-start")).toBe(true);
      expect(parts.filter((p) => p.type === "reasoning-delta")).toHaveLength(2);
      expect(parts.some((p) => p.type === "reasoning-end")).toBe(true);
      expect(parts.some((p) => p.type === "text-delta")).toBe(true);

      const finish = parts.find((p) => p.type === "finish");
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(finish.usage.reasoningTokens).toBe(20);
      }
    });

    it("should handle tool-result stream parts", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockV3Stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            result: { temperature: 22, unit: "celsius" },
            toolCallId: "call-weather-123",
            toolName: "get_weather",
            type: "tool-result",
          });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: { inputTokens: { total: 20 }, outputTokens: { total: 10 } },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn().mockResolvedValue({ stream: mockV3Stream });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "What's the weather?", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);
      const toolResult = parts.find((p) => p.type === "tool-result");

      expect(toolResult).toBeDefined();
      if (toolResult?.type === "tool-result") {
        expect(toolResult.toolName).toBe("get_weather");
        expect(toolResult.toolCallId).toBe("call-weather-123");
        expect(toolResult.result).toEqual({ temperature: 22, unit: "celsius" });
      }
    });
  });

  describe("Call options delegation", () => {
    it("should forward responseFormat to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: '{"answer": "test"}', type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      await model.doGenerate({
        prompt: [{ content: [{ text: "Return JSON", type: "text" }], role: "user" }],
        responseFormat: { type: "json" },
      });

      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          responseFormat: { type: "json" },
        }),
      );
    });

    it("should forward tools to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Let me help", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const tools = [
        {
          description: "Get current weather",
          inputSchema: {
            properties: { city: { type: "string" as const } },
            type: "object" as const,
          },
          name: "get_weather",
          type: "function" as const,
        },
      ];

      await model.doGenerate({
        prompt: [{ content: [{ text: "Weather?", type: "text" }], role: "user" }],
        tools,
      });

      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "get_weather",
              type: "function",
            }),
          ]),
        }),
      );
    });

    it("should forward providerOptions to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const providerOptions = {
        "sap-ai": {
          includeReasoning: true,
          modelParams: { temperature: 0.9 },
        },
      };

      await model.doGenerate({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        providerOptions,
      });

      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions,
        }),
      );
    });

    it("should forward abortSignal to V3 model", async () => {
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

      await model.doGenerate({
        abortSignal: controller.signal,
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
        }),
      );
    });

    it("should forward headers to V3 model", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockDoGenerate = vi.fn().mockResolvedValue({
        content: [{ text: "Test", type: "text" }],
        finishReason: { raw: "stop", unified: "stop" },
        usage: { inputTokens: { total: 5 }, outputTokens: { total: 5 } },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      const customHeaders = { "x-custom-header": "custom-value" };

      await model.doGenerate({
        headers: customHeaders,
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(mockDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: customHeaders,
        }),
      );
    });

    it("should forward stream options to V3 model doStream", async () => {
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
      const customHeaders = { "x-stream-header": "stream-value" };

      await model.doStream({
        abortSignal: controller.signal,
        headers: customHeaders,
        prompt: [{ content: [{ text: "Stream test", type: "text" }], role: "user" }],
        providerOptions: { "sap-ai": { streaming: true } },
      });

      expect(mockDoStream).toHaveBeenCalledWith(
        expect.objectContaining({
          abortSignal: controller.signal,
          headers: customHeaders,
          providerOptions: { "sap-ai": { streaming: true } },
        }),
      );
    });
  });
});
