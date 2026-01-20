/**
 * Unit tests for SAP AI Provider V2.
 *
 * Tests verify V2 facade correctly delegates to V3 provider.
 * V2 is a thin facade - most functionality is tested in V3 tests.
 *
 * Test Strategy:
 * - V2-specific properties (specificationVersion)
 * - Delegation to V3 (languageModel, textEmbeddingModel)
 * - Configuration handling (critical tests only)
 * - imageModel error handling (required behavior)
 * @see SAPAIProviderV2
 */

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

import { createSAPAIProvider, sapai } from "./sap-ai-provider-v2.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSAPAIProvider", () => {
  describe("V2-specific properties", () => {
    it("should create models with specificationVersion v2", () => {
      const provider = createSAPAIProvider();

      const languageModel = provider.languageModel("gpt-4o");
      expect(languageModel.specificationVersion).toBe("v2");
      expect(languageModel.modelId).toBe("gpt-4o");
      expect(languageModel.provider).toBe("sap-ai.chat");

      const embeddingModel = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(embeddingModel.specificationVersion).toBe("v2");
      expect(embeddingModel.modelId).toBe("text-embedding-ada-002");
      expect(embeddingModel.provider).toBe("sap-ai.embedding");
    });
  });

  describe("Delegation to V3", () => {
    it("should delegate languageModel to V3", () => {
      const provider = createSAPAIProvider({
        defaultSettings: { modelParams: { temperature: 0.7 } },
        resourceGroup: "production",
      });

      const model = provider.languageModel("gpt-4o", {
        modelParams: { maxTokens: 2000 },
      });

      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
      expect(model.specificationVersion).toBe("v2");
    });

    it("should delegate textEmbeddingModel to V3", () => {
      const provider = createSAPAIProvider({
        resourceGroup: "production",
      });

      const model = provider.textEmbeddingModel("text-embedding-3-small", {
        maxEmbeddingsPerCall: 500,
        type: "query",
      });

      expect(model).toBeDefined();
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.maxEmbeddingsPerCall).toBe(500);
      expect(model.specificationVersion).toBe("v2");
    });
  });

  describe("Configuration handling", () => {
    it("should accept resourceGroup configuration", () => {
      const provider = createSAPAIProvider({
        resourceGroup: "production",
      });

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
      expect(model.modelId).toBe("gpt-4o");
    });

    it("should accept deploymentId configuration", () => {
      const provider = createSAPAIProvider({
        deploymentId: "d65d81e7c077e583",
      });

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
    });

    it("should accept destination configuration", () => {
      const provider = createSAPAIProvider({
        destination: {
          url: "https://custom-ai-core.example.com",
        },
      });

      const model = provider("gpt-4o");
      expect(model).toBeDefined();
    });

    it("should validate defaultSettings.modelParams", () => {
      expect(() =>
        createSAPAIProvider({
          defaultSettings: { modelParams: { temperature: 5 } },
        }),
      ).toThrow();

      expect(() =>
        createSAPAIProvider({
          defaultSettings: { modelParams: { temperature: 0.7 } },
        }),
      ).not.toThrow();
    });

    it("should warn when both deploymentId and resourceGroup are provided", () => {
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
  });

  describe("Log level configuration", () => {
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

  describe("Custom provider name", () => {
    it("should use custom provider name for language models", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-core" });
      const model = provider("gpt-4o");
      expect(model.provider).toBe("sap-ai-core.chat");
    });

    it("should use custom provider name for embedding models", () => {
      const provider = createSAPAIProvider({ name: "sap-ai-embeddings" });
      const model = provider.textEmbeddingModel("text-embedding-ada-002");
      expect(model.provider).toBe("sap-ai-embeddings.embedding");
    });
  });

  describe("imageModel error handling", () => {
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
  });

  describe("Provider factory behavior", () => {
    it("should throw when called with new keyword", () => {
      const provider = createSAPAIProvider();
      expect(() => {
        // @ts-expect-error - Testing runtime behavior
        new provider("gpt-4o");
      }).toThrow("cannot be called with the new keyword");
    });

    it("should support direct call and chat method", () => {
      const provider = createSAPAIProvider();

      const model1 = provider("gpt-4o");
      expect(model1).toBeDefined();
      expect(model1.modelId).toBe("gpt-4o");

      const model2 = provider.chat("gpt-4o");
      expect(model2).toBeDefined();
      expect(model2.modelId).toBe("gpt-4o");
    });
  });
});

describe("sapai default provider", () => {
  it("should create language models with specificationVersion v2", () => {
    const model = sapai("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
    expect(model.specificationVersion).toBe("v2");
  });

  it("should create embedding models with specificationVersion v2", () => {
    const model = sapai.textEmbeddingModel("text-embedding-ada-002");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("text-embedding-ada-002");
    expect(model.provider).toBe("sap-ai.embedding");
    expect(model.specificationVersion).toBe("v2");
  });

  it("should throw NoSuchModelError when calling imageModel", () => {
    expect(() => sapai.imageModel("dall-e-3")).toThrow(NoSuchModelError);
  });

  it("should support all provider methods", () => {
    // Direct call
    const model1 = sapai("gpt-4o");
    expect(model1.modelId).toBe("gpt-4o");

    // chat method
    const model2 = sapai.chat("gpt-4o");
    expect(model2.modelId).toBe("gpt-4o");

    // languageModel method
    const model3 = sapai.languageModel("gpt-4o");
    expect(model3.modelId).toBe("gpt-4o");

    // textEmbeddingModel method
    const model4 = sapai.textEmbeddingModel("text-embedding-ada-002");
    expect(model4.modelId).toBe("text-embedding-ada-002");
  });
});
