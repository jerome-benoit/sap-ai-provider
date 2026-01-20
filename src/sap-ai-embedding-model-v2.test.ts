/**
 * Unit tests for SAP AI Embedding Model V2.
 *
 * Tests verify V2 facade correctly delegates to V3 and transforms responses.
 * @see SAPAIEmbeddingModelV2
 */

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModelV2 } from "./sap-ai-embedding-model-v2.js";

describe("SAPAIEmbeddingModelV2", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  describe("Model properties", () => {
    it("should have correct specification version", () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      expect(model.specificationVersion).toBe("v2");
      expect(model.provider).toBe("sap-ai");
      expect(model.modelId).toBe("text-embedding-ada-002");
    });

    it("should expose correct interface properties for different model IDs", () => {
      const model1 = new SAPAIEmbeddingModelV2("text-embedding-3-small", {}, defaultConfig);
      expect(model1.specificationVersion).toBe("v2");
      expect(model1.modelId).toBe("text-embedding-3-small");
      expect(model1.maxEmbeddingsPerCall).toBe(2048); // V3 default
      expect(model1.supportsParallelCalls).toBe(true);

      const model2 = new SAPAIEmbeddingModelV2("text-embedding-3-large", {}, defaultConfig);
      expect(model2.modelId).toBe("text-embedding-3-large");
    });

    it("should pass settings to V3 model", () => {
      const settings = {
        maxEmbeddingsPerCall: 1000,
        type: "query" as const,
      };

      const model = new SAPAIEmbeddingModelV2("text-embedding-3-small", settings, defaultConfig);

      expect(model.maxEmbeddingsPerCall).toBe(1000);
      expect(model.supportsParallelCalls).toBe(true);
    });

    it("should allow custom maxEmbeddingsPerCall via settings", () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-ada-002",
        { maxEmbeddingsPerCall: 100 },
        defaultConfig,
      );
      expect(model.maxEmbeddingsPerCall).toBe(100);
    });
  });

  describe("Constructor validation (delegated to V3)", () => {
    it("should accept valid modelParams", () => {
      expect(
        () =>
          new SAPAIEmbeddingModelV2(
            "text-embedding-3-small",
            { modelParams: { dimensions: 1536, encoding_format: "float", normalize: true } },
            defaultConfig,
          ),
      ).not.toThrow();
    });

    it("should not throw when modelParams is undefined", () => {
      expect(
        () => new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig),
      ).not.toThrow();
    });

    it.each([
      { description: "negative dimensions", modelParams: { dimensions: -1 } },
      { description: "non-integer dimensions", modelParams: { dimensions: 1.5 } },
      { description: "invalid encoding_format", modelParams: { encoding_format: "invalid" } },
      { description: "non-boolean normalize", modelParams: { normalize: "true" } },
    ])("should reject $description (delegated to V3)", ({ modelParams }) => {
      expect(
        () =>
          new SAPAIEmbeddingModelV2(
            "text-embedding-ada-002",
            { modelParams } as never,
            defaultConfig,
          ),
      ).toThrow();
    });
  });

  describe("doEmbed", () => {
    it("should delegate to V3 model and transform response", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        providerMetadata: { "sap-ai": { modelId: "text-embedding-ada-002" } },
        response: { body: { data: "test" }, headers: { "x-request-id": "123" } },
        usage: { tokens: 10 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Hello", "World"] });

      expect(mockDoEmbed).toHaveBeenCalledWith({ values: ["Hello", "World"] });
      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(result.usage).toEqual({ tokens: 10 });
      expect(result.providerMetadata).toBeDefined();
      expect(result.response?.headers).toBeDefined();
      expect(result.response?.body).toEqual({ data: "test" });
    });

    it("should generate embeddings with correct result structure", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        providerMetadata: { "sap-ai": { model: "text-embedding-ada-002" } },
        usage: { tokens: 8 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Hello", "World"] });

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ]);
      expect(result.usage?.tokens).toBe(8);
      expect(result.providerMetadata?.["sap-ai"]).toEqual({ model: "text-embedding-ada-002" });
    });

    it("should handle response without optional fields", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Test"] });

      expect(result.embeddings).toEqual([[0.1]]);
      expect(result.usage).toBeUndefined();
      expect(result.providerMetadata).toBeUndefined();
      expect(result.response).toBeUndefined();
    });

    it("should preserve V3 embeddings sorted by index (V3 handles sorting)", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      // V3 model returns embeddings already sorted by index
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ],
        usage: { tokens: 12 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["A", "B", "C"] });

      expect(result.embeddings).toEqual([
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
      ]);
    });

    it("should handle warnings by logging them", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { tokens: 5 },
        warnings: [{ feature: "dimension", type: "unsupported" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Test"] });

      expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Unsupported feature: dimension",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should handle warnings with details", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 3 },
        warnings: [
          {
            details: "Custom dimensions not supported",
            feature: "dimensions parameter",
            type: "unsupported",
          },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Unsupported feature: dimensions parameter. Custom dimensions not supported",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should handle empty warnings array", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { tokens: 5 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it("should handle other warning type", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 3 },
        warnings: [{ message: "General warning message", type: "other" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith("[SAP AI Embedding] General warning message");

      consoleWarnSpy.mockRestore();
    });

    it("should handle compatibility warnings", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 3 },
        warnings: [
          { details: "Using compatibility mode", feature: "legacy-api", type: "compatibility" },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Compatibility mode: legacy-api. Using compatibility mode",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should pass through abort signal", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const abortController = new AbortController();
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ abortSignal: abortController.signal, values: ["Test"] });

      expect(mockDoEmbed).toHaveBeenCalledWith({
        abortSignal: abortController.signal,
        values: ["Test"],
      });
    });

    it("should pass through provider options", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const providerOptions = { "sap-ai": { type: "query" } };
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ providerOptions, values: ["Test"] });

      expect(mockDoEmbed).toHaveBeenCalledWith({ providerOptions, values: ["Test"] });
    });

    it("should pass through headers", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const headers = { "X-Custom-Header": "test-value" };
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ headers, values: ["Test"] });

      expect(mockDoEmbed).toHaveBeenCalledWith({ headers, values: ["Test"] });
    });
  });

  describe("Error handling (propagated from V3)", () => {
    it("should propagate TooManyEmbeddingValuesForCallError from V3", async () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-ada-002",
        { maxEmbeddingsPerCall: 2 },
        defaultConfig,
      );

      const mockDoEmbed = vi.fn().mockRejectedValue(
        new TooManyEmbeddingValuesForCallError({
          maxEmbeddingsPerCall: 2,
          modelId: "text-embedding-ada-002",
          provider: "sap-ai",
          values: ["A", "B", "C"],
        }),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await expect(model.doEmbed({ values: ["A", "B", "C"] })).rejects.toThrow(
        TooManyEmbeddingValuesForCallError,
      );
    });

    it("should propagate generic errors from V3", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockRejectedValue(new Error("SAP API Error"));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await expect(model.doEmbed({ values: ["Test"] })).rejects.toThrow("SAP API Error");
    });

    it("should propagate errors with original stack trace", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const originalError = new Error("Connection timeout");
      originalError.name = "TimeoutError";
      const mockDoEmbed = vi.fn().mockRejectedValue(originalError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      try {
        await model.doEmbed({ values: ["Test"] });
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBe(originalError);
        expect((error as Error).name).toBe("TimeoutError");
      }
    });
  });

  describe("Settings integration (delegated to V3)", () => {
    it("should pass type setting to V3", async () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-ada-002",
        { type: "document" },
        defaultConfig,
      );

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      // The type is passed via constructor to V3, doEmbed just delegates
      expect(mockDoEmbed).toHaveBeenCalled();
    });

    it("should pass modelParams to V3 model via constructor", async () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-3-large",
        { modelParams: { dimensions: 256 } },
        defaultConfig,
      );

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      // V3 model handles modelParams internally
      expect(mockDoEmbed).toHaveBeenCalled();
    });

    it("should pass providerOptions type override to V3", async () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-ada-002",
        { type: "text" },
        defaultConfig,
      );

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({
        providerOptions: { "sap-ai": { type: "query" } },
        values: ["Test"],
      });

      // providerOptions are passed through to V3
      expect(mockDoEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: { "sap-ai": { type: "query" } },
        }),
      );
    });

    it("should pass providerOptions modelParams override to V3", async () => {
      const model = new SAPAIEmbeddingModelV2(
        "text-embedding-3-large",
        { modelParams: { dimensions: 256 } },
        defaultConfig,
      );

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      await model.doEmbed({
        providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
        values: ["Test"],
      });

      // providerOptions are passed through to V3 which handles merging
      expect(mockDoEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
        }),
      );
    });
  });

  describe("Embedding result handling", () => {
    it("should handle single embedding", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
        usage: { tokens: 4 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Single input"] });

      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]).toHaveLength(5);
    });

    it("should handle many embeddings (batch)", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const embeddings = Array.from({ length: 100 }, (_, i) =>
        Array.from({ length: 1536 }, () => i * 0.001),
      );
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings,
        usage: { tokens: 500 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const values = Array.from({ length: 100 }, (_, i) => `Text ${String(i)}`);
      const result = await model.doEmbed({ values });

      expect(result.embeddings).toHaveLength(100);
      expect(result.embeddings[0]).toHaveLength(1536);
    });

    it("should handle high-dimensional embeddings", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-3-large", {}, defaultConfig);

      const embedding = Array.from({ length: 3072 }, () => Math.random());
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [embedding],
        usage: { tokens: 10 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).v3Model.doEmbed = mockDoEmbed;

      const result = await model.doEmbed({ values: ["Test"] });

      expect(result.embeddings[0]).toHaveLength(3072);
    });
  });
});
