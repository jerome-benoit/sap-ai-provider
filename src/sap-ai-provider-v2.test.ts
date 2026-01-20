/**
 * Unit tests for SAP AI Provider V2.
 *
 * Tests verify provider factory creates V2-compliant models.
 * @see SAPAIProviderV2
 */

import { NoSuchModelError } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSAPAIProvider, sapai } from "./sap-ai-provider-v2.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSAPAIProvider", () => {
  it("should create a provider synchronously", () => {
    const provider = createSAPAIProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("function");

    // V2 provider should have languageModel and textEmbeddingModel methods
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.languageModel).toBeDefined();
    expect(typeof provider.languageModel).toBe("function");
  });

  it("should create a model when called", () => {
    const provider = createSAPAIProvider();
    const model = provider("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
    expect(model.specificationVersion).toBe("v2");
  });

  it("should create model with optional settings", () => {
    const provider = createSAPAIProvider();
    const model = provider("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");

    const modelWithSettings = provider("gpt-4o", {
      modelParams: { temperature: 0.8 },
    });
    expect(modelWithSettings).toBeDefined();
  });

  it("should accept resource group configuration", () => {
    const provider = createSAPAIProvider({
      resourceGroup: "production",
    });

    expect(provider("gpt-4o")).toBeDefined();
  });

  it("should accept default settings", () => {
    const provider = createSAPAIProvider({
      defaultSettings: {
        modelParams: {
          temperature: 0.5,
        },
      },
    });

    expect(provider("gpt-4o")).toBeDefined();
  });

  describe("defaultSettings.modelParams validation", () => {
    it("should throw on invalid modelParams", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: { modelParams: { temperature: 5 } },
        }),
      ).toThrow();
    });

    it("should accept valid modelParams", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: { modelParams: { temperature: 0.7 } },
        }),
      ).not.toThrow();
    });
  });

  it("should accept deploymentId configuration", () => {
    const provider = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
    });

    expect(provider("gpt-4o")).toBeDefined();
  });

  it("should accept custom destination configuration", () => {
    const provider = createSAPAIProvider({
      destination: {
        url: "https://custom-ai-core.example.com",
      },
    });

    expect(provider("gpt-4o")).toBeDefined();
  });

  it("should accept both deploymentId and destination together", () => {
    const provider = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
      destination: {
        url: "https://custom-ai-core.example.com",
      },
    });

    expect(provider("gpt-4o")).toBeDefined();
  });

  it("should accept both deploymentId and resourceGroup", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const provider = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
      resourceGroup: "production",
    });

    expect(provider("gpt-4o")).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "createSAPAIProvider: both 'deploymentId' and 'resourceGroup' were provided; using 'deploymentId' and ignoring 'resourceGroup'.",
    );
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

  it("should merge per-call settings with defaults", () => {
    const provider = createSAPAIProvider({
      defaultSettings: {
        modelParams: {
          temperature: 0.5,
        },
      },
    });

    expect(
      provider("gpt-4o", {
        modelParams: {
          maxTokens: 1000,
        },
      }),
    ).toBeDefined();
  });

  it("should deep merge modelParams from defaults and call-time settings", () => {
    const provider = createSAPAIProvider({
      defaultSettings: {
        modelParams: {
          frequencyPenalty: 0.2,
          presencePenalty: 0.1,
          temperature: 0.5,
        },
      },
    });

    const model = provider("gpt-4o", {
      modelParams: {
        frequencyPenalty: 0.5,
        maxTokens: 2000,
      },
    });

    expect(model).toBeDefined();
    // The internal V3 model should have merged modelParams:
    // - temperature: 0.5 (from default, preserved)
    // - maxTokens: 2000 (from call-time, added)
    // - frequencyPenalty: 0.5 (from call-time, overrides default)
    // - presencePenalty: 0.1 (from default, preserved)
  });

  it("should throw when called with new keyword", () => {
    const provider = createSAPAIProvider();
    expect(() => {
      // @ts-expect-error - Testing runtime behavior
      new provider("gpt-4o");
    }).toThrow("cannot be called with the new keyword");
  });

  describe("ProviderV2 compliance", () => {
    it("should expose languageModel method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.languageModel).toBeDefined();
      expect(typeof provider.languageModel).toBe("function");
    });

    it("should create a model via languageModel method", () => {
      const provider = createSAPAIProvider();
      const model = provider.languageModel("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create a model via languageModel with settings", () => {
      const provider = createSAPAIProvider();
      const model = provider.languageModel("gpt-4o", {
        modelParams: { maxTokens: 2000, temperature: 0.8 },
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should expose textEmbeddingModel method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.textEmbeddingModel).toBeDefined();
      expect(typeof provider.textEmbeddingModel).toBe("function");
    });

    it("should create an embedding model via textEmbeddingModel method", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create an embedding model with settings", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-3-small", {
        maxEmbeddingsPerCall: 500,
        type: "document",
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.maxEmbeddingsPerCall).toBe(500);
    });

    it("should expose imageModel method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.imageModel).toBeDefined();
      expect(typeof provider.imageModel).toBe("function");
    });

    it("should throw NoSuchModelError when calling imageModel", () => {
      const provider = createSAPAIProvider();

      expect(() => provider.imageModel("dall-e-3")).toThrow(NoSuchModelError);
    });

    it("should include modelId and modelType in NoSuchModelError", () => {
      const provider = createSAPAIProvider();

      try {
        provider.imageModel("dall-e-3");
        expect.fail("Should have thrown NoSuchModelError");
      } catch (error) {
        expect(error).toBeInstanceOf(NoSuchModelError);
        const noSuchModelError = error as NoSuchModelError;
        expect(noSuchModelError.modelId).toBe("dall-e-3");
        expect(noSuchModelError.modelType).toBe("imageModel");
      }
    });

    it("should include descriptive message in NoSuchModelError", () => {
      const provider = createSAPAIProvider();

      expect(() => provider.imageModel("stable-diffusion")).toThrow(
        "SAP AI Core Orchestration Service does not support image generation",
      );
    });

    it("should throw for any model ID", () => {
      const provider = createSAPAIProvider();

      const modelIds = ["dall-e-3", "stable-diffusion", "midjourney", "any-model"];

      for (const modelId of modelIds) {
        expect(() => provider.imageModel(modelId)).toThrow(NoSuchModelError);
      }
    });
  });

  describe("Embedding models", () => {
    it("should create embedding model with default maxEmbeddingsPerCall", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model.maxEmbeddingsPerCall).toBe(2048); // V3 default
    });

    it("should create embedding model with custom maxEmbeddingsPerCall", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-3-large", {
        maxEmbeddingsPerCall: 100,
      });
      expect(model.maxEmbeddingsPerCall).toBe(100);
    });

    it("should create embedding model with type setting", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-3-small", {
        type: "query",
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
    });

    it("should create embedding model with modelParams", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-3-large", {
        modelParams: { dimensions: 256 },
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-large");
    });

    it("should pass supportsParallelCalls from V3 model", () => {
      const provider = createSAPAIProvider();
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model.supportsParallelCalls).toBe(true);
    });
  });
});

