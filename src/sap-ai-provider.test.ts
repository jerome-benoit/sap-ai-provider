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
            "SAP AI Core Orchestration Service does not support image generation",
          );
        }
      }
    });
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

describe("sapai default provider", () => {
  it("should be a pre-configured provider instance", () => {
    expect(sapai).toBeDefined();
    expect(typeof sapai).toBe("function");
    expect(sapai.specificationVersion).toBe("v3");
  });

  it("should create language models via direct call", () => {
    const model = sapai("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create language models via chat method", () => {
    const model = sapai.chat("gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
    expect(model.provider).toBe("sap-ai.chat");
  });

  it("should create embedding models via embedding method", () => {
    const model = sapai.embedding("text-embedding-ada-002");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("text-embedding-ada-002");
    expect(model.provider).toBe("sap-ai.embedding");
  });
});
