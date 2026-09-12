/** V2 provider public contracts; factories share utilities, not implementations. */

import { NoSuchModelError } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider-v2.js";

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

  it("should throw the public provider NoSuchModelError for image models", () => {
    const provider = createSAPAIProvider();

    expect(() => provider.imageModel("dall-e-3")).toThrow(NoSuchModelError);
  });
});
