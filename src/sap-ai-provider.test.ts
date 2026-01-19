/**
 * Unit tests for SAP AI Provider
 *
 * Tests provider creation, configuration, model instantiation,
 * and settings merge behavior.
 */

import { NoSuchModelError } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSAPAIProvider, sapai } from "./sap-ai-provider";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSAPAIProvider", () => {
  it("should create a provider synchronously", () => {
    const provider = createSAPAIProvider();
    expect(provider).toBeDefined();
    expect(typeof provider).toBe("function");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(provider.chat).toBeDefined();
    expect(typeof provider.chat).toBe("function");
  });

  it("should create a model when called", () => {
    const provider = createSAPAIProvider();
    const model = provider("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create model via chat method with optional settings", () => {
    const provider = createSAPAIProvider();
    const model = provider.chat("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");

    // Also works with settings
    const modelWithSettings = provider.chat("gpt-4o", {
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

  it("should throw when called with new keyword", () => {
    const provider = createSAPAIProvider();
    expect(() => {
      // @ts-expect-error - Testing runtime behavior
      new provider("gpt-4o");
    }).toThrow("cannot be called with the new keyword");
  });

  describe("embedding models", () => {
    it("should expose embedding method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.embedding).toBeDefined();
      expect(typeof provider.embedding).toBe("function");
    });

    it("should create an embedding model", () => {
      const provider = createSAPAIProvider();
      const model = provider.embedding("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
    });

    it("should create an embedding model with settings", () => {
      const provider = createSAPAIProvider();
      const model = provider.embedding("text-embedding-3-small", {
        type: "document",
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
    });

    it("should expose textEmbeddingModel method (deprecated)", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-deprecated
      expect(provider.textEmbeddingModel).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      expect(typeof provider.textEmbeddingModel).toBe("function");
    });
  });

  describe("ProviderV3 compliance", () => {
    it("should have specificationVersion 'v3'", () => {
      const provider = createSAPAIProvider();
      expect(provider.specificationVersion).toBe("v3");
    });

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
    });

    it("should expose embeddingModel method", () => {
      const provider = createSAPAIProvider();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.embeddingModel).toBeDefined();
      expect(typeof provider.embeddingModel).toBe("function");
    });

    it("should create an embedding model via embeddingModel method", () => {
      const provider = createSAPAIProvider();
      const model = provider.embeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
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
});

describe("custom provider name", () => {
  describe("language models use {name}.chat pattern", () => {
    it("should use default provider name 'sap-ai.chat' when name is not specified", () => {
      const provider = createSAPAIProvider();
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
    });

    it("should use custom provider name with .chat suffix when specified", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-core" });
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai-core.chat");
    });

    it("should apply custom name to chat models", () => {
      const provider = createSAPAIProvider({ name: "my-custom-provider" });
      const model = provider.chat("gpt-4o");
      expect(model.provider).toBe("my-custom-provider.chat");
    });

    it("should apply custom name to languageModel method", () => {
      const provider = createSAPAIProvider({ name: "custom-sap" });
      const model = provider.languageModel("gpt-4o");
      expect(model.provider).toBe("custom-sap.chat");
    });
  });

  describe("embedding models use {name}.embedding pattern", () => {
    it("should apply custom name to embedding models", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-embeddings" });
      const model = provider.embedding("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai-embeddings.embedding");
    });

    it("should apply custom name to embeddingModel method", () => {
      const provider = createSAPAIProvider({ name: "custom-embeddings" });
      const model = provider.embeddingModel("text-embedding-3-small");
      expect(model.provider).toBe("custom-embeddings.embedding");
    });
  });

  describe("works with other provider settings", () => {
    it("should work with other provider settings", () => {
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
  it("should expose provider and chat entrypoints", () => {
    expect(sapai).toBeDefined();
    expect(typeof sapai).toBe("function");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sapai.chat).toBeDefined();
    expect(typeof sapai.chat).toBe("function");
  });

  it("should create a model", () => {
    const model = sapai("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  describe("embedding models", () => {
    it("should expose embedding entrypoints", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.embedding).toBeDefined();
      expect(typeof sapai.embedding).toBe("function");
      // eslint-disable-next-line @typescript-eslint/unbound-method, @typescript-eslint/no-deprecated
      expect(sapai.textEmbeddingModel).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      expect(typeof sapai.textEmbeddingModel).toBe("function");
    });

    it("should create an embedding model via embedding method", () => {
      const model = sapai.embedding("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v3");
    });

    it("should create an embedding model via textEmbeddingModel method (deprecated)", () => {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const model = sapai.textEmbeddingModel("text-embedding-3-small");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.provider).toBe("sap-ai.embedding");
    });
  });

  describe("ProviderV3 compliance", () => {
    it("should have specificationVersion 'v3'", () => {
      expect(sapai.specificationVersion).toBe("v3");
    });

    it("should expose languageModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.languageModel).toBeDefined();
      expect(typeof sapai.languageModel).toBe("function");
    });

    it("should expose embeddingModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.embeddingModel).toBeDefined();
      expect(typeof sapai.embeddingModel).toBe("function");
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
});
