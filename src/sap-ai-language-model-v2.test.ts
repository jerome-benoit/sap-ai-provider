/**
 * Unit tests for SAP AI Language Model V2 (Facade).
 *
 * These tests focus on:
 * 1. V2-specific properties (specificationVersion)
 * 2. Delegation to V3 implementation
 * 3. Verification that V2 format is returned (without re-testing conversion logic)
 *
 * Business logic is tested in sap-ai-language-model.test.ts (V3).
 * Format conversions are unit-tested in sap-ai-adapters-v3-to-v2.test.ts.
 * This file does NOT duplicate the conversion tests - it only verifies delegation.
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

    it("should return V2 format from doGenerate (uses adapters)", async () => {
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

      // Verify V2 format (string finishReason, flat usage)
      // Detailed conversion logic tested in sap-ai-adapters-v3-to-v2.test.ts
      expect(typeof result.finishReason).toBe("string");
      expect(result.usage).toHaveProperty("totalTokens");
    });

    it("should return V2 format from doStream (uses adapters)", async () => {
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

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      const parts = await readAllParts(result.stream);
      const finish = parts.find((p) => p.type === "finish");

      // Verify V2 format (string finishReason, flat usage)
      // Detailed conversion logic tested in sap-ai-adapters-v3-to-v2.test.ts
      expect(finish).toBeDefined();
      if (finish?.type === "finish") {
        expect(typeof finish.finishReason).toBe("string");
        expect(finish.usage).toHaveProperty("totalTokens");
      }
    });

    it("should propagate errors from V3 doGenerate", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockError = new Error("V3 generation failed");
      const mockDoGenerate = vi.fn().mockRejectedValue(mockError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doGenerate = mockDoGenerate;

      await expect(
        model.doGenerate({
          prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        }),
      ).rejects.toThrow("V3 generation failed");
    });

    it("should propagate errors from V3 doStream", async () => {
      const model = new SAPAILanguageModelV2("gpt-4o", {}, defaultConfig);

      const mockError = new Error("V3 streaming failed");
      const mockDoStream = vi.fn().mockRejectedValue(mockError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doStream = mockDoStream;

      await expect(
        model.doStream({
          prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
        }),
      ).rejects.toThrow("V3 streaming failed");
    });
  });
});
