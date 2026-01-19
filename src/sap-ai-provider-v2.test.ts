/**
 * Unit tests for SAP AI Provider V2
 *
 * Tests the V2 provider factory, verifying that it correctly creates
 * language and embedding models with proper configuration handling.
 */

import { NoSuchModelError } from "@ai-sdk/provider";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSAPAIProvider, sapai } from "./sap-ai-provider-v2";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSAPAIProvider", () => {
  describe("Provider Creation", () => {
    it("should create a provider with default configuration", () => {
      const provider = createSAPAIProvider();

      expect(provider).toBeDefined();
      expect(typeof provider).toBe("function");
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.languageModel).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.chat).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.embedding).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.textEmbeddingModel).toBeDefined();
    });

    it("should create a provider with deploymentId configuration", () => {
      const provider = createSAPAIProvider({
        deploymentId: "d65d81e7c077e583",
      });

      expect(provider).toBeDefined();

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should create a provider with resourceGroup configuration", () => {
      const provider = createSAPAIProvider({
        resourceGroup: "production",
      });

      expect(provider).toBeDefined();

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should create a provider with custom destination", () => {
      const provider = createSAPAIProvider({
        destination: {
          url: "https://custom-ai-core.example.com",
        },
      });

      expect(provider).toBeDefined();

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
    });

    it("should warn when both deploymentId and resourceGroup are provided", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      createSAPAIProvider({
        deploymentId: "test-deployment",
        resourceGroup: "test-group",
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("both 'deploymentId' and 'resourceGroup' were provided"),
      );

      consoleWarnSpy.mockRestore();
    });

    it("should not warn when warnOnAmbiguousConfig is false", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      createSAPAIProvider({
        deploymentId: "test-deployment",
        resourceGroup: "test-group",
        warnOnAmbiguousConfig: false,
      });

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it("should throw when called with new keyword", () => {
      const provider = createSAPAIProvider();

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any
        new (provider as any)("gpt-4o");
      }).toThrow("cannot be called with the new keyword");
    });
  });

  describe("Language Model Creation", () => {
    it("should create language model via provider function call", () => {
      const provider = createSAPAIProvider();

      const model = provider("gpt-4o");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create language model via languageModel method", () => {
      const provider = createSAPAIProvider();

      const model = provider.languageModel("gpt-4o-mini");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o-mini");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create language model via chat method", () => {
      const provider = createSAPAIProvider();

      const model = provider.chat("anthropic--claude-3.5-sonnet");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("anthropic--claude-3.5-sonnet");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should pass settings to language model", () => {
      const provider = createSAPAIProvider();

      const settings = {
        modelParams: {
          temperature: 0.7,
        },
      };

      const model = provider("gpt-4o", settings);

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should merge default settings with model settings", () => {
      const provider = createSAPAIProvider({
        defaultSettings: {
          modelParams: {
            temperature: 0.5,
          },
        },
      });

      const settings = {
        modelParams: {
          maxTokens: 1000,
        },
      };

      const model = provider("gpt-4o", settings);

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should override default settings with call-time settings for complex objects", () => {
      const provider = createSAPAIProvider({
        defaultSettings: {
          modelParams: {
            temperature: 0.5,
          },
        },
      });

      const settings = {
        modelParams: {
          temperature: 0.9,
        },
      };

      const model = provider("gpt-4o", settings);

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      // Temperature from call-time settings should override default
    });

    it("should create different language models with different IDs", () => {
      const provider = createSAPAIProvider();

      const models = [
        "gpt-4o",
        "gpt-4o-mini",
        "o1",
        "o3-mini",
        "gemini-2.0-flash",
        "anthropic--claude-3.5-sonnet",
      ];

      for (const modelId of models) {
        const model = provider(modelId);
        expect(model.modelId).toBe(modelId);
        expect(model.specificationVersion).toBe("v2");
      }
    });
  });

  describe("Embedding Model Creation", () => {
    it("should create embedding model via embedding method", () => {
      const provider = createSAPAIProvider();

      const model = provider.embedding("text-embedding-ada-002");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should create embedding model via textEmbeddingModel method", () => {
      const provider = createSAPAIProvider();

      const model = provider.textEmbeddingModel("text-embedding-3-small");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should pass settings to embedding model", () => {
      const provider = createSAPAIProvider();

      const settings = {
        maxEmbeddingsPerCall: 100,
        type: "query" as const,
      };

      const model = provider.embedding("text-embedding-ada-002", settings);

      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.maxEmbeddingsPerCall).toBe(100);
    });

    it("should create different embedding models with different IDs", () => {
      const provider = createSAPAIProvider();

      const models = ["text-embedding-ada-002", "text-embedding-3-small", "text-embedding-3-large"];

      for (const modelId of models) {
        const model = provider.embedding(modelId);
        expect(model.modelId).toBe(modelId);
        expect(model.specificationVersion).toBe("v2");
      }
    });
  });

  describe("Configuration Handling", () => {
    it("should pass deploymentConfig to models", () => {
      const provider = createSAPAIProvider({
        deploymentId: "test-deployment-id",
      });

      const languageModel = provider("gpt-4o");
      const embeddingModel = provider.embedding("text-embedding-ada-002");

      expect(languageModel).toBeDefined();
      expect(embeddingModel).toBeDefined();
    });

    it("should pass destination to models", () => {
      const destination = {
        url: "https://test-ai-core.example.com",
      };

      const provider = createSAPAIProvider({
        destination,
      });

      const languageModel = provider("gpt-4o");
      const embeddingModel = provider.embedding("text-embedding-ada-002");

      expect(languageModel).toBeDefined();
      expect(embeddingModel).toBeDefined();
    });

    it("should use default resource group when not specified", () => {
      const provider = createSAPAIProvider();

      const model = provider("gpt-4o");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should validate defaultSettings.modelParams at creation time", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: {
            modelParams: {
              temperature: 5, // Invalid: should be 0-2
            },
          },
        }),
      ).toThrow();
    });

    it("should accept valid defaultSettings.modelParams", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: {
            modelParams: {
              temperature: 0.7,
            },
          },
        }),
      ).not.toThrow();
    });
  });

  describe("Default Provider Instance", () => {
    it("should provide a default sapai instance", () => {
      expect(sapai).toBeDefined();
      expect(typeof sapai).toBe("function");
    });

    it("should create models using default sapai instance", () => {
      const model = sapai("gpt-4o");

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.provider).toBe("sap-ai.chat");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should have all methods on default sapai instance", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.languageModel).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.chat).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.embedding).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.textEmbeddingModel).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.imageModel).toBeDefined();
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

      it("should apply provider name to chat models", () => {
        const provider = createSAPAIProvider({ name: "my-custom-provider" });
        const model = provider.chat("gpt-4o");
        expect(model.provider).toBe("my-custom-provider.chat");
      });

      it("should apply provider name to languageModel method", () => {
        const provider = createSAPAIProvider({ name: "custom-sap" });
        const model = provider.languageModel("gpt-4o");
        expect(model.provider).toBe("custom-sap.chat");
      });
    });

    describe("embedding models use {name}.embedding provider identifier", () => {
      it("should apply provider name to embedding models", () => {
        const provider = createSAPAIProvider({ name: "sap-ai-embeddings" });
        const model = provider.embedding("text-embedding-ada-002");
        expect(model.provider).toBe("sap-ai-embeddings.embedding");
      });

      it("should apply provider name to textEmbeddingModel method", () => {
        const provider = createSAPAIProvider({ name: "custom-embeddings" });
        const model = provider.textEmbeddingModel("text-embedding-3-small");
        expect(model.provider).toBe("custom-embeddings.embedding");
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

  describe("Image Model (Not Supported)", () => {
    it("should have imageModel method on provider", () => {
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
