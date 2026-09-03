/**
 * Unit tests for SAP AI Language Model V4 (Facade).
 *
 * V4-specific properties, delegation with prompt normalization, and V4 result
 * shape. Business logic lives in the V3 core tests; conversions in adapters tests.
 */

import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

import { describe, expect, it, vi } from "vitest";

import { SAPAILanguageModelV4 } from "./sap-ai-language-model-v4.js";

interface InternalModel {
  doGenerate: (options: LanguageModelV3CallOptions) => Promise<LanguageModelV3GenerateResult>;
  doStream: (options: LanguageModelV3CallOptions) => Promise<LanguageModelV3StreamResult>;
}

/**
 *
 * @param model
 */
function internalOf(model: SAPAILanguageModelV4): { internalModel: InternalModel } {
  return model as unknown as { internalModel: InternalModel };
}

describe("SAPAILanguageModelV4", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  describe("V4-specific properties", () => {
    it("should have V4 specification version", () => {
      const model = new SAPAILanguageModelV4("gpt-4o", {}, defaultConfig);

      expect(model.specificationVersion).toBe("v4");
    });

    it("should expose correct modelId and provider", () => {
      const model = new SAPAILanguageModelV4("gpt-4o", {}, defaultConfig);

      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai");
    });
  });

  describe("Delegation with V4 normalization", () => {
    it("should normalize tagged file prompts before delegating doGenerate", async () => {
      const model = new SAPAILanguageModelV4("gpt-4o", {}, defaultConfig);

      let captured: LanguageModelV3CallOptions | undefined;
      const mockDoGenerate = vi.fn(
        (options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> =>
          Promise.resolve({
            content: [{ text: "Test", type: "text" as const }],
            finishReason: { raw: "stop", unified: "stop" as const },
            usage: {
              inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
              outputTokens: { reasoning: 0, text: 1, total: 1 },
            },
            warnings: [],
          }).then((result) => {
            captured = options;
            return result;
          }),
      );
      internalOf(model).internalModel.doGenerate = mockDoGenerate;

      const result = await model.doGenerate({
        prompt: [
          {
            content: [
              {
                data: { data: "aGVsbG8=", type: "data" },
                mediaType: "image/jpeg",
                type: "file",
              },
            ],
            role: "user",
          },
        ],
      });

      expect(mockDoGenerate).toHaveBeenCalledTimes(1);
      const content = captured?.prompt[0];
      expect(content).toMatchObject({
        content: [{ data: "aGVsbG8=", type: "file" }],
      });
      // Usage mapped by identity, warnings present.
      expect(result.usage).toEqual({
        inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
        outputTokens: { reasoning: 0, text: 1, total: 1 },
      });
      expect(result.warnings).toEqual([]);
    });

    it("should delegate doStream and convert parts to V4", async () => {
      const model = new SAPAILanguageModelV4("gpt-4o", {}, defaultConfig);

      const mockInternalStream = new ReadableStream({
        start(controller) {
          controller.enqueue({ delta: "hi", id: "1", type: "text-delta" });
          controller.enqueue({
            finishReason: { raw: "stop", unified: "stop" },
            type: "finish",
            usage: {
              inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 1, total: 1 },
              outputTokens: { reasoning: 0, text: 1, total: 1 },
            },
          });
          controller.close();
        },
      });

      const mockDoStream = vi.fn((): Promise<LanguageModelV3StreamResult> =>
        Promise.resolve({ stream: mockInternalStream }),
      );
      internalOf(model).internalModel.doStream = mockDoStream;

      const result = await model.doStream({
        prompt: [{ content: [{ text: "Test", type: "text" }], role: "user" }],
      });

      expect(mockDoStream).toHaveBeenCalledTimes(1);
      const parts: unknown[] = [];
      const reader = result.stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatchObject({ delta: "hi", type: "text-delta" });
    });
  });
});