describe("provider name", () => {
  describe("language models use {name}.chat provider identifier", () => {
    it("should use default provider identifier 'sap-ai.chat' when name is not specified", () => {
      const provider = createSAPAIProvider();
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
    });

    it("should use provider identifier with .chat suffix when name is specified", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-core" });
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai-core.chat");
    });

    it("should apply provider name to languageModel method", () => {
      const provider = createSAPAIProvider({ name: "custom-sap" });
      const model = provider.languageModel("gpt-4o");
      expect(model.provider).toBe("custom-sap.chat");
    });
  });

  describe("embedding models use {name}.embedding provider identifier", () => {
    it("should apply provider name to textEmbeddingModel method", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-embeddings" });
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai-embeddings.embedding");
    });
  });

  describe("provider name works with other settings", () => {
    it("should work with defaultSettings and resourceGroup", () => {
      const provider = createSAPAIProvider({
        defaultSettings: {
          modelParams: { temperature: 0.7 },
        },
        name: "sap-ai-prod",
        resourceGroup: "production",
      });
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai-prod.chat");
    });

    it("should work with deploymentId", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      const provider = createSAPAIProvider({
        deploymentId: "d65d81e7c077e583",
        name: "sap-ai-deployment",
        resourceGroup: "default",
      });
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai-deployment.chat");

      warnSpy.mockRestore();
    });
  });
});

describe("sapai default provider", () => {
  it("should expose provider entrypoint", () => {
    expect(sapai).toBeDefined();
    expect(typeof sapai).toBe("function");
  });

  it("should create a model", () => {
    const model = sapai("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
    expect(model.specificationVersion).toBe("v2");
  });

  it("should create a model with settings", () => {
    const model = sapai("gpt-4o", { modelParams: { temperature: 0.5 } });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
  });

  describe("ProviderV2 compliance", () => {
    it("should expose languageModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.languageModel).toBeDefined();
      expect(typeof sapai.languageModel).toBe("function");
    });

    it("should create a model via languageModel method", () => {
      const model = sapai.languageModel("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should expose textEmbeddingModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.textEmbeddingModel).toBeDefined();
      expect(typeof sapai.textEmbeddingModel).toBe("function");
    });

    it("should create an embedding model via textEmbeddingModel method", () => {
      const model = sapai.textEmbeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create an embedding model with settings", () => {
      const model = sapai.textEmbeddingModel("text-embedding-3-small", {
        type: "document",
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
    });

    it("should expose imageModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.imageModel).toBeDefined();
      expect(typeof sapai.imageModel).toBe("function");
    });

    it("should throw NoSuchModelError when calling imageModel", () => {
      expect(() => sapai.imageModel("dall-e-3")).toThrow(NoSuchModelError);
    });

    it("should include modelId in error message", () => {
      expect(() => sapai.imageModel("dall-e-3")).toThrow("Model 'dall-e-3' is not available");
    });
  });

  describe("Embedding models via default provider", () => {
    it("should create embedding model via textEmbeddingModel", () => {
      const model = sapai.textEmbeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should have correct embedding model properties", () => {
      const model = sapai.textEmbeddingModel("text-embedding-3-small");
      expect(model.maxEmbeddingsPerCall).toBe(2048);
      expect(model.supportsParallelCalls).toBe(true);
    });
  });
});
