/** Unit tests for SAP AI Embedding Model. */
import type { EmbeddingModelV3CallOptions } from "@ai-sdk/provider";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAPAIEmbeddingModel } from "./sap-ai-embedding-model.js";
import { clearStrategyCaches } from "./sap-ai-strategy.js";

type APIType = "foundation-models" | "orchestration";

interface FMConstructorCall {
  destination: unknown;
  modelDeployment: { deploymentConfiguration: unknown; model: string };
}
interface FMEmbedCall {
  request: {
    dimensions?: number;
    encoding_format?: string;
    input: string[];
    input_type?: string;
    user?: string;
  };
  requestConfig?: { signal?: AbortSignal };
}
interface FMEmbeddingResponse {
  _data: { usage: { prompt_tokens: number; total_tokens: number } };
  getEmbeddings: () => (number[] | string)[];
}

interface OrchestrationConstructorCall {
  config: { embeddings: { model: { name: string; params?: Record<string, unknown> } } };
  deploymentConfig: unknown;
  destination: unknown;
}
interface OrchestrationEmbedCall {
  request: { input: string[]; type?: string };
  requestConfig?: { signal?: AbortSignal };
}
interface OrchestrationEmbeddingResponse {
  getEmbeddings: () => { embedding: number[] | string; index: number; object: string }[];
  getTokenUsage: () => { prompt_tokens: number; total_tokens: number };
}

