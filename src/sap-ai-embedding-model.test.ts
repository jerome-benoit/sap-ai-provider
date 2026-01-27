/**
 * Tests SAP AI Embedding Model - creation, configuration, and doEmbed behavior.
 * @see SAPAIEmbeddingModel
 */
import type { EmbeddingModelV3CallOptions } from "@ai-sdk/provider";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";

// Mock types
interface ConstructorCall {
  config: { embeddings: { model: { name: string; params?: Record<string, unknown> } } };
  deploymentConfig: unknown;
  destination: unknown;
}
interface EmbedCall {
  request: { input: string[]; type?: string };
  requestConfig?: { signal?: AbortSignal };
}
interface EmbeddingResponse {
  getEmbeddings: () => { embedding: number[] | string; index: number; object: string }[];
  getTokenUsage: () => { prompt_tokens: number; total_tokens: number };
}

vi.mock("@sap-ai-sdk/orchestration", () => {
  class MockOrchestrationEmbeddingClient {
    static embedError: Error | undefined;
    static embedResponse: EmbeddingResponse | undefined;
    static lastConstructorCall: ConstructorCall | undefined;
    static lastEmbedCall: EmbedCall | undefined;

    embed = vi
      .fn()
      .mockImplementation(
        (request: { input: string[]; type?: string }, requestConfig?: { signal?: AbortSignal }) => {
          MockOrchestrationEmbeddingClient.lastEmbedCall = { request, requestConfig };
          const errorToThrow = MockOrchestrationEmbeddingClient.embedError;
          if (errorToThrow) {
            MockOrchestrationEmbeddingClient.embedError = undefined;
            throw errorToThrow;
          }
          if (MockOrchestrationEmbeddingClient.embedResponse) {
            const response = MockOrchestrationEmbeddingClient.embedResponse;
            MockOrchestrationEmbeddingClient.embedResponse = undefined;
            return Promise.resolve(response);
          }
          return Promise.resolve({
            getEmbeddings: () => [
              { embedding: [0.1, 0.2, 0.3], index: 0, object: "embedding" },
              { embedding: [0.4, 0.5, 0.6], index: 1, object: "embedding" },
            ],
            getTokenUsage: () => ({ prompt_tokens: 8, total_tokens: 8 }),
          });
        },
      );

    constructor(
      config: { embeddings: { model: { name: string; params?: Record<string, unknown> } } },
      deploymentConfig: unknown,
      destination: unknown,
    ) {
      MockOrchestrationEmbeddingClient.lastConstructorCall = {
        config,
        deploymentConfig,
        destination,
      };
    }
  }
  return {
    MockOrchestrationEmbeddingClient,
    OrchestrationEmbeddingClient: MockOrchestrationEmbeddingClient,
  };
});

interface MockClientType {
  MockOrchestrationEmbeddingClient: {
    embedError: Error | undefined;
    embedResponse: EmbeddingResponse | undefined;
    lastConstructorCall: ConstructorCall | undefined;
    lastEmbedCall: EmbedCall | undefined;
  };
}

/**
 * Helper to access the mocked SAP AI SDK OrchestrationEmbeddingClient for test manipulation.
 * @returns The mock client instance with spied constructor and embed method.
 */
async function getMockClient(): Promise<MockClientType> {
  const mod = await import("@sap-ai-sdk/orchestration");
  return mod as unknown as MockClientType;
}

