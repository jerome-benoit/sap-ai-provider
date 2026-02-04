/**
 * Unit tests for SAP AI Embedding Model V2.
 *
 * Tests verify V2 facade correctly delegates to internal implementation and transforms responses.
 * V2 is a thin facade - most functionality is tested in internal implementation tests.
 *
 * Test Strategy:
 * - V2-specific properties (specificationVersion)
 * - Delegation to internal model (doEmbed)
 * - Warning handling (console.warn for V2)
 * - Forward all options to internal model
 * @see SAPAIEmbeddingModelV2
 */

import { describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModelV2 } from "./sap-ai-embedding-model-v2.js";

describe("SAPAIEmbeddingModelV2", () => {
  const defaultConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai" as const,
  };

  describe("V2-specific properties", () => {
    it("should have specificationVersion v2", () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      expect(model.specificationVersion).toBe("v2");
      expect(model.provider).toBe("sap-ai");
      expect(model.modelId).toBe("text-embedding-ada-002");
    });
  });

  describe("Delegation to internal model", () => {
    it("should delegate doEmbed to internal model", async () => {
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
      (model as any).internalModel.doEmbed = mockDoEmbed;

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

    it("should forward all options to internal model (abortSignal, headers, providerOptions)", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const abortController = new AbortController();
      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1]],
        usage: { tokens: 1 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({
        abortSignal: abortController.signal,
        headers: { "X-Custom-Header": "test-value" },
        providerOptions: { "sap-ai": { type: "query" } },
        values: ["Test"],
      });

      expect(mockDoEmbed).toHaveBeenCalledWith({
        abortSignal: abortController.signal,
        headers: { "X-Custom-Header": "test-value" },
        providerOptions: { "sap-ai": { type: "query" } },
        values: ["Test"],
      });
    });

    it("should propagate errors from internal doEmbed", async () => {
      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockError = new Error("Internal embedding failed");
      const mockDoEmbed = vi.fn().mockRejectedValue(mockError);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await expect(model.doEmbed({ values: ["Test"] })).rejects.toThrow(
        "Internal embedding failed",
      );
    });
  });

  describe("V2 Warning Handling", () => {
    it("should log unsupported warnings to console", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { tokens: 5 },
        warnings: [{ feature: "dimension", type: "unsupported" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Unsupported feature: dimension",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should log unsupported warnings with details", async () => {
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
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Unsupported feature: dimensions parameter. Custom dimensions not supported",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should log compatibility warnings", async () => {
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
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[SAP AI Embedding] Compatibility mode: legacy-api. Using compatibility mode",
      );

      consoleWarnSpy.mockRestore();
    });

    it("should log other warnings", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 3 },
        warnings: [{ message: "General warning message", type: "other" }],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).toHaveBeenCalledWith("[SAP AI Embedding] General warning message");

      consoleWarnSpy.mockRestore();
    });

    it("should not log when warnings array is empty", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(vi.fn());

      const model = new SAPAIEmbeddingModelV2("text-embedding-ada-002", {}, defaultConfig);

      const mockDoEmbed = vi.fn().mockResolvedValue({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { tokens: 5 },
        warnings: [],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (model as any).internalModel.doEmbed = mockDoEmbed;

      await model.doEmbed({ values: ["Test"] });

      expect(consoleWarnSpy).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });
});
