/**
 * Unit tests for SAP AI Embedding Model V4 and Provider V4 (Facades).
 *
 * Spec versions, delegation, and factory wiring. Core logic is covered by
 * the V3 core tests and the adapters tests.
 */

import type { EmbeddingModelV3CallOptions, EmbeddingModelV3Result } from "@ai-sdk/provider";

import { describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModelV4 } from "./sap-ai-embedding-model-v4.js";
import { createSAPAIProviderV4 } from "./sap-ai-provider-v4.js";

interface InternalEmbeddingModel {
  doEmbed: (options: EmbeddingModelV3CallOptions) => Promise<EmbeddingModelV3Result>;
}
/**
 *
 * @param model
 */
function internalOf(model: SAPAIEmbeddingModelV4): { internalModel: InternalEmbeddingModel } {
  return model as unknown as { internalModel: InternalEmbeddingModel };
}

describe("SAPAIEmbeddingModelV4", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  it("should have V4 specification version", () => {
    const model = new SAPAIEmbeddingModelV4("text-embedding-3-small", {}, defaultConfig);

    expect(model.specificationVersion).toBe("v4");
  });

  it("should delegate doEmbed and convert metadata", async () => {
    const model = new SAPAIEmbeddingModelV4("text-embedding-3-small", {}, defaultConfig);

    const mockDoEmbed = vi.fn((): Promise<EmbeddingModelV3Result> =>
      Promise.resolve({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 4 },
        warnings: [],
      }),
    );
    internalOf(model).internalModel.doEmbed = mockDoEmbed;

    const result = await model.doEmbed({ values: ["hello"] });

    expect(mockDoEmbed).toHaveBeenCalledTimes(1);
    expect(result.embeddings).toEqual([[0.1, 0.2]]);
    expect(result.usage).toEqual({ tokens: 4 });
    expect(result.warnings).toEqual([]);
  });
});

describe("createSAPAIProviderV4", () => {
  it("should create language models with specificationVersion v4", () => {
    const provider = createSAPAIProviderV4();

    expect(provider.specificationVersion).toBe("v4");
    const model = provider.languageModel("gpt-4o");
    expect(model.specificationVersion).toBe("v4");
    expect(model.modelId).toBe("gpt-4o");
  });

  it("should create embedding models with specificationVersion v4", () => {
    const provider = createSAPAIProviderV4();
    const model = provider.embeddingModel("text-embedding-3-small");

    expect(model.specificationVersion).toBe("v4");
  });

  it("should throw for image models", () => {
    const provider = createSAPAIProviderV4();

    expect(() => provider.imageModel("dall-e-3")).toThrow("does not support image generation");
  });
});