vi.mock("@sap-ai-sdk/orchestration", () => {
  class MockOrchestrationEmbeddingClient {
    static embedError: Error | undefined;
    static embedResponse: OrchestrationEmbeddingResponse | undefined;
    static lastConstructorCall: OrchestrationConstructorCall | undefined;
    static lastEmbedCall: OrchestrationEmbedCall | undefined;

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

vi.mock("@sap-ai-sdk/foundation-models", () => {
  class MockAzureOpenAiEmbeddingClient {
    static embedError: Error | undefined;
    static embedResponse: FMEmbeddingResponse | undefined;
    static lastConstructorCall: FMConstructorCall | undefined;
    static lastEmbedCall: FMEmbedCall | undefined;

    run = vi
      .fn()
      .mockImplementation(
        (request: FMEmbedCall["request"], requestConfig?: { signal?: AbortSignal }) => {
          MockAzureOpenAiEmbeddingClient.lastEmbedCall = { request, requestConfig };
          const errorToThrow = MockAzureOpenAiEmbeddingClient.embedError;
          if (errorToThrow) {
            MockAzureOpenAiEmbeddingClient.embedError = undefined;
            throw errorToThrow;
          }
          if (MockAzureOpenAiEmbeddingClient.embedResponse) {
            const response = MockAzureOpenAiEmbeddingClient.embedResponse;
            MockAzureOpenAiEmbeddingClient.embedResponse = undefined;
            return Promise.resolve(response);
          }
          return Promise.resolve({
            _data: { usage: { prompt_tokens: 8, total_tokens: 8 } },
            getEmbeddings: () => [
              [0.1, 0.2, 0.3],
              [0.4, 0.5, 0.6],
            ],
          });
        },
      );

    constructor(
      modelDeployment: { deploymentConfiguration: unknown; model: string },
      destination: unknown,
    ) {
      MockAzureOpenAiEmbeddingClient.lastConstructorCall = {
        destination,
        modelDeployment,
      };
    }
  }
  return {
    AzureOpenAiEmbeddingClient: MockAzureOpenAiEmbeddingClient,
    MockAzureOpenAiEmbeddingClient,
  };
});

interface MockFMClientType {
  MockAzureOpenAiEmbeddingClient: {
    embedError: Error | undefined;
    embedResponse: FMEmbeddingResponse | undefined;
    lastConstructorCall: FMConstructorCall | undefined;
    lastEmbedCall: FMEmbedCall | undefined;
  };
}

interface MockOrchestrationClientType {
  MockOrchestrationEmbeddingClient: {
    embedError: Error | undefined;
    embedResponse: OrchestrationEmbeddingResponse | undefined;
    lastConstructorCall: OrchestrationConstructorCall | undefined;
    lastEmbedCall: OrchestrationEmbedCall | undefined;
  };
}

/**
 * Helper to access the mocked SAP AI SDK AzureOpenAiEmbeddingClient for test manipulation.
 * @returns The mock client instance with spied constructor and run method.
 */
async function getMockFMClient(): Promise<MockFMClientType> {
  const mod = await import("@sap-ai-sdk/foundation-models");
  return mod as unknown as MockFMClientType;
}

/**
 * Helper to access the mocked SAP AI SDK OrchestrationEmbeddingClient for test manipulation.
 * @returns The mock client instance with spied constructor and embed method.
 */
async function getMockOrchClient(): Promise<MockOrchestrationClientType> {
  const mod = await import("@sap-ai-sdk/orchestration");
  return mod as unknown as MockOrchestrationClientType;
}

describe("SAPAIEmbeddingModel", () => {
  const orchestrationConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai",
  };

  const foundationModelsConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai",
    providerApi: "foundation-models" as const,
  };

  /**
   * Returns the appropriate config for the given API type.
   * @param api - The API type.
   * @returns The config object for the specified API.
   */
  const getConfigForApi = (api: APIType) =>
    api === "foundation-models" ? foundationModelsConfig : orchestrationConfig;

  /**
   * Creates an embedding model for the given API type.
   * @param api - The API type.
   * @param modelId - The model identifier.
   * @param settings - Additional model settings.
   * @returns A configured SAPAIEmbeddingModel instance.
   */
  const createModelForApi = (
    api: APIType,
    modelId = "text-embedding-ada-002",
    settings: Record<string, unknown> = {},
  ) => new SAPAIEmbeddingModel(modelId, settings, getConfigForApi(api));

  /**
   * Resets the mock state for a given API type.
   * @param api - The API type to reset.
   */
  const resetMockStateForApi = async (api: APIType) => {
    clearStrategyCaches();
    if (api === "foundation-models") {
      const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
      MockAzureOpenAiEmbeddingClient.lastConstructorCall = undefined;
      MockAzureOpenAiEmbeddingClient.lastEmbedCall = undefined;
      MockAzureOpenAiEmbeddingClient.embedError = undefined;
      MockAzureOpenAiEmbeddingClient.embedResponse = undefined;
    } else {
      const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
      MockOrchestrationEmbeddingClient.lastConstructorCall = undefined;
      MockOrchestrationEmbeddingClient.lastEmbedCall = undefined;
      MockOrchestrationEmbeddingClient.embedError = undefined;
      MockOrchestrationEmbeddingClient.embedResponse = undefined;
    }
  };

  /**
   * Sets a custom embedding response for a given API type.
   * @param api - The API type.
   * @param response - The custom response to set.
   */
  const setEmbedResponseForApi = async (
    api: APIType,
    response: FMEmbeddingResponse | OrchestrationEmbeddingResponse,
  ) => {
    if (api === "foundation-models") {
      const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
      MockAzureOpenAiEmbeddingClient.embedResponse = response as FMEmbeddingResponse;
    } else {
      const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
      MockOrchestrationEmbeddingClient.embedResponse = response as OrchestrationEmbeddingResponse;
    }
  };

  /**
   * Sets an error to be thrown on next embed call for a given API type.
   * @param api - The API type.
   * @param error - The error to throw.
   */
  const setEmbedErrorForApi = async (api: APIType, error: Error) => {
    if (api === "foundation-models") {
      const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
      MockAzureOpenAiEmbeddingClient.embedError = error;
    } else {
      const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
      MockOrchestrationEmbeddingClient.embedError = error;
    }
  };

  /**
   * Gets the last embed call for a given API type.
   * @param api - The API type.
   * @returns The last embed call parameters.
   */
  const getLastEmbedCallForApi = async (api: APIType) => {
    if (api === "foundation-models") {
      const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
      return MockAzureOpenAiEmbeddingClient.lastEmbedCall;
    }
    const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
    return MockOrchestrationEmbeddingClient.lastEmbedCall;
  };

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "model properties (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should expose correct interface properties", () => {
        const model = createModelForApi(api, "text-embedding-3-small");
        expect(model.specificationVersion).toBe("v3");
        expect(model.modelId).toBe("text-embedding-3-small");
        expect(model.provider).toBe("sap-ai");
        expect(model.maxEmbeddingsPerCall).toBe(2048);
        expect(model.supportsParallelCalls).toBe(true);
      });

      it("should allow custom maxEmbeddingsPerCall", () => {
        const model = createModelForApi(api, "text-embedding-ada-002", {
          maxEmbeddingsPerCall: 100,
        });
        expect(model.maxEmbeddingsPerCall).toBe(100);
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "constructor validation (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should accept valid modelParams", () => {
        expect(() =>
          createModelForApi(api, "text-embedding-3-small", {
            modelParams: { dimensions: 1536, encoding_format: "float", normalize: true },
          }),
        ).not.toThrow();
      });

      it("should not throw when modelParams is undefined", () => {
        expect(() => createModelForApi(api, "text-embedding-ada-002")).not.toThrow();
      });

      it.each([
        { description: "negative dimensions", modelParams: { dimensions: -1 } },
        { description: "non-integer dimensions", modelParams: { dimensions: 1.5 } },
        { description: "invalid encoding_format", modelParams: { encoding_format: "invalid" } },
        { description: "non-boolean normalize", modelParams: { normalize: "true" } },
      ])("should reject $description", ({ modelParams }) => {
        expect(() =>
          createModelForApi(api, "text-embedding-ada-002", {
            modelParams,
          } as never),
        ).toThrow();
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])("doEmbed (%s API)", (api) => {
    beforeEach(async () => {
      await resetMockStateForApi(api);
    });

    it("should generate embeddings with correct result structure", async () => {
      const model = createModelForApi(api);
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

    it("should throw TooManyEmbeddingValuesForCallError when exceeding limit", async () => {
      const model = createModelForApi(api, "text-embedding-ada-002", {
        maxEmbeddingsPerCall: 2,
      });
      await expect(model.doEmbed({ values: ["A", "B", "C"] })).rejects.toThrow(
        TooManyEmbeddingValuesForCallError,
      );
    });

    it("should pass abort signal to SAP SDK", async () => {
      const abortController = new AbortController();
      const model = createModelForApi(api);

      await model.doEmbed({ abortSignal: abortController.signal, values: ["Test"] });

      const lastCall = await getLastEmbedCallForApi(api);
      expect(lastCall?.requestConfig?.signal).toBe(abortController.signal);
    });

    it("should not pass requestConfig when no abort signal", async () => {
      const model = createModelForApi(api);

      await model.doEmbed({ values: ["Test"] });

      const lastCall = await getLastEmbedCallForApi(api);
      expect(lastCall?.requestConfig).toBeUndefined();
    });
  });

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "embedding normalization (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should handle base64-encoded embeddings", async () => {
        const floats = new Float32Array([1.0, 2.0, 3.0]);
        const base64 = Buffer.from(floats.buffer).toString("base64");

        if (api === "foundation-models") {
          await setEmbedResponseForApi(api, {
            _data: { usage: { prompt_tokens: 4, total_tokens: 4 } },
            getEmbeddings: () => [base64],
          });
        } else {
          await setEmbedResponseForApi(api, {
            getEmbeddings: () => [{ embedding: base64, index: 0, object: "embedding" }],
            getTokenUsage: () => ({ prompt_tokens: 4, total_tokens: 4 }),
          });
        }

        const model = createModelForApi(api);
        const result = await model.doEmbed({ values: ["Test"] });

        expect(result.embeddings).toEqual([[1.0, 2.0, 3.0]]);
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "error handling (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should convert SAP errors to AI SDK errors", async () => {
        await setEmbedErrorForApi(api, new Error("SAP API Error"));
        const model = createModelForApi(api);

        await expect(model.doEmbed({ values: ["Test"] })).rejects.toThrow();
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "providerOptions override (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should apply providerOptions modelParams override", async () => {
        const model = createModelForApi(api, "text-embedding-3-large", {
          modelParams: { dimensions: 256 },
        });

        await model.doEmbed({
          providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
          values: ["Test"],
        });

        const lastCall = await getLastEmbedCallForApi(api);
        if (api === "foundation-models") {
          expect((lastCall as FMEmbedCall | undefined)?.request.dimensions).toBe(1024);
        } else {
          const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
          expect(
            MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model.params,
          ).toEqual({ dimensions: 1024 });
        }
      });

      it("should merge per-call modelParams with constructor modelParams", async () => {
        const model = createModelForApi(api, "text-embedding-3-large", {
          modelParams: { customParam: "from-constructor", dimensions: 256 },
        });

        await model.doEmbed({
          providerOptions: { "sap-ai": { modelParams: { dimensions: 1024 } } },
          values: ["Test"],
        });

        if (api === "orchestration") {
          const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
          expect(
            MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model,
          ).toEqual({
            name: "text-embedding-3-large",
            params: { customParam: "from-constructor", dimensions: 1024 },
          });
        }
      });
    },
  );

  describe("Orchestration API", () => {
    beforeEach(async () => {
      await resetMockStateForApi("orchestration");
    });

    describe("embedding index sorting", () => {
      it("should sort embeddings by index when returned out of order", async () => {
        const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
        MockOrchestrationEmbeddingClient.embedResponse = {
          getEmbeddings: () => [
            { embedding: [0.7, 0.8, 0.9], index: 2, object: "embedding" },
            { embedding: [0.1, 0.2, 0.3], index: 0, object: "embedding" },
            { embedding: [0.4, 0.5, 0.6], index: 1, object: "embedding" },
          ],
          getTokenUsage: () => ({ prompt_tokens: 12, total_tokens: 12 }),
        };
        const model = createModelForApi("orchestration");
        const result = await model.doEmbed({ values: ["A", "B", "C"] });

        expect(result.embeddings).toEqual([
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
          [0.7, 0.8, 0.9],
        ]);
      });
    });

    describe("type parameter", () => {
      it.each([
        { description: "default type 'text'", expected: "text", settings: {} },
        {
          description: "constructor type 'document'",
          expected: "document",
          settings: { type: "document" as const },
        },
      ])("should use $description", async ({ expected, settings }) => {
        const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
        const model = createModelForApi("orchestration", "text-embedding-ada-002", settings);

        await model.doEmbed({ values: ["Test"] });

        expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.request.type).toBe(expected);
      });

      it("should apply providerOptions type override", async () => {
        const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
        const model = createModelForApi("orchestration", "text-embedding-ada-002", {
          type: "text",
        });

        await model.doEmbed({ providerOptions: { "sap-ai": { type: "query" } }, values: ["Test"] });

        expect(MockOrchestrationEmbeddingClient.lastEmbedCall?.request.type).toBe("query");
      });
    });

    describe("model params in constructor", () => {
      it("should pass model params to SDK client", async () => {
        const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
        const model = createModelForApi("orchestration", "text-embedding-3-large", {
          modelParams: { dimensions: 256 },
        });

        await model.doEmbed({ values: ["Test"] });

        expect(
          MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model,
        ).toEqual({
          name: "text-embedding-3-large",
          params: { dimensions: 256 },
        });
      });

      it("should not include params when modelParams not specified", async () => {
        const { MockOrchestrationEmbeddingClient } = await getMockOrchClient();
        const model = createModelForApi("orchestration");

        await model.doEmbed({ values: ["Test"] });

        expect(
          MockOrchestrationEmbeddingClient.lastConstructorCall?.config.embeddings.model,
        ).toEqual({
          name: "text-embedding-ada-002",
        });
      });
    });
  });

  describe("Foundation Models API", () => {
    beforeEach(async () => {
      await resetMockStateForApi("foundation-models");
    });

    describe("FM-specific request parameters", () => {
      it("should pass user parameter to FM API request", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models", "text-embedding-ada-002", {
          modelParams: { user: "user-123" },
        });

        await model.doEmbed({ values: ["Test"] });

        expect(MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request.user).toBe("user-123");
      });

      it("should pass encoding_format parameter to FM API request", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models", "text-embedding-3-small", {
          modelParams: { encoding_format: "base64" },
        });

        await model.doEmbed({ values: ["Test"] });

        expect(MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request.encoding_format).toBe(
          "base64",
        );
      });

      it("should pass dimensions parameter to FM API request", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models", "text-embedding-3-large", {
          modelParams: { dimensions: 256 },
        });

        await model.doEmbed({ values: ["Test"] });

        expect(MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request.dimensions).toBe(256);
      });

      it("should pass input_type parameter via providerOptions", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models");

        await model.doEmbed({
          providerOptions: {
            "sap-ai": {
              modelParams: { input_type: "query" },
            },
          },
          values: ["Test"],
        });

        expect(MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request.input_type).toBe("query");
      });

      it("should pass multiple FM-specific parameters together", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models", "text-embedding-3-large", {
          modelParams: {
            dimensions: 512,
            encoding_format: "float",
            user: "test-user",
          },
        });

        await model.doEmbed({ values: ["Test"] });

        const request = MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request;
        expect(request?.dimensions).toBe(512);
        expect(request?.encoding_format).toBe("float");
        expect(request?.user).toBe("test-user");
      });

      it("should override settings modelParams with providerOptions modelParams", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models", "text-embedding-3-large", {
          modelParams: { dimensions: 256, user: "settings-user" },
        });

        await model.doEmbed({
          providerOptions: {
            "sap-ai": {
              modelParams: { dimensions: 1024 },
            },
          },
          values: ["Test"],
        });

        const request = MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request;
        expect(request?.dimensions).toBe(1024);
        expect(request?.user).toBe("settings-user");
      });

      it("should pass all providerOptions modelParams to FM API request", async () => {
        const { MockAzureOpenAiEmbeddingClient } = await getMockFMClient();
        const model = createModelForApi("foundation-models");

        await model.doEmbed({
          providerOptions: {
            "sap-ai": {
              modelParams: {
                dimensions: 512,
                input_type: "query",
                user: "override-user",
              },
            },
          },
          values: ["Test"],
        });

        const request = MockAzureOpenAiEmbeddingClient.lastEmbedCall?.request;
        expect(request?.dimensions).toBe(512);
        expect(request?.input_type).toBe("query");
        expect(request?.user).toBe("override-user");
      });
    });
  });
});
