/**
 * Unit tests for SAP AI Provider V2.
 *
 * Test Strategy:
 * V2 is a thin facade that delegates to V3 and converts response formats.
 * These tests verify ONLY V2-specific behavior:
 * - specificationVersion === 'v2' for all models
 * - Delegation to V3 provider (configuration passes through)
 *
 * Tests NOT included here (covered by V3 tests in sap-ai-provider.test.ts):
 * - Configuration handling (resourceGroup, deploymentId, destination, modelParams validation)
 * - Log level configuration
 * - Custom provider name
 * - imageModel error handling (NoSuchModelError)
 * - Provider factory behavior
 * - sapai default provider methods
 * @see sap-ai-provider.test.ts for comprehensive V3 provider tests
 * @see SAPAIProviderV2
 */

import { describe, expect, it } from "vitest";

import { createSAPAIProvider, sapai } from "./sap-ai-provider-v2.js";

describe("createSAPAIProvider (V2)", () => {
  describe("V2-specific: specificationVersion is v2", () => {
    it("should create language models with specificationVersion v2", () => {
      const provider = createSAPAIProvider();

      const languageModel = provider.languageModel("gpt-4o");
      expect(languageModel.specificationVersion).toBe("v2");
      expect(languageModel.modelId).toBe("gpt-4o");
      expect(languageModel.provider).toBe("sap-ai.chat");
    });

    it("should create embedding models with specificationVersion v2", () => {
      const provider = createSAPAIProvider();

      const embeddingModel = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(embeddingModel.specificationVersion).toBe("v2");
      expect(embeddingModel.modelId).toBe("text-embedding-ada-002");
      expect(embeddingModel.provider).toBe("sap-ai.embedding");
    });
  });

  describe("V2-specific: delegation to V3", () => {
    it("should delegate languageModel to V3 with configuration", () => {
      const provider = createSAPAIProvider({
        defaultSettings: { modelParams: { temperature: 0.7 } },
        resourceGroup: "production",
      });

      const model = provider.languageModel("gpt-4o", {
        modelParams: { maxTokens: 2000 },
      });

      // Model is created and returns V2 format
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should delegate textEmbeddingModel to V3 with settings", () => {
      const provider = createSAPAIProvider({
        resourceGroup: "production",
      });

      const model = provider.textEmbeddingModel("text-embedding-3-small", {
        maxEmbeddingsPerCall: 500,
        type: "query",
      });

      // Model is created with V2 format and settings pass through
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.maxEmbeddingsPerCall).toBe(500);
      expect(model.specificationVersion).toBe("v2");
    });
  });
});

describe("sapai default provider (V2)", () => {
  it("should create language models with specificationVersion v2", () => {
    const model = sapai("gpt-4o");
    expect(model.specificationVersion).toBe("v2");
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create embedding models with specificationVersion v2", () => {
    const model = sapai.textEmbeddingModel("text-embedding-ada-002");
    expect(model.specificationVersion).toBe("v2");
    expect(model.modelId).toBe("text-embedding-ada-002");
    expect(model.provider).toBe("sap-ai.embedding");
  });
});