describe("SAPAIEmbeddingModel", () => {
  const defaultConfig = { deploymentConfig: { resourceGroup: "default" }, provider: "sap-ai" };

  describe("model properties", () => {
    it("should expose correct interface properties", () => {
      const model = new SAPAIEmbeddingModel("text-embedding-3-small", {}, defaultConfig);
      expect(model.specificationVersion).toBe("v3");
      expect(model.modelId).toBe("text-embedding-3-small");
      expect(model.provider).toBe("sap-ai");
      expect(model.maxEmbeddingsPerCall).toBe(2048);
      expect(model.supportsParallelCalls).toBe(true);
    });

    it("should allow custom maxEmbeddingsPerCall", () => {
      const model = new SAPAIEmbeddingModel(
        "text-embedding-ada-002",
        { maxEmbeddingsPerCall: 100 },
        defaultConfig,
      );
      expect(model.maxEmbeddingsPerCall).toBe(100);
    });
  });

  describe("constructor validation", () => {
    it("should accept valid modelParams", () => {
      expect(
        () =>
          new SAPAIEmbeddingModel(
            "text-embedding-3-small",
            { modelParams: { dimensions: 1536, encoding_format: "float", normalize: true } },
            defaultConfig,
          ),
      ).not.toThrow();
    });

    it("should not throw when modelParams is undefined", () => {
      expect(
        () => new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig),
      ).not.toThrow();
    });

    it.each([
      { description: "negative dimensions", modelParams: { dimensions: -1 } },
      { description: "non-integer dimensions", modelParams: { dimensions: 1.5 } },
      { description: "invalid encoding_format", modelParams: { encoding_format: "invalid" } },
      { description: "non-boolean normalize", modelParams: { normalize: "true" } },
    ])("should reject $description", ({ modelParams }) => {
      expect(
        () =>
          new SAPAIEmbeddingModel(
            "text-embedding-ada-002",
            { modelParams } as never,
            defaultConfig,
          ),
      ).toThrow();
    });
  });

  describe("doEmbed", () => {
    it("should generate embeddings with correct result structure", async () => {
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);
      const result = await model.doEmbed({
        values: ["Hello", "World"],
      } as EmbeddingModelV3CallOptions);

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(result.usage?.tokens).toBe(8);
      expect(result.warnings).toEqual([]);
      expect(result.providerMetadata).toEqual({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        "sap-ai": { model: "text-embedding-ada-002", version: expect.any(String) },
      });
    });

    it("should sort embeddings by index when returned out of order", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      MockOrchestrationEmbeddingClient.embedResponse = {
        getEmbeddings: () => [
          { embedding: [0.7, 0.8, 0.9], index: 2, object: "embedding" },
          { embedding: [0.1, 0.2, 0.3], index: 0, object: "embedding" },
          { embedding: [0.4, 0.5, 0.6], index: 1, object: "embedding" },
        ],
        getTokenUsage: () => ({ prompt_tokens: 12, total_tokens: 12 }),
      };
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);
      const result = await model.doEmbed({ values: ["A", "B", "C"] });

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ]);
    });

    it("should throw TooManyEmbeddingValuesForCallError when exceeding limit", async () => {
      const model = new SAPAIEmbeddingModel(
        "text-embedding-ada-002",
        { maxEmbeddingsPerCall: 2 },
        defaultConfig,
      );
      await expect(model.doEmbed({ values: ["A", "B", "C"] })).rejects.toThrow(
        TooManyEmbeddingValuesForCallError,
      );
    });

    it("should pass abort signal to SAP SDK", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const abortController = new AbortController();
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);

      await model.doEmbed({ abortSignal: abortController.signal, values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.requestConfig?.signal).toBe(
        abortController.signal,
      );
    });

    it("should not pass requestConfig when no abort signal", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);

      await model.doEmbed({ values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.requestConfig).toBeUndefined();
    });
  });

  describe("embedding normalization", () => {
    it("should handle base64-encoded embeddings", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const floats = new Float32Array([1.0, 2.0, 3.0]);
      const base64 = Buffer.from(floats.buffer).toString("base64");
      MockOrchestrationEmbeddingClient.embedResponse = {
        getEmbeddings: () => [{ embedding: base64, index: 0, object: "embedding" }],
        getTokenUsage: () => ({ prompt_tokens: 4, total_tokens: 4 }),
      };

      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);
      const result = await model.doEmbed({ values: ["Test"] });

      expect(result.embeddings).toEqual([[1.0, 2.0, 3.0]]);
    });
  });

  describe("settings integration", () => {
    it.each([
      { description: "default type 'text'", expected: "text", settings: {} },
      {
        description: "constructor type 'document'",
        expected: "document",
        settings: { type: "document" as const },
      },
    ])("should use $description", async ({ expected, settings }) => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", settings, defaultConfig);

      await model.doEmbed({ values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.request.type).toBe(expected);
    });

    it("should pass model params to SDK client", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel(
        "text-embedding-3-large",
        { modelParams: { dimensions: 256 } },
        defaultConfig,
      );

      await model.doEmbed({ values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model).toEqual(
        {
          name: "text-embedding-3-large",
          params: { dimensions: 256 },
        },
      );
    });

    it("should not include params when modelParams not specified", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);

      await model.doEmbed({ values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model).toEqual(
        {
          name: "text-embedding-ada-002",
        },
      );
    });

    it("should apply providerOptions type override", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel(
        "text-embedding-ada-002",
        { type: "text" },
        defaultConfig,
      );

      await model.doEmbed({ providerOptions: { "sap-ai": { type: "query" } }, values: ["Test"] });

      expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.request.type).toBe("query");
    });

    it("should apply providerOptions modelParams override", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel(
        "text-embedding-3-large",
        { modelParams: { dimensions: 256 } },
        defaultConfig,
      );

      await model.doEmbed({
        providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
        values: ["Test"],
      });

      expect(
        MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model.params,
      ).toEqual({
        dimensions: 1024,
      });
    });

    it("should merge per-call modelParams with constructor modelParams", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      const model = new SAPAIEmbeddingModel(
        "text-embedding-3-large",
        { modelParams: { customParam: "from-constructor", dimensions: 256 } },
        defaultConfig,
      );

      await model.doEmbed({
        providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
        values: ["Test"],
      });

      expect(MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model).toEqual(
        {
          name: "text-embedding-3-large",
          params: { customParam: "from-constructor", dimensions: 1024 },
        },
      );
    });
  });

  describe("error handling", () => {
    it("should convert SAP errors to AI SDK errors", async () => {
      const { MockOrchestrationEmbeddingClient } = await getMockClient();
      MockOrchestrationEmbeddingClient.embedError = new Error("SAP API Error");
      const model = new SAPAIEmbeddingModel("text-embedding-ada-002", {}, defaultConfig);

      await expect(model.doEmbed({ values: ["Test"] })).rejects.toThrow();
    });
  });
});
