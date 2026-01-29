/** Unit tests for SAP AI Provider V3. */

import { NoSuchModelError } from "@ai-sdk/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock setGlobalLogLevel from @sap-cloud-sdk/util
vi.mock("@sap-cloud-sdk/util", async () => {
  const actual = await vi.importActual<typeof import("@sap-cloud-sdk/util")>("@sap-cloud-sdk/util");
  return {
    ...actual,
    setGlobalLogLevel: vi.fn(),
  };
});

import { setGlobalLogLevel } from "@sap-cloud-sdk/util";

import { createSAPAIProvider, sapai } from "./sap-ai-provider";

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

  it("should accept configuration options", () => {
    const providerWithResourceGroup = createSAPAIProvider({
      resourceGroup: "production",
    });
    expect(providerWithResourceGroup("gpt-4o")).toBeDefined();

    const providerWithDefaults = createSAPAIProvider({
      defaultSettings: {
        modelParams: {
          temperature: 0.5,
        },
      },
    });
    expect(providerWithDefaults("gpt-4o")).toBeDefined();
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

  it("should accept deploymentId and destination configurations", () => {
    const providerWithDeploymentId = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
    });
    expect(providerWithDeploymentId("gpt-4o")).toBeDefined();

    const providerWithDestination = createSAPAIProvider({
      destination: {
        url: "https://custom-ai-core.example.com",
      },
    });
    expect(providerWithDestination("gpt-4o")).toBeDefined();

    const providerWithBoth = createSAPAIProvider({
      deploymentId: "d65d81e7c077e583",
      destination: {
        url: "https://custom-ai-core.example.com",
      },
    });
    expect(providerWithBoth("gpt-4o")).toBeDefined();
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

  describe("log level configuration", () => {
    beforeEach(() => {
      vi.mocked(setGlobalLogLevel).mockClear();
    });

    afterEach(() => {
      delete process.env.SAP_CLOUD_SDK_LOG_LEVEL;
    });

    it("should set SAP Cloud SDK log level to warn by default", () => {
      createSAPAIProvider();

      expect(setGlobalLogLevel).toHaveBeenCalledWith("warn");
    });

    it("should allow custom log level configuration", () => {
      createSAPAIProvider({ logLevel: "debug" });

      expect(setGlobalLogLevel).toHaveBeenCalledWith("debug");
    });

    it("should respect SAP_CLOUD_SDK_LOG_LEVEL environment variable", () => {
      process.env.SAP_CLOUD_SDK_LOG_LEVEL = "info";

      createSAPAIProvider({ logLevel: "debug" });

      expect(setGlobalLogLevel).not.toHaveBeenCalled();
    });
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
  });

  it("should throw when called with new keyword", () => {
    const provider = createSAPAIProvider();
    expect(() => {
      // @ts-expect-error - Testing runtime behavior
      new provider("gpt-4o");
    }).toThrow("cannot be called with the new keyword");
  });

  describe("embedding models", () => {
    it("should create embedding models via embedding method", () => {
      const provider = createSAPAIProvider();
      const model = provider.embedding("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
    });

    it("should create embedding models with settings", () => {
      const provider = createSAPAIProvider();
      const model = provider.embedding("text-embedding-3-small", {
        type: "document",
      });
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
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

    it("should throw NoSuchModelError with detailed information", () => {
      const provider = createSAPAIProvider();

      const testCases = ["dall-e-3", "stable-diffusion", "midjourney"];

      for (const modelId of testCases) {
        try {
          provider.imageModel(modelId);
          expect.fail("Should have thrown NoSuchModelError");
        } catch (error) {
          expect(error).toBeInstanceOf(NoSuchModelError);
          const noSuchModelError = error as NoSuchModelError;
          expect(noSuchModelError.modelId).toBe(modelId);
          expect(noSuchModelError.modelType).toBe("imageModel");
          expect(noSuchModelError.message).toContain(
            "SAP AI Core does not support image generation",
          );
        }
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

  describe("API selection", () => {
    describe("provider-level selection", () => {
      it("should default to orchestration API when no api option is specified", () => {
        const provider = createSAPAIProvider();
        const model = provider("gpt-4o");
        expect(model).toBeDefined();
      });

      it("should accept orchestration api at provider level", () => {
        const provider = createSAPAIProvider({ api: "orchestration" });
        const model = provider("gpt-4o");
        expect(model).toBeDefined();
      });

      it("should accept foundation-models api at provider level", () => {
        const provider = createSAPAIProvider({ api: "foundation-models" });
        const model = provider("gpt-4o");
        expect(model).toBeDefined();
      });
    });

    describe("model-level selection (override)", () => {
      it("should allow model-level api to override provider-level api", () => {
        const provider = createSAPAIProvider({ api: "orchestration" });
        const model = provider("gpt-4o", { api: "foundation-models" });
        expect(model).toBeDefined();
      });

      it("should accept api option in chat method", () => {
        const provider = createSAPAIProvider();
        const model = provider.chat("gpt-4o", { api: "foundation-models" });
        expect(model).toBeDefined();
      });

      it("should accept api option in languageModel method", () => {
        const provider = createSAPAIProvider();
        const model = provider.languageModel("gpt-4o", { api: "orchestration" });
        expect(model).toBeDefined();
      });

      it("should accept api option in embedding method", () => {
        const provider = createSAPAIProvider();
        const model = provider.embedding("text-embedding-ada-002", { api: "foundation-models" });
        expect(model).toBeDefined();
      });

      it("should accept api option in embeddingModel method", () => {
        const provider = createSAPAIProvider();
        const model = provider.embeddingModel("text-embedding-3-small", { api: "orchestration" });
        expect(model).toBeDefined();
      });
    });

    describe("mixed API usage within same provider", () => {
      it("should allow different models to use different APIs", () => {
        const provider = createSAPAIProvider();

        const orchestrationModel = provider("gpt-4o", { api: "orchestration" });
        const fmModel = provider("gpt-4o-mini", { api: "foundation-models" });

        expect(orchestrationModel).toBeDefined();
        expect(fmModel).toBeDefined();
        expect(orchestrationModel.modelId).toBe("gpt-4o");
        expect(fmModel.modelId).toBe("gpt-4o-mini");
      });

      it("should allow mixing language and embedding models with different APIs", () => {
        const provider = createSAPAIProvider({ api: "orchestration" });

        const chatModel = provider.chat("gpt-4o");
        const embeddingModel = provider.embedding("text-embedding-ada-002", {
          api: "foundation-models",
        });

        expect(chatModel).toBeDefined();
        expect(embeddingModel).toBeDefined();
      });
    });

    describe("API resolution precedence", () => {
      it("should use provider-level API as fallback when model-level is not set", () => {
        const provider = createSAPAIProvider({ api: "foundation-models" });
        const model = provider("gpt-4o");
        expect(model).toBeDefined();
      });

      it("should prefer model-level API over provider-level API", () => {
        const provider = createSAPAIProvider({ api: "orchestration" });
        const model = provider("gpt-4o", { api: "foundation-models" });
        expect(model).toBeDefined();
      });

      it("should use default orchestration when neither provider nor model specifies api", () => {
        const provider = createSAPAIProvider();
        const model = provider("gpt-4o");
        expect(model).toBeDefined();
      });
    });
  });
});

describe("sapai", () => {
  it("should expose provider entrypoint", () => {
    expect(sapai).toBeDefined();
    expect(typeof sapai).toBe("function");
  });

  it("should expose chat method", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sapai.chat).toBeDefined();
    expect(typeof sapai.chat).toBe("function");
  });

  it("should create language models via direct call", () => {
    const model = sapai("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create a model via chat method", () => {
    const model = sapai.chat("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
    expect(model.specificationVersion).toBe("v3");
  });

  it("should create a model with settings", () => {
    const model = sapai("gpt-4o", { modelParams: { temperature: 0.5 } });
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
  });

  describe("embedding models", () => {
    it("should expose embedding entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.embedding).toBeDefined();
      expect(typeof sapai.embedding).toBe("function");
    });

    it("should expose textEmbeddingModel entrypoint", () => {
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
      expect(model.specificationVersion).toBe("v3");
    });

    it("should have correct embedding model properties", () => {
      const model = sapai.embedding("text-embedding-3-small");
      expect(model.maxEmbeddingsPerCall).toBe(2048);
      expect(model.supportsParallelCalls).toBe(true);
    });
  });

  describe("provider v3 compliance", () => {
    it("should have specificationVersion 'v3'", () => {
      expect(sapai.specificationVersion).toBe("v3");
    });

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
      expect(model.specificationVersion).toBe("v3");
    });

    it("should expose embeddingModel entrypoint", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(sapai.embeddingModel).toBeDefined();
      expect(typeof sapai.embeddingModel).toBe("function");
    });

    it("should create an embedding model via embeddingModel method", () => {
      const model = sapai.embeddingModel("text-embedding-ada-002");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai.embedding");
      expect(model.specificationVersion).toBe("v3");
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
