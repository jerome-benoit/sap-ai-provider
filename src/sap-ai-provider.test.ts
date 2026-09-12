/** Unit tests for SAP AI Provider V3. */

import { NoSuchModelError } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSAPAIProvider } from "./sap-ai-provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSAPAIProvider", () => {
  it("should create a functional provider instance", () => {
    const provider = createSAPAIProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("function");

    const model = provider("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create models via chat method", () => {
    const provider = createSAPAIProvider();
    const model = provider.chat("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");

    const modelWithSettings = provider.chat("gpt-4o", {
      modelParams: { temperature: 0.8 },
    });
    expect(modelWithSettings).toBeDefined();
  });

  describe("defaultSettings.modelParams validation", () => {
    it("should throw on invalid modelParams", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: { modelParams: { temperature: 5 } },
        }),
      ).toThrow();
    });
  });

  it("should accept both deploymentId and resourceGroup", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
      resourceGroup: "production",
    });

    expect(provider("gpt-4o")).toBeDefined();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("should allow disabling ambiguous config warnings", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
      resourceGroup: "production",
      warnOnAmbiguousConfig: false,
    });

    expect(provider("gpt-4o")).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("should throw when called with new keyword", () => {
    const provider = createSAPAIProvider();
    expect(() => {
      // @ts-expect-error - Testing runtime behavior
      new provider("gpt-4o");
    }).toThrow(Error);
  });

  describe("embedding models", () => {
    it("should create embedding models via embedding method", () => {
      const provider = createSAPAIProvider();
      const model = provider.embedding("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
    });

    it("should support deprecated textEmbeddingModel method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
    });
  });

  describe("provider v3 compliance", () => {
    it("should have specificationVersion 'v3'", () => {
      const provider = createSAPAIProvider();
      expect(provider.specificationVersion).toBe("v3");
    });

    it("should create language models via languageModel method", () => {
      const provider = createSAPAIProvider();
      const model = provider.languageModel("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
    });

    it("should create embedding models via embeddingModel method", () => {
      const provider = createSAPAIProvider();
      const model = provider.embeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
    });

    it("rejects image generation with the model ID and type", () => {
      const provider = createSAPAIProvider();

      expect(() => provider.imageModel("dall-e-3")).toThrow(NoSuchModelError);
      try {
        provider.imageModel("dall-e-3");
      } catch (error) {
        expect(error).toMatchObject({ modelId: "dall-e-3", modelType: "imageModel" });
      }
    });
  });

  describe("provider name", () => {
    describe("language models use {name}.chat provider identifier", () => {
      it("should use default provider identifier", () => {
        const provider = createSAPAIProvider();
        const model = provider("gpt-4o");
        expect(model.provider).toBe("sap-ai.chat");
      });

      it("should use custom provider name", () => {
        const provider = createSAPAIProvider({ name: "sap-ai-core" });

        expect(provider("gpt-4o").provider).toBe("sap-ai-core.chat");
        expect(provider.chat("gpt-4o").provider).toBe("sap-ai-core.chat");
        expect(provider.languageModel("gpt-4o").provider).toBe("sap-ai-core.chat");
      });
    });

    describe("embedding models use {name}.embedding provider identifier", () => {
      it("should use custom provider name for embeddings", () => {
        const provider = createSAPAIProvider({ name: "sap-ai-embeddings" });

        expect(provider.embedding("text-embedding-ada-002").provider).toBe(
          "sap-ai-embeddings.embedding",
        );
        expect(provider.embeddingModel("text-embedding-3-small").provider).toBe(
          "sap-ai-embeddings.embedding",
        );
      });
    });
  });
});
