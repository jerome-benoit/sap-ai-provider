/** Unit tests for SAP AI Language Model. */

import type {
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAPAILanguageModel } from "./sap-ai-language-model";
import { clearStrategyCaches } from "./sap-ai-strategy.js";

vi.mock("@sap-ai-sdk/orchestration", () => {
  class MockOrchestrationClient {
    static chatCompletionError: Error | undefined;
    static chatCompletionResponse:
      | undefined
      | {
          getContent: () => null | string;
          getFinishReason: () => string;
          getTokenUsage: () => {
            completion_tokens: number;
            prompt_tokens: number;
            total_tokens: number;
          };
          getToolCalls: () =>
            | undefined
            | { function: { arguments: string; name: string }; id: string }[];
          rawResponse?: { headers?: Record<string, unknown> };
        };
    static lastChatCompletionRequest: unknown;
    static lastChatCompletionRequestConfig: unknown;
    static lastConstructorConfig: unknown;

    static lastStreamAbortSignal: unknown;

    static lastStreamConfig: unknown;

    static lastStreamRequest: unknown;

    static streamChunks:
      | undefined
      | {
          getDeltaContent: () => null | string;
          getDeltaToolCalls: () =>
            | undefined
            | {
                function?: { arguments?: string; name?: string };
                id?: string;
                index: number;
              }[];
          getFinishReason: () => null | string | undefined;
          getTokenUsage: () =>
            | undefined
            | {
                completion_tokens: number;
                prompt_tokens: number;
                total_tokens: number;
              };
        }[];
    static streamError: Error | undefined;
    static streamSetupError: Error | undefined;

    chatCompletion = vi.fn().mockImplementation((request, requestConfig) => {
      MockOrchestrationClient.lastChatCompletionRequest = request;
      MockOrchestrationClient.lastChatCompletionRequestConfig = requestConfig;

      const errorToThrow = MockOrchestrationClient.chatCompletionError;
      if (errorToThrow) {
        MockOrchestrationClient.chatCompletionError = undefined;
        throw errorToThrow;
      }

      if (MockOrchestrationClient.chatCompletionResponse) {
        const response = MockOrchestrationClient.chatCompletionResponse;
        MockOrchestrationClient.chatCompletionResponse = undefined;
        return Promise.resolve(response);
      }

      const messages = (request as { messages?: unknown[] }).messages;
      const hasImage =
        messages?.some(
          (msg) =>
            typeof msg === "object" &&
            msg !== null &&
            "content" in msg &&
            Array.isArray((msg as { content?: unknown }).content),
        ) ?? false;

      if (hasImage) {
        throw new Error("boom");
      }

      return Promise.resolve({
        getContent: () => "Hello!",
        getFinishReason: () => "stop",
        getTokenUsage: () => ({
          completion_tokens: 5,
          prompt_tokens: 10,
          total_tokens: 15,
        }),
        getToolCalls: () => undefined,
        rawResponse: {
          headers: {
            "x-request-id": "test-request-id",
          },
        },
      });
    });

    stream = vi.fn().mockImplementation((request, abortSignal, config) => {
      MockOrchestrationClient.lastStreamRequest = request;
      MockOrchestrationClient.lastStreamAbortSignal = abortSignal;
      MockOrchestrationClient.lastStreamConfig = config;

      if (MockOrchestrationClient.streamSetupError) {
        const error = MockOrchestrationClient.streamSetupError;
        MockOrchestrationClient.streamSetupError = undefined;
        throw error;
      }

      const chunks =
        MockOrchestrationClient.streamChunks ??
        ([
          {
            getDeltaContent: () => "Hello",
            getDeltaToolCalls: () => undefined,
            getFinishReason: () => null,
            getTokenUsage: () => undefined,
          },
          {
            getDeltaContent: () => "!",
            getDeltaToolCalls: () => undefined,
            getFinishReason: () => "stop",
            getTokenUsage: () => ({
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            }),
          },
        ] as const);

      let lastFinishReason: null | string | undefined;
      let lastTokenUsage:
        | undefined
        | {
            completion_tokens: number;
            prompt_tokens: number;
            total_tokens: number;
          };

      for (const chunk of chunks) {
        const fr = chunk.getFinishReason();
        if (fr !== null && fr !== undefined) {
          lastFinishReason = fr;
        }
        const tu = chunk.getTokenUsage();
        if (tu) {
          lastTokenUsage = tu;
        }
      }

      const errorToThrow = MockOrchestrationClient.streamError;

      return {
        getFinishReason: () => lastFinishReason,
        getTokenUsage: () =>
          lastTokenUsage ?? {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        stream: {
          *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
            if (errorToThrow) {
              throw errorToThrow;
            }
          },
        },
      };
    });

    constructor(config: unknown) {
      MockOrchestrationClient.lastConstructorConfig = config;
    }

    static setChatCompletionError(error: Error) {
      MockOrchestrationClient.chatCompletionError = error;
    }

    static setChatCompletionResponse(
      response: typeof MockOrchestrationClient.chatCompletionResponse,
    ) {
      MockOrchestrationClient.chatCompletionResponse = response;
    }

    static setStreamChunks(
      chunks: {
        getDeltaContent: () => null | string;
        getDeltaToolCalls: () =>
          | undefined
          | {
              function?: { arguments?: string; name?: string };
              id?: string;
              index: number;
            }[];
        getFinishReason: () => null | string | undefined;
        getTokenUsage: () =>
          | undefined
          | {
              completion_tokens: number;
              prompt_tokens: number;
              total_tokens: number;
            };
      }[],
    ) {
      MockOrchestrationClient.streamChunks = chunks;
      MockOrchestrationClient.streamError = undefined;
    }

    static setStreamError(error: Error) {
      MockOrchestrationClient.streamError = error;
    }

    static setStreamSetupError(error: Error) {
      MockOrchestrationClient.streamSetupError = error;
    }
  }

  return {
    OrchestrationClient: MockOrchestrationClient,
  };
});

vi.mock("@sap-ai-sdk/foundation-models", () => {
  class MockAzureOpenAiChatClient {
    static chatCompletionError: Error | undefined;
    static chatCompletionResponse:
      | undefined
      | {
          getContent: () => null | string;
          getFinishReason: () => string;
          getTokenUsage: () => {
            completion_tokens: number;
            prompt_tokens: number;
            total_tokens: number;
          };
          getToolCalls: () =>
            | undefined
            | { function: { arguments: string; name: string }; id: string }[];
          rawResponse?: { headers?: Record<string, unknown> };
        };
    static lastConstructorCall: undefined | { destination: unknown; modelDeployment: unknown };
    static lastRunRequest: unknown;
    static lastRunRequestConfig: unknown;

    static lastStreamAbortSignal: unknown;

    static lastStreamRequest: unknown;

    static streamChunks:
      | undefined
      | {
          getDeltaContent: () => null | string;
          getDeltaToolCalls: () =>
            | undefined
            | {
                function?: { arguments?: string; name?: string };
                id?: string;
                index: number;
              }[];
          getFinishReason: () => null | string | undefined;
          getTokenUsage: () =>
            | undefined
            | {
                completion_tokens: number;
                prompt_tokens: number;
                total_tokens: number;
              };
        }[];
    static streamError: Error | undefined;
    static streamSetupError: Error | undefined;

    run = vi.fn().mockImplementation((request, requestConfig) => {
      MockAzureOpenAiChatClient.lastRunRequest = request;
      MockAzureOpenAiChatClient.lastRunRequestConfig = requestConfig;

      const errorToThrow = MockAzureOpenAiChatClient.chatCompletionError;
      if (errorToThrow) {
        MockAzureOpenAiChatClient.chatCompletionError = undefined;
        throw errorToThrow;
      }

      if (MockAzureOpenAiChatClient.chatCompletionResponse) {
        const response = MockAzureOpenAiChatClient.chatCompletionResponse;
        MockAzureOpenAiChatClient.chatCompletionResponse = undefined;
        return Promise.resolve(response);
      }

      const messages = (request as { messages?: unknown[] }).messages;
      const hasImage =
        messages?.some(
          (msg) =>
            typeof msg === "object" &&
            msg !== null &&
            "content" in msg &&
            Array.isArray((msg as { content?: unknown }).content),
        ) ?? false;

      if (hasImage) {
        throw new Error("boom");
      }

      return Promise.resolve({
        getContent: () => "Hello!",
        getFinishReason: () => "stop",
        getTokenUsage: () => ({
          completion_tokens: 5,
          prompt_tokens: 10,
          total_tokens: 15,
        }),
        getToolCalls: () => undefined,
        rawResponse: {
          headers: {
            "x-request-id": "test-request-id",
          },
        },
      });
    });

    stream = vi.fn().mockImplementation((request, abortSignal) => {
      MockAzureOpenAiChatClient.lastStreamRequest = request;
      MockAzureOpenAiChatClient.lastStreamAbortSignal = abortSignal;

      if (MockAzureOpenAiChatClient.streamSetupError) {
        const error = MockAzureOpenAiChatClient.streamSetupError;
        MockAzureOpenAiChatClient.streamSetupError = undefined;
        throw error;
      }

      const chunks =
        MockAzureOpenAiChatClient.streamChunks ??
        ([
          {
            getDeltaContent: () => "Hello",
            getDeltaToolCalls: () => undefined,
            getFinishReason: () => null,
            getTokenUsage: () => undefined,
          },
          {
            getDeltaContent: () => "!",
            getDeltaToolCalls: () => undefined,
            getFinishReason: () => "stop",
            getTokenUsage: () => ({
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            }),
          },
        ] as const);

      let lastFinishReason: null | string | undefined;
      let lastTokenUsage:
        | undefined
        | {
            completion_tokens: number;
            prompt_tokens: number;
            total_tokens: number;
          };

      for (const chunk of chunks) {
        const fr = chunk.getFinishReason();
        if (fr !== null && fr !== undefined) {
          lastFinishReason = fr;
        }
        const tu = chunk.getTokenUsage();
        if (tu) {
          lastTokenUsage = tu;
        }
      }

      const errorToThrow = MockAzureOpenAiChatClient.streamError;

      return {
        getFinishReason: () => lastFinishReason,
        getTokenUsage: () =>
          lastTokenUsage ?? {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        stream: {
          *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield chunk;
            }
            if (errorToThrow) {
              throw errorToThrow;
            }
          },
        },
      };
    });

    constructor(modelDeployment: unknown, destination: unknown) {
      MockAzureOpenAiChatClient.lastConstructorCall = { destination, modelDeployment };
    }

    static setChatCompletionError(error: Error) {
      MockAzureOpenAiChatClient.chatCompletionError = error;
    }

    static setChatCompletionResponse(
      response: typeof MockAzureOpenAiChatClient.chatCompletionResponse,
    ) {
      MockAzureOpenAiChatClient.chatCompletionResponse = response;
    }

    static setStreamChunks(
      chunks: {
        getDeltaContent: () => null | string;
        getDeltaToolCalls: () =>
          | undefined
          | {
              function?: { arguments?: string; name?: string };
              id?: string;
              index: number;
            }[];
        getFinishReason: () => null | string | undefined;
        getTokenUsage: () =>
          | undefined
          | {
              completion_tokens: number;
              prompt_tokens: number;
              total_tokens: number;
            };
      }[],
    ) {
      MockAzureOpenAiChatClient.streamChunks = chunks;
      MockAzureOpenAiChatClient.streamError = undefined;
    }

    static setStreamError(error: Error) {
      MockAzureOpenAiChatClient.streamError = error;
    }

    static setStreamSetupError(error: Error) {
      MockAzureOpenAiChatClient.streamSetupError = error;
    }
  }

  return {
    AzureOpenAiChatClient: MockAzureOpenAiChatClient,
  };
});

type APIType = "foundation-models" | "orchestration";

describe("SAPAILanguageModel", () => {
  const orchestrationConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai",
  };

  const foundationModelsConfig = {
    deploymentConfig: { resourceGroup: "default" },
    provider: "sap-ai",
    providerApi: "foundation-models" as const,
  };

  const getConfigForApi = (api: APIType) =>
    api === "foundation-models" ? foundationModelsConfig : orchestrationConfig;

  const createModelForApi = (
    api: APIType,
    modelId = "gpt-4o",
    settings: Record<string, unknown> = {},
  ) => new SAPAILanguageModel(modelId, settings, getConfigForApi(api));

  const createOrchModel = (modelId = "gpt-4o", settings: unknown = {}) => {
    return new SAPAILanguageModel(
      modelId,
      settings as ConstructorParameters<typeof SAPAILanguageModel>[1],
      orchestrationConfig,
    );
  };

  const createFMModel = (modelId = "gpt-4o", settings: Record<string, unknown> = {}) => {
    return new SAPAILanguageModel(
      modelId,
      { api: "foundation-models", ...settings } as ConstructorParameters<
        typeof SAPAILanguageModel
      >[1],
      {
        deploymentConfig: { deploymentId: "test-deployment" },
        provider: "sap-ai",
      },
    );
  };

  const createPrompt = (text: string): LanguageModelV3Prompt => [
    { content: [{ text, type: "text" }], role: "user" },
  ];

  const expectRequestBodyHasMessages = (result: { request?: { body?: unknown } }) => {
    const body: unknown = result.request?.body;
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
    expect(body).toHaveProperty("messages");
  };

  const expectRequestBodyHasMessagesHistory = (result: { request?: { body?: unknown } }) => {
    const body: unknown = result.request?.body;
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
    expect(body).toHaveProperty("messagesHistory");
    expect(body).not.toHaveProperty("messages");
  };

  const expectToOmitKeys = (value: unknown, keys: string[]) => {
    expect(value).toBeTruthy();
    expect(typeof value).toBe("object");

    for (const key of keys) {
      expect(value).not.toHaveProperty(key);
    }
  };

  interface MockClientInterface {
    lastConstructorConfig?: unknown;
    lastRequest: unknown;
    lastRequestConfig: unknown;
    lastStreamAbortSignal: unknown;
    lastStreamRequest: unknown;
    setChatCompletionError?: (error: Error) => void;
    setChatCompletionResponse?: (response: unknown) => void;
    setStreamChunks?: (chunks: unknown[]) => void;
    setStreamError?: (error: Error) => void;
    setStreamSetupError?: (error: Error) => void;
  }

  const getMockOrchClient = async () => {
    const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
    const client = OrchestrationClient as unknown as {
      lastChatCompletionRequest: unknown;
      lastChatCompletionRequestConfig: unknown;
      lastConstructorConfig: unknown;
      lastStreamAbortSignal: unknown;
      lastStreamConfig: unknown;
      lastStreamRequest: unknown;
      setChatCompletionError?: (error: Error) => void;
      setChatCompletionResponse?: (response: unknown) => void;
      setStreamChunks?: (chunks: unknown[]) => void;
      setStreamError?: (error: Error) => void;
      setStreamSetupError?: (error: Error) => void;
    };
    return {
      lastConstructorConfig: client.lastConstructorConfig,
      lastRequest: client.lastChatCompletionRequest,
      lastRequestConfig: client.lastChatCompletionRequestConfig,
      lastStreamAbortSignal: client.lastStreamAbortSignal,
      lastStreamRequest: client.lastStreamRequest,
      setChatCompletionError: client.setChatCompletionError,
      setChatCompletionResponse: client.setChatCompletionResponse,
      setStreamChunks: client.setStreamChunks,
      setStreamError: client.setStreamError,
      setStreamSetupError: client.setStreamSetupError,
    } as MockClientInterface;
  };

  const getMockFMClient = async () => {
    const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
    const client = AzureOpenAiChatClient as unknown as {
      lastConstructorCall: undefined | { destination: unknown; modelDeployment: unknown };
      lastRunRequest: unknown;
      lastRunRequestConfig: unknown;
      lastStreamAbortSignal: unknown;
      lastStreamRequest: unknown;
      setChatCompletionError?: (error: Error) => void;
      setChatCompletionResponse?: (response: unknown) => void;
      setStreamChunks?: (chunks: unknown[]) => void;
      setStreamError?: (error: Error) => void;
      setStreamSetupError?: (error: Error) => void;
    };
    return {
      lastConstructorCall: client.lastConstructorCall,
      lastRequest: client.lastRunRequest,
      lastRequestConfig: client.lastRunRequestConfig,
      lastStreamAbortSignal: client.lastStreamAbortSignal,
      lastStreamRequest: client.lastStreamRequest,
      setChatCompletionError: client.setChatCompletionError,
      setChatCompletionResponse: client.setChatCompletionResponse,
      setStreamChunks: client.setStreamChunks,
      setStreamError: client.setStreamError,
      setStreamSetupError: client.setStreamSetupError,
    };
  };

  const getMockClientForApi = async (api: APIType): Promise<MockClientInterface> => {
    if (api === "foundation-models") {
      return getMockFMClient();
    }
    return getMockOrchClient();
  };

  const setStreamChunksForApi = async (api: APIType, chunks: unknown[]) => {
    const MockClient = await getMockClientForApi(api);
    if (!MockClient.setStreamChunks) {
      throw new Error("mock missing setStreamChunks");
    }
    MockClient.setStreamChunks(chunks);
  };

  const resetMockStateForApi = async (api: APIType) => {
    clearStrategyCaches();
    if (api === "foundation-models") {
      const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
      const client = AzureOpenAiChatClient as unknown as {
        chatCompletionError: Error | undefined;
        chatCompletionResponse: unknown;
        lastConstructorCall: unknown;
        lastRunRequest: unknown;
        lastRunRequestConfig: unknown;
        lastStreamAbortSignal: unknown;
        lastStreamRequest: unknown;
        streamChunks: unknown;
        streamError: Error | undefined;
        streamSetupError: Error | undefined;
      };
      client.chatCompletionError = undefined;
      client.chatCompletionResponse = undefined;
      client.lastConstructorCall = undefined;
      client.lastRunRequest = undefined;
      client.lastRunRequestConfig = undefined;
      client.lastStreamAbortSignal = undefined;
      client.lastStreamRequest = undefined;
      client.streamChunks = undefined;
      client.streamError = undefined;
      client.streamSetupError = undefined;
    } else {
      const { OrchestrationClient } = await import("@sap-ai-sdk/orchestration");
      const client = OrchestrationClient as unknown as {
        chatCompletionError: Error | undefined;
        chatCompletionResponse: unknown;
        lastChatCompletionRequest: unknown;
        lastChatCompletionRequestConfig: unknown;
        lastStreamAbortSignal: unknown;
        lastStreamConfig: unknown;
        lastStreamRequest: unknown;
        streamChunks: unknown;
        streamError: Error | undefined;
        streamSetupError: Error | undefined;
      };
      client.chatCompletionError = undefined;
      client.chatCompletionResponse = undefined;
      client.lastChatCompletionRequest = undefined;
      client.lastChatCompletionRequestConfig = undefined;
      client.lastStreamAbortSignal = undefined;
      client.lastStreamConfig = undefined;
      client.lastStreamRequest = undefined;
      client.streamChunks = undefined;
      client.streamError = undefined;
      client.streamSetupError = undefined;
    }
  };

  type FMChatCompletionRequest = Record<string, unknown> & {
    frequency_penalty?: number;
    max_tokens?: number;
    messages?: unknown;
    model?: string;
    presence_penalty?: number;
    response_format?: unknown;
    temperature?: number;
    tools?: unknown;
    top_p?: number;
  };

  const getLastFMRequest = async (): Promise<FMChatCompletionRequest> => {
    const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
    const client = AzureOpenAiChatClient as unknown as {
      lastRunRequest: unknown;
    };
    return client.lastRunRequest as FMChatCompletionRequest;
  };

  const getLastFMStreamRequest = async (): Promise<FMChatCompletionRequest> => {
    const { AzureOpenAiChatClient } = await import("@sap-ai-sdk/foundation-models");
    const client = AzureOpenAiChatClient as unknown as {
      lastStreamRequest: unknown;
    };
    return client.lastStreamRequest as FMChatCompletionRequest;
  };

  const getLastRequestForApi = async (
    api: APIType,
  ): Promise<FMChatCompletionRequest | OrchestrationChatCompletionRequest> => {
    if (api === "foundation-models") {
      return getLastFMRequest();
    }
    return getLastOrchRequest();
  };

  const getModelParamFromRequest = (
    api: APIType,
    request: FMChatCompletionRequest | OrchestrationChatCompletionRequest,
    key: string,
  ): unknown => {
    if (api === "foundation-models") {
      return (request as FMChatCompletionRequest)[key];
    }
    return (request as OrchestrationChatCompletionRequest).model?.params?.[key];
  };

  type OrchestrationChatCompletionRequest = Record<string, unknown> & {
    messages?: unknown;
    model?: {
      name?: string;
      params?: Record<string, unknown>;
      version?: string;
    };
    placeholderValues?: Record<string, string>;
    response_format?: unknown;
    tools?: unknown;
  };

  const getLastOrchRequest = async () => {
    const MockClient = await getMockOrchClient();
    return MockClient.lastRequest as OrchestrationChatCompletionRequest;
  };

  const getLastOrchStreamRequest = async () => {
    const MockClient = await getMockOrchClient();
    return MockClient.lastStreamRequest as OrchestrationChatCompletionRequest;
  };

  const getLastOrchClientConfig = async () => {
    const MockClient = await getMockOrchClient();
    return MockClient.lastConstructorConfig as { promptTemplating?: { prompt?: unknown } };
  };

  const expectRequestBodyHasMessagesAndNoWarnings = (result: {
    request?: { body?: unknown };
    warnings: unknown[];
  }) => {
    expect(result.warnings).toHaveLength(0);
    expectRequestBodyHasMessages(result);
  };

  const expectWarningMessageContains = (
    warnings: { message?: string; type: string }[],
    substring: string,
  ) => {
    expect(
      warnings.some(
        (warning) => typeof warning.message === "string" && warning.message.includes(substring),
      ),
    ).toBe(true);
  };

  /**
   * Creates a mock chat response with sensible defaults that can be overridden.
   * @param overrides - Optional values to override defaults.
   * @param overrides.content - The response content.
   * @param overrides.finishReason - The finish reason.
   * @param overrides.headers - Response headers.
   * @param overrides.toolCalls - Tool calls in the response.
   * @param overrides.usage - Token usage information.
   * @param overrides.usage.completion_tokens - Completion token count.
   * @param overrides.usage.prompt_tokens - Prompt token count.
   * @param overrides.usage.total_tokens - Total token count.
   * @returns A mock chat response object.
   */
  const createMockChatResponse = (
    overrides: {
      content?: null | string;
      finishReason?: string;
      headers?: Record<string, unknown>;
      toolCalls?: {
        function: { arguments: string; name: string };
        id: string;
      }[];
      usage?: {
        completion_tokens: number;
        prompt_tokens: number;
        total_tokens: number;
      };
    } = {},
  ) => {
    const defaults = {
      content: "Hello!",
      finishReason: "stop",
      headers: { "x-request-id": "test-request-id" },
      toolCalls: undefined,
      usage: {
        completion_tokens: 5,
        prompt_tokens: 10,
        total_tokens: 15,
      },
    };

    const merged = { ...defaults, ...overrides };

    return {
      getContent: () => merged.content,
      getFinishReason: () => merged.finishReason,
      getTokenUsage: () => merged.usage,
      getToolCalls: () => merged.toolCalls,
      rawResponse: { headers: merged.headers },
    };
  };

  /**
   * Creates stream chunks with sensible defaults.
   * @param overrides - Optional values to override defaults.
   * @param overrides._data - Raw chunk data.
   * @param overrides.deltaContent - Delta content for streaming.
   * @param overrides.deltaToolCalls - Delta tool calls for streaming.
   * @param overrides.finishReason - The finish reason.
   * @param overrides.usage - Token usage information.
   * @returns A mock stream chunk object.
   */
  const createMockStreamChunk = (
    overrides: {
      _data?: unknown;
      deltaContent?: null | string;
      deltaToolCalls?: {
        function?: { arguments?: string; name?: string };
        id?: string;
        index: number;
      }[];
      finishReason?: null | string | undefined;
      usage?:
        | undefined
        | {
            completion_tokens: number;
            prompt_tokens: number;
            total_tokens: number;
          };
    } = {},
  ) => {
    const defaults = {
      _data: undefined,
      deltaContent: null,
      deltaToolCalls: undefined,
      finishReason: null,
      usage: undefined,
    };

    const merged = { ...defaults, ...overrides };

    return {
      _data: merged._data,
      getDeltaContent: () => merged.deltaContent,
      getDeltaToolCalls: () => merged.deltaToolCalls,
      getFinishReason: () => merged.finishReason,
      getTokenUsage: () => merged.usage,
    };
  };

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "model properties (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it("should have correct specification version", () => {
        const model = createModelForApi(api);
        expect(model.specificationVersion).toBe("v3");
      });

      it("should have correct model ID", () => {
        const model = createModelForApi(api, "gpt-4o");
        expect(model.modelId).toBe("gpt-4o");
      });

      it("should have correct provider", () => {
        const model = createModelForApi(api);
        expect(model.provider).toBe("sap-ai");
      });

      it.each([
        {
          expected: false,
          name: "should not support HTTP URLs",
          url: "http://example.com/image.png",
        },
        { expected: true, name: "should support data URLs", url: "data:image/png;base64,Zm9v" },
      ])("$name", ({ expected, url }) => {
        const model = createModelForApi(api);
        expect(model.supportsUrl(new URL(url))).toBe(expected);
      });

      it("should have supportedUrls getter for image types", () => {
        const model = createModelForApi(api);
        const urls = model.supportedUrls;

        expect(urls).toHaveProperty("image/*");
        expect(urls["image/*"]).toHaveLength(2);
        expect(urls["image/*"]?.[0]?.test("https://example.com/image.png")).toBe(true);
        expect(urls["image/*"]?.[0]?.test("http://example.com/image.png")).toBe(false);
        expect(urls["image/*"]?.[1]?.test("data:image/png;base64,Zm9v")).toBe(true);
      });

      describe("model capabilities", () => {
        const expectedCapabilities = {
          supportsImageUrls: true,
          supportsMultipleCompletions: true,
          supportsParallelToolCalls: true,
          supportsStreaming: true,
          supportsStructuredOutputs: true,
          supportsToolCalls: true,
        };

        it.each([
          "any-model",
          "gpt-4o",
          "anthropic--claude-3.5-sonnet",
          "gemini-2.0-flash",
          "amazon--nova-pro",
          "mistralai--mistral-large-instruct",
          "unknown-future-model",
        ])("should have consistent capabilities for model %s", (modelId) => {
          const model = createModelForApi(api, modelId);
          expect(model).toMatchObject(expectedCapabilities);
        });
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])(
    "constructor validation (%s API)",
    (api) => {
      beforeEach(async () => {
        await resetMockStateForApi(api);
      });

      it.each([
        { name: "valid modelParams", params: { maxTokens: 1000, temperature: 0.7, topP: 0.9 } },
        { name: "empty modelParams", params: {} },
        { name: "no modelParams", params: undefined },
      ])("should accept $name", ({ params }) => {
        expect(() =>
          createModelForApi(api, "gpt-4o", params ? { modelParams: params } : {}),
        ).not.toThrow();
      });

      it.each([
        { name: "temperature too high", params: { temperature: 3 } },
        { name: "temperature negative", params: { temperature: -1 } },
        { name: "topP out of range", params: { topP: 1.5 } },
        { name: "non-positive maxTokens", params: { maxTokens: 0 } },
        { name: "non-integer maxTokens", params: { maxTokens: 100.5 } },
        { name: "frequencyPenalty out of range", params: { frequencyPenalty: -3 } },
        { name: "presencePenalty out of range", params: { presencePenalty: 2.5 } },
      ])("should throw on $name", ({ params }) => {
        expect(() => createModelForApi(api, "gpt-4o", { modelParams: params })).toThrow();
      });

      it.each([
        { name: "non-positive n", params: { n: 0 } },
        { name: "non-boolean parallel_tool_calls", params: { parallel_tool_calls: "true" } },
      ])("should throw on $name", ({ params }) => {
        expect(() => createModelForApi(api, "gpt-4o", { modelParams: params })).toThrow();
      });
    },
  );

  describe.each<APIType>(["orchestration", "foundation-models"])("doGenerate (%s API)", (api) => {
    beforeEach(async () => {
      await resetMockStateForApi(api);
    });

    it("should generate text response", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const result = await model.doGenerate({ prompt });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ text: "Hello!", type: "text" });
      expect(result.finishReason).toEqual({ raw: "stop", unified: "stop" });
      expect(result.usage).toEqual({
        inputTokens: {
          cacheRead: undefined,
          cacheWrite: undefined,
          noCache: 10,
          total: 10,
        },
        outputTokens: { reasoning: undefined, text: 5, total: 5 },
      });
      expect(result.response?.headers).toBeDefined();
      expect(result.response?.headers).toMatchObject({
        "x-request-id": "test-request-id",
      });
      expect(result.providerMetadata).toEqual({
        "sap-ai": {
          finishReason: "stop",
          finishReasonMapped: { raw: "stop", unified: "stop" },
          requestId: "test-request-id",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          version: expect.any(String),
        },
      });
    });

    describe("error handling", () => {
      it("should propagate axios response headers into doGenerate errors", async () => {
        const MockClient = await getMockClientForApi(api);
        if (!MockClient.setChatCompletionError) {
          throw new Error("mock missing setChatCompletionError");
        }

        const axiosError = new Error("Request failed") as Error & {
          isAxiosError: boolean;
          response: { headers: Record<string, string> };
        };
        axiosError.isAxiosError = true;
        axiosError.response = {
          headers: {
            "x-request-id": "do-generate-axios-123",
          },
        };

        MockClient.setChatCompletionError(axiosError);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        await expect(model.doGenerate({ prompt })).rejects.toMatchObject({
          responseHeaders: {
            "x-request-id": "do-generate-axios-123",
          },
        });
      });

      it("should sanitize requestBodyValues in errors", async () => {
        const model = createModelForApi(api);

        const prompt: LanguageModelV3Prompt = [
          {
            content: [
              {
                data: "BASE64_IMAGE_DATA",
                mediaType: "image/png",
                type: "file",
              },
            ],
            role: "user",
          },
        ];

        let caught: unknown;
        try {
          await model.doGenerate({ prompt });
        } catch (error: unknown) {
          caught = error;
        }

        const caughtError = caught as {
          name?: string;
          requestBodyValues?: unknown;
        };

        expect(caughtError.name).toEqual(expect.stringContaining("APICallError"));
        expect(caughtError.requestBodyValues).toMatchObject({
          hasImageParts: true,
          promptMessages: 1,
        });
      });
    });

    describe("abort signal support", () => {
      it("should pass abort signal via requestConfig", async () => {
        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");
        const controller = new AbortController();

        await model.doGenerate({ abortSignal: controller.signal, prompt });

        const MockClient = await getMockClientForApi(api);
        expect(MockClient.lastRequestConfig).toBeDefined();
        expect(MockClient.lastRequestConfig).toHaveProperty("signal", controller.signal);
      });

      it("should not pass requestConfig when abort signal is not provided", async () => {
        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        await model.doGenerate({ prompt });

        const MockClient = await getMockClientForApi(api);
        expect(MockClient.lastRequestConfig).toBeUndefined();
      });

      it("should propagate error when request rejects due to abort", async () => {
        const MockClient = await getMockClientForApi(api);

        const abortError = new Error("Request aborted") as Error & {
          isAxiosError: boolean;
          response?: { headers?: Record<string, string> };
        };
        abortError.isAxiosError = true;

        if (!MockClient.setChatCompletionError) {
          throw new Error("mock missing setChatCompletionError");
        }

        MockClient.setChatCompletionError(abortError);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");
        const controller = new AbortController();

        await expect(
          model.doGenerate({ abortSignal: controller.signal, prompt }),
        ).rejects.toThrow();
      });
    });

    it("should pass tools to request config", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("What is 2+2?");

      const tools: LanguageModelV3FunctionTool[] = [
        {
          description: "Perform calculation",
          inputSchema: {
            properties: {
              expression: { type: "string" },
            },
            required: ["expression"],
            type: "object",
          },
          name: "calculate",
          type: "function",
        },
      ];

      const result = await model.doGenerate({ prompt, tools });

      expectRequestBodyHasMessagesAndNoWarnings(result);
    });

    it("should pass parallel_tool_calls when configured", async () => {
      const model = createModelForApi(api, "gpt-4o", {
        modelParams: {
          parallel_tool_calls: true,
        },
      });

      const prompt = createPrompt("Hi");

      const result = await model.doGenerate({ prompt });

      expectRequestBodyHasMessages(result);
    });

    it("should apply providerOptions.sap-ai overrides", async () => {
      const model = createModelForApi(api, "gpt-4o", {
        includeReasoning: false,
        modelParams: {
          temperature: 0.1,
        },
        modelVersion: "settings-version",
      });

      const prompt = createPrompt("Hi");

      const result = await model.doGenerate({
        prompt,
        providerOptions: {
          "sap-ai": {
            includeReasoning: true,
            modelParams: {
              temperature: 0.9,
            },
          },
        },
      });

      expectRequestBodyHasMessages(result);

      const request = await getLastRequestForApi(api);
      expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.9);
    });

    it("should map responseFormat json without schema to json_object", async () => {
      const model = createModelForApi(api);

      const prompt = createPrompt("Return JSON");

      const result = await model.doGenerate({
        prompt,
        responseFormat: { type: "json" },
      });

      expectRequestBodyHasMessages(result);

      const request = await getLastRequestForApi(api);

      expect(request.response_format).toEqual({ type: "json_object" });
    });

    it("should map responseFormat json with schema to json_schema", async () => {
      const model = createModelForApi(api);

      const prompt = createPrompt("Return JSON");

      const schema = {
        additionalProperties: false,
        properties: {
          answer: { type: "string" as const },
        },
        required: ["answer"],
        type: "object" as const,
      };

      const result = await model.doGenerate({
        prompt,
        responseFormat: {
          description: "A structured response",
          name: "response",
          schema,
          type: "json",
        },
      });

      expectRequestBodyHasMessages(result);

      const request = await getLastRequestForApi(api);

      expect(request.response_format).toEqual({
        json_schema: {
          description: "A structured response",
          name: "response",
          schema,
          strict: null,
        },
        type: "json_schema",
      });
    });

    it("should use settings.responseFormat as fallback when options.responseFormat is not provided", async () => {
      const model = createModelForApi(api, "gpt-4o", {
        responseFormat: {
          json_schema: {
            description: "Settings-level schema",
            name: "settings_response",
            schema: { properties: { value: { type: "string" } }, type: "object" },
            strict: true,
          },
          type: "json_schema",
        },
      });

      const prompt = createPrompt("Return JSON");

      await model.doGenerate({ prompt });

      const request = await getLastRequestForApi(api);

      expect(request.response_format).toEqual({
        json_schema: {
          description: "Settings-level schema",
          name: "settings_response",
          schema: { properties: { value: { type: "string" } }, type: "object" },
          strict: true,
        },
        type: "json_schema",
      });
    });

    it("should prefer options.responseFormat over settings.responseFormat", async () => {
      const model = createModelForApi(api, "gpt-4o", {
        responseFormat: {
          json_schema: {
            description: "Settings-level schema",
            name: "settings_response",
            schema: { properties: { value: { type: "string" } }, type: "object" },
          },
          type: "json_schema",
        },
      });

      const prompt = createPrompt("Return JSON");

      const optionsSchema = {
        additionalProperties: false,
        properties: { answer: { type: "string" as const } },
        required: ["answer"],
        type: "object" as const,
      };

      await model.doGenerate({
        prompt,
        responseFormat: {
          description: "Options-level schema",
          name: "options_response",
          schema: optionsSchema,
          type: "json",
        },
      });

      const request = await getLastRequestForApi(api);

      expect(request.response_format).toEqual({
        json_schema: {
          description: "Options-level schema",
          name: "options_response",
          schema: optionsSchema,
          strict: null,
        },
        type: "json_schema",
      });
    });

    it("should warn about unsupported tool types", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const tools = [
        {
          args: {},
          id: "custom-tool",
          type: "provider-defined" as const,
        },
      ];

      const result = await model.doGenerate({
        prompt,
        tools: tools as unknown as LanguageModelV3ProviderTool[],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]?.type).toBe("unsupported");
    });

    it("should warn when tool Zod schema conversion fails", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Use a tool");

      const zodLikeThatThrows = {
        _def: {},
        parse: () => undefined,
        toJSON: () => {
          throw new Error("conversion failed");
        },
      };

      const tools: LanguageModelV3FunctionTool[] = [
        {
          description: "Tool with failing Zod schema conversion",
          inputSchema: {},
          name: "badTool",
          parameters: zodLikeThatThrows,
          type: "function",
        } as unknown as LanguageModelV3FunctionTool,
      ];

      const result = await model.doGenerate({ prompt, tools });

      expectRequestBodyHasMessages(result);
    });

    it("should include tool calls in doGenerate response content", async () => {
      const MockClient = await getMockClientForApi(api);
      if (!MockClient.setChatCompletionResponse) {
        throw new Error("mock missing setChatCompletionResponse");
      }

      MockClient.setChatCompletionResponse(
        createMockChatResponse({
          content: null,
          finishReason: "tool_calls",
          headers: { "x-request-id": "tool-call-test" },
          toolCalls: [
            {
              function: {
                arguments: '{"location":"Paris"}',
                name: "get_weather",
              },
              id: "call_123",
            },
          ],
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      );

      const model = createModelForApi(api);
      const prompt = createPrompt("What's the weather?");

      const result = await model.doGenerate({ prompt });

      expect(result.content).toContainEqual({
        input: '{"location":"Paris"}',
        toolCallId: "call_123",
        toolName: "get_weather",
        type: "tool-call",
      });
      expect(result.finishReason).toEqual({
        raw: "tool_calls",
        unified: "tool-calls",
      });
    });

    it.each([
      {
        description: "normalize array header values",
        expected: {
          "x-multi-value": "value1; value2",
          "x-request-id": "array-header-test",
        },
        headers: {
          "x-multi-value": ["value1", "value2"],
          "x-request-id": "array-header-test",
        },
      },
      {
        description: "convert numeric header values to strings",
        expected: {
          "content-length": "1024",
          "x-retry-after": "30",
        },
        headers: {
          "content-length": 1024,
          "x-retry-after": 30,
        },
      },
      {
        description: "skip unsupported header value types",
        expected: {
          "x-valid": "keep-this",
        },
        headers: {
          "x-object": { nested: "object" },
          "x-valid": "keep-this",
        },
      },
      {
        description: "filter non-string values from array headers",
        expected: {
          "x-mixed": "valid; also-valid",
        },
        headers: {
          "x-mixed": ["valid", 123, null, "also-valid"],
        },
      },
      {
        description: "exclude array headers with only non-string items",
        expected: {
          "x-valid": "keep-this",
        },
        headers: {
          "x-invalid-array": [123, null, undefined],
          "x-valid": "keep-this",
        },
      },
    ])("should $description in doGenerate response", async ({ expected, headers }) => {
      const MockClient = await getMockClientForApi(api);
      if (!MockClient.setChatCompletionResponse) {
        throw new Error("mock missing setChatCompletionResponse");
      }

      MockClient.setChatCompletionResponse(
        createMockChatResponse({
          content: "Response",
          finishReason: "stop",
          headers,
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      );

      const model = createModelForApi(api);
      const prompt = createPrompt("Test");
      const result = await model.doGenerate({ prompt });

      expect(result.response?.headers).toEqual(expected);
    });

    it("should include response body in doGenerate result", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const result = await model.doGenerate({ prompt });

      expect(result.response?.body).toBeDefined();
      expect(result.response?.body).toHaveProperty("content");
      expect(result.response?.body).toHaveProperty("tokenUsage");
      expect(result.response?.body).toHaveProperty("finishReason");
    });

    it("should handle large non-streaming responses without truncation (100KB+)", async () => {
      const MockClient = await getMockClientForApi(api);
      if (!MockClient.setChatCompletionResponse) {
        throw new Error("mock missing setChatCompletionResponse");
      }

      const largeContent = "B".repeat(100000) + "[END_MARKER]";

      MockClient.setChatCompletionResponse(
        createMockChatResponse({
          content: largeContent,
          finishReason: "stop",
          usage: { completion_tokens: 25000, prompt_tokens: 10, total_tokens: 25010 },
        }),
      );

      const model = createModelForApi(api);
      const prompt = createPrompt("Generate a very long response");

      const result = await model.doGenerate({ prompt });

      const textContent = result.content.find(
        (c): c is { text: string; type: "text" } => c.type === "text",
      );
      expect(textContent).toBeDefined();
      const text = textContent?.text ?? "";
      expect(text).toBe(largeContent);
      expect(text).toHaveLength(100000 + "[END_MARKER]".length);
      expect(text).toContain("[END_MARKER]");
    });

    it("should handle tool calls with large JSON arguments without truncation", async () => {
      const MockClient = await getMockClientForApi(api);
      if (!MockClient.setChatCompletionResponse) {
        throw new Error("mock missing setChatCompletionResponse");
      }

      const largeArgs = JSON.stringify({
        finalMarker: "COMPLETE",
        items: Array.from({ length: 500 }, (_, i) => ({
          content: "C".repeat(100),
          id: i,
        })),
      });

      MockClient.setChatCompletionResponse(
        createMockChatResponse({
          content: null,
          finishReason: "tool_calls",
          toolCalls: [{ function: { arguments: largeArgs, name: "large_tool" }, id: "call_large" }],
          usage: { completion_tokens: 10000, prompt_tokens: 10, total_tokens: 10010 },
        }),
      );

      const model = createModelForApi(api);
      const prompt = createPrompt("Call a tool");

      const result = await model.doGenerate({ prompt });

      const toolCallContent = result.content.filter(
        (c): c is { input: string; toolCallId: string; toolName: string; type: "tool-call" } =>
          c.type === "tool-call",
      );
      expect(toolCallContent).toHaveLength(1);
      const firstToolCall = toolCallContent[0];
      expect(firstToolCall).toBeDefined();
      expect(firstToolCall?.toolName).toBe("large_tool");

      const parsedArgs = JSON.parse(firstToolCall?.input ?? "{}") as {
        finalMarker: string;
        items: { id: number }[];
      };
      expect(parsedArgs.items).toHaveLength(500);
      expect(parsedArgs.finalMarker).toBe("COMPLETE");
    });
  });

  describe.each<APIType>(["orchestration", "foundation-models"])("doStream (%s API)", (api) => {
    beforeEach(async () => {
      await resetMockStateForApi(api);
    });

    /**
     * Reads all parts from a language model stream.
     * @param stream - The stream to read from.
     * @returns An array of all stream parts.
     */
    async function readAllParts(stream: ReadableStream<LanguageModelV3StreamPart>) {
      const parts: LanguageModelV3StreamPart[] = [];
      const reader = stream.getReader();

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      return parts;
    }

    it("should stream basic text (edge-runtime compatible)", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const reader = stream.getReader();

      const parts: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
      }

      expect(parts.some((p) => (p as { type?: string }).type === "stream-start")).toBe(true);
      expect(parts.some((p) => (p as { type?: string }).type === "finish")).toBe(true);
    });

    it("should not mutate stream-start warnings when warnings occur during stream", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: {
                arguments: '{"x":1}',
              },
              id: "toolcall-0",
              index: 0,
            },
          ],
          finishReason: "tool_calls",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 1,
            total_tokens: 2,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const result = await model.doStream({ prompt });

      const parts = await readAllParts(result.stream);
      const streamStart = parts.find((part) => part.type === "stream-start");
      expect(streamStart?.warnings).toHaveLength(0);
    });

    it("should not emit text deltas after tool-call deltas", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: "Hello",
        }),
        createMockStreamChunk({
          deltaContent: " SHOULD_NOT_APPEAR",
          deltaToolCalls: [
            {
              function: { arguments: '{"x":', name: "calc" },
              id: "call_0",
              index: 0,
            },
          ],
        }),
        createMockStreamChunk({
          deltaContent: " ALSO_SHOULD_NOT_APPEAR",
          deltaToolCalls: [
            {
              function: { arguments: "1}" },
              id: "call_0",
              index: 0,
            },
          ],
          finishReason: "tool_calls",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      expect(textDeltas).toHaveLength(1);
      expect((textDeltas[0] as { delta: string }).delta).toBe("Hello");
    });

    it("should stream text response", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: "Hello",
        }),
        createMockStreamChunk({
          deltaContent: "!",
          finishReason: "stop",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(parts[0]?.type).toBe("stream-start");
      const responseMetadata = parts.find((p) => p.type === "response-metadata");
      expect(responseMetadata).toEqual({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        id: expect.stringMatching(uuidRegex),
        modelId: "gpt-4o",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        timestamp: expect.any(Date),
        type: "response-metadata",
      });
      expect(parts.some((p) => p.type === "text-delta")).toBe(true);
      expect(parts.some((p) => p.type === "finish")).toBe(true);

      const finishPart = parts.find((p) => p.type === "finish");
      expect(finishPart).toBeDefined();
      if (finishPart?.type === "finish") {
        expect(finishPart.finishReason).toEqual({ raw: "stop", unified: "stop" });
        expect(finishPart.providerMetadata).toEqual({
          "sap-ai": {
            finishReason: "stop",
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            responseId: expect.stringMatching(uuidRegex),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            version: expect.any(String),
          },
        });
      }
    });

    it("should emit raw chunks when includeRawChunks is true", async () => {
      const rawData1 = { custom: "data1", delta: "Hello" };
      const rawData2 = { custom: "data2", delta: "!" };

      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          _data: rawData1,
          deltaContent: "Hello",
        }),
        createMockStreamChunk({
          _data: rawData2,
          deltaContent: "!",
          finishReason: "stop",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ includeRawChunks: true, prompt });
      const parts = await readAllParts(stream);
      const rawParts = parts.filter((p) => p.type === "raw");

      expect(rawParts).toHaveLength(2);
      expect(rawParts[0]).toEqual({ rawValue: rawData1, type: "raw" });
      expect(rawParts[1]).toEqual({ rawValue: rawData2, type: "raw" });
    });

    it("should not emit raw chunks when includeRawChunks is false or omitted", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          _data: { some: "data" },
          deltaContent: "Hello",
        }),
        createMockStreamChunk({
          _data: { more: "data" },
          deltaContent: "!",
          finishReason: "stop",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream: stream1 } = await model.doStream({ prompt });
      const parts1 = await readAllParts(stream1);
      expect(parts1.filter((p) => p.type === "raw")).toHaveLength(0);

      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          _data: { some: "data" },
          deltaContent: "Hello",
          finishReason: "stop",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const { stream: stream2 } = await model.doStream({ includeRawChunks: false, prompt });
      const parts2 = await readAllParts(stream2);
      expect(parts2.filter((p) => p.type === "raw")).toHaveLength(0);
    });

    it("should use chunk itself as rawValue when _data is undefined", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: "Hello",
          finishReason: "stop",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ includeRawChunks: true, prompt });
      const parts = await readAllParts(stream);

      const rawParts = parts.filter((p) => p.type === "raw");
      expect(rawParts).toHaveLength(1);

      const rawPart = rawParts[0] as { rawValue: unknown; type: "raw" };
      expect(rawPart.rawValue).toHaveProperty("getDeltaContent");
      expect(rawPart.rawValue).toHaveProperty("getFinishReason");
    });

    it("should flush tool calls immediately on tool-calls finishReason", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: '{"city":', name: "get_weather" },
              id: "call_0",
              index: 0,
            },
          ],
        }),
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: '"Paris"}' },
              id: "call_0",
              index: 0,
            },
          ],
          finishReason: "tool_calls",
          usage: {
            completion_tokens: 5,
            prompt_tokens: 10,
            total_tokens: 15,
          },
        }),
        createMockStreamChunk({ deltaContent: "SHOULD_NOT_APPEAR" }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Use tool");

      const result = await model.doStream({ prompt });
      const parts = await readAllParts(result.stream);

      const toolCallIndex = parts.findIndex((p) => p.type === "tool-call");
      const finishIndex = parts.findIndex((p) => p.type === "finish");

      expect(toolCallIndex).toBeGreaterThan(-1);
      expect(finishIndex).toBeGreaterThan(toolCallIndex);

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      const hasPostToolTextDelta = textDeltas.some(
        (td) => (td as { delta: string; type: "text-delta" }).delta === "SHOULD_NOT_APPEAR",
      );
      expect(hasPostToolTextDelta).toBe(false);
    });

    it.each([
      {
        description: "max_tokens_reached as length",
        expected: "length",
        input: "max_tokens_reached",
      },
      { description: "length", expected: "length", input: "length" },
      { description: "eos as stop", expected: "stop", input: "eos" },
      {
        description: "stop_sequence as stop",
        expected: "stop",
        input: "stop_sequence",
      },
      { description: "end_turn as stop", expected: "stop", input: "end_turn" },
      {
        description: "content_filter",
        expected: "content-filter",
        input: "content_filter",
      },
      { description: "error", expected: "error", input: "error" },
      {
        description: "max_tokens as length",
        expected: "length",
        input: "max_tokens",
      },
      {
        description: "tool_call as tool-calls",
        expected: "tool-calls",
        input: "tool_call",
      },
      {
        description: "function_call as tool-calls",
        expected: "tool-calls",
        input: "function_call",
      },
      {
        description: "unknown reason as other",
        expected: "other",
        input: "some_new_unknown_reason",
      },
      {
        description: "undefined as other",
        expected: "other",
        input: undefined,
      },
    ])("should handle stream with finish reason: $description", async ({ expected, input }) => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: "test content",
          finishReason: input,
          usage: {
            completion_tokens: 2,
            prompt_tokens: 1,
            total_tokens: 3,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const finishPart = parts.find((p) => p.type === "finish");
      expect(finishPart).toBeDefined();
      if (finishPart?.type === "finish") {
        expect(finishPart.finishReason.unified).toBe(expected);
        expect(finishPart.finishReason.raw).toBe(input);
      }
    });

    it("should omit tools and response_format when not provided", async () => {
      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const result = await model.doGenerate({ prompt });
      expectRequestBodyHasMessages(result);

      const request = await getLastRequestForApi(api);
      expectToOmitKeys(request, ["tools", "response_format"]);
    });

    it("should handle stream chunks with null content", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({}),
        createMockStreamChunk({
          deltaContent: "Hello",
        }),
        createMockStreamChunk({
          finishReason: "stop",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 10,
            total_tokens: 11,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      expect(textDeltas).toHaveLength(1);
      expect((textDeltas[0] as { delta: string }).delta).toBe("Hello");

      const finishPart = parts.find((p) => p.type === "finish");
      expect(finishPart).toBeDefined();
    });

    it("should handle stream with empty string content", async () => {
      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: "",
        }),
        createMockStreamChunk({
          deltaContent: "Response",
          finishReason: "stop",
          usage: {
            completion_tokens: 1,
            prompt_tokens: 10,
            total_tokens: 11,
          },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Hello");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");
      expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle large streaming responses without truncation (120KB across 12 chunks)", async () => {
      const chunkSize = 10000;
      const numChunks = 12;
      const chunks = Array.from({ length: numChunks }, (_, i) => {
        const isLast = i === numChunks - 1;
        const content =
          i === numChunks - 1 ? "D".repeat(chunkSize) + "[STREAM_END]" : "D".repeat(chunkSize);
        return createMockStreamChunk({
          deltaContent: content,
          finishReason: isLast ? "stop" : null,
          usage: isLast
            ? { completion_tokens: 30000, prompt_tokens: 10, total_tokens: 30010 }
            : undefined,
        });
      });

      await setStreamChunksForApi(api, chunks);

      const model = createModelForApi(api);
      const prompt = createPrompt("Generate a very long streaming response");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");

      const fullText = textDeltas.map((td) => (td as { delta: string }).delta).join("");
      expect(fullText).toHaveLength(
        chunkSize * (numChunks - 1) + chunkSize + "[STREAM_END]".length,
      );
      expect(fullText).toContain("[STREAM_END]");
      expect(fullText.startsWith("D".repeat(100))).toBe(true);
    });

    it("should handle streaming tool calls with large JSON arguments without truncation (~50KB)", async () => {
      const largeArgs = JSON.stringify({
        items: Array.from({ length: 400 }, (_, i) => ({
          data: "E".repeat(100),
          id: i,
        })),
        marker: "TOOL_COMPLETE",
      });

      const argPart1 = largeArgs.slice(0, Math.floor(largeArgs.length / 3));
      const argPart2 = largeArgs.slice(
        Math.floor(largeArgs.length / 3),
        Math.floor((2 * largeArgs.length) / 3),
      );
      const argPart3 = largeArgs.slice(Math.floor((2 * largeArgs.length) / 3));

      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: argPart1, name: "large_stream_tool" },
              id: "call_large_stream",
              index: 0,
            },
          ],
        }),
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: argPart2 },
              index: 0,
            },
          ],
        }),
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: argPart3 },
              index: 0,
            },
          ],
          finishReason: "tool_calls",
          usage: { completion_tokens: 12000, prompt_tokens: 10, total_tokens: 12010 },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Call a tool with large arguments");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const toolCallPart = parts.find(
        (p): p is { input: string; toolCallId: string; toolName: string; type: "tool-call" } =>
          p.type === "tool-call",
      );

      expect(toolCallPart).toBeDefined();
      expect(toolCallPart?.toolName).toBe("large_stream_tool");
      expect(toolCallPart?.toolCallId).toBe("call_large_stream");

      const parsedArgs = JSON.parse(toolCallPart?.input ?? "{}") as {
        items: { id: number }[];
        marker: string;
      };
      expect(parsedArgs.items).toHaveLength(400);
      expect(parsedArgs.marker).toBe("TOOL_COMPLETE");
    });

    it("should handle multiple concurrent tool calls with large arguments", async () => {
      const largeArgs1 = JSON.stringify({
        id: "first",
        query: "F".repeat(5000),
      });
      const largeArgs2 = JSON.stringify({
        id: "second",
        query: "G".repeat(5000),
      });

      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: largeArgs1.slice(0, 3000), name: "tool_one" },
              id: "call_1",
              index: 0,
            },
            {
              function: { arguments: largeArgs2.slice(0, 3000), name: "tool_two" },
              id: "call_2",
              index: 1,
            },
          ],
        }),
        createMockStreamChunk({
          deltaToolCalls: [
            {
              function: { arguments: largeArgs1.slice(3000) },
              index: 0,
            },
            {
              function: { arguments: largeArgs2.slice(3000) },
              index: 1,
            },
          ],
          finishReason: "tool_calls",
          usage: { completion_tokens: 3000, prompt_tokens: 10, total_tokens: 3010 },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Call multiple tools");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const toolCalls = parts.filter(
        (p): p is { input: string; toolCallId: string; toolName: string; type: "tool-call" } =>
          p.type === "tool-call",
      );

      expect(toolCalls).toHaveLength(2);

      const tool1 = toolCalls.find((tc) => tc.toolName === "tool_one");
      const tool2 = toolCalls.find((tc) => tc.toolName === "tool_two");

      expect(tool1).toBeDefined();
      expect(tool2).toBeDefined();

      const parsed1 = JSON.parse(tool1?.input ?? "{}") as { id: string; query: string };
      const parsed2 = JSON.parse(tool2?.input ?? "{}") as { id: string; query: string };

      expect(parsed1.id).toBe("first");
      expect(parsed1.query).toHaveLength(5000);
      expect(parsed2.id).toBe("second");
      expect(parsed2.query).toHaveLength(5000);
    });

    it("should handle Unicode and multi-byte characters in large streams without corruption", async () => {
      const unicodeContent =
        "Hello 世界! 🌍🌎🌏 Привет мир! مرحبا بالعالم " +
        "日本語テスト " +
        "한국어 테스트 " +
        "🎉".repeat(100) +
        " [UNICODE_END]";

      await setStreamChunksForApi(api, [
        createMockStreamChunk({
          deltaContent: unicodeContent.slice(0, 50),
        }),
        createMockStreamChunk({
          deltaContent: unicodeContent.slice(50, 150),
        }),
        createMockStreamChunk({
          deltaContent: unicodeContent.slice(150),
          finishReason: "stop",
          usage: { completion_tokens: 500, prompt_tokens: 10, total_tokens: 510 },
        }),
      ]);

      const model = createModelForApi(api);
      const prompt = createPrompt("Generate Unicode content");

      const { stream } = await model.doStream({ prompt });
      const parts = await readAllParts(stream);

      const textDeltas = parts.filter((p) => p.type === "text-delta");

      const fullText = textDeltas.map((td) => (td as { delta: string }).delta).join("");
      expect(fullText).toBe(unicodeContent);
      expect(fullText).toContain("世界");
      expect(fullText).toContain("🌍");
      expect(fullText).toContain("Привет");
      expect(fullText).toContain("مرحبا");
      expect(fullText).toContain("[UNICODE_END]");
    });

    describe("error handling", () => {
      it("should warn when tool call delta has no tool name", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaToolCalls: [
              {
                function: { arguments: '{"x":1}' },
                id: "call_nameless",
                index: 0,
              },
            ],
            finishReason: "tool_calls",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Use tool");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const toolCall = parts.find((p) => p.type === "tool-call");
        expect(toolCall).toBeDefined();
        expect(toolCall).toEqual({
          input: '{"x":1}',
          toolCallId: "call_nameless",
          toolName: "",
          type: "tool-call",
        });

        const streamStart = parts.find(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "stream-start" }> =>
            p.type === "stream-start",
        );
        expect(streamStart).toBeDefined();
        expect(streamStart?.warnings).toHaveLength(0);

        expect(parts.some((p) => p.type === "error")).toBe(false);
        expect(parts.some((p) => p.type === "finish")).toBe(true);

        const finish = parts.find(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "finish" }> => p.type === "finish",
        );
        expect(finish?.finishReason).toBeDefined();
      });

      it("should emit error part when stream iteration throws", async () => {
        const MockClient = await getMockClientForApi(api);
        if (!MockClient.setStreamError) {
          throw new Error("mock missing setStreamError");
        }

        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaContent: "Hello",
          }),
        ]);
        const axiosError = new Error("Stream iteration failed") as unknown as {
          isAxiosError: boolean;
          response: { headers: Record<string, string> };
        };
        axiosError.isAxiosError = true;
        axiosError.response = {
          headers: {
            "x-request-id": "stream-axios-123",
          },
        };

        MockClient.setStreamError(axiosError as unknown as Error);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const textDelta = parts.find((p) => p.type === "text-delta");
        expect(textDelta).toBeDefined();

        const errorPart = parts.find((p) => p.type === "error");
        expect(errorPart).toBeDefined();
        expect(errorPart).toMatchObject({
          type: "error",
        });
        expect((errorPart as { error: Error }).error.message).toEqual(
          expect.stringContaining("Stream iteration failed"),
        );
        expect(
          (errorPart as { error: { responseHeaders?: unknown } }).error.responseHeaders,
        ).toMatchObject({
          "x-request-id": "stream-axios-123",
        });

        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaContent: "reset",
            finishReason: "stop",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);
      });

      it("should skip tool call deltas with invalid index", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaContent: "Hello",
            deltaToolCalls: [
              {
                function: { arguments: "{}", name: "test_tool" },
                id: "call_invalid",
                index: NaN,
              },
            ],
          }),
          createMockStreamChunk({
            deltaToolCalls: [
              {
                function: { arguments: "{}", name: "other_tool" },
                id: "call_undefined",
                index: undefined as unknown as number,
              },
            ],
            finishReason: "stop",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        expect(parts.some((p) => p.type === "finish")).toBe(true);
        expect(parts.some((p) => p.type === "tool-call")).toBe(false);
      });

      it("should generate unique RFC 4122 UUIDs for text blocks", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaContent: "First text block",
          }),
          createMockStreamChunk({
            deltaContent: " continuation",
            finishReason: "stop",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Test");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const textStarts = parts.filter(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "text-start" }> =>
            p.type === "text-start",
        );
        const textDeltas = parts.filter(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "text-delta" }> =>
            p.type === "text-delta",
        );
        const textEnds = parts.filter(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "text-end" }> =>
            p.type === "text-end",
        );

        expect(textStarts).toHaveLength(1);
        expect(textEnds).toHaveLength(1);
        expect(textDeltas.length).toBeGreaterThan(0);

        const blockId = textStarts[0]?.id;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(blockId).toMatch(uuidRegex);
        expect(blockId).not.toBe("0");

        for (const delta of textDeltas) {
          expect(delta.id).toBe(blockId);
        }
        expect(textEnds[0]?.id).toBe(blockId);

        const { stream: stream2 } = await model.doStream({ prompt });
        const parts2 = await readAllParts(stream2);

        const textStarts2 = parts2.filter(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "text-start" }> =>
            p.type === "text-start",
        );

        const blockId2 = textStarts2[0]?.id;

        expect(blockId2).not.toBe(blockId);
        expect(blockId2).toMatch(uuidRegex);
      });

      it("should flush unflushed tool calls at stream end (with finishReason=stop)", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaToolCalls: [
              {
                function: { arguments: '{"q":"test"}', name: "get_info" },
                id: "call_unflushed",
                index: 0,
              },
            ],
          }),
          createMockStreamChunk({
            finishReason: "stop",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Test");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const toolCall = parts.find((p) => p.type === "tool-call");
        expect(toolCall).toBeDefined();
        expect(toolCall).toEqual({
          input: '{"q":"test"}',
          toolCallId: "call_unflushed",
          toolName: "get_info",
          type: "tool-call",
        });

        const finish = parts.find(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "finish" }> => p.type === "finish",
        );
        expect(finish?.finishReason).toEqual({ raw: "stop", unified: "stop" });
      });

      it("should handle undefined finish reason from stream", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaContent: "Hello",
            finishReason: undefined as unknown as string,
          }),
          createMockStreamChunk({
            deltaContent: "!",
            finishReason: undefined as unknown as string,
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const finish = parts.find(
          (p): p is Extract<LanguageModelV3StreamPart, { type: "finish" }> => p.type === "finish",
        );
        expect(finish?.finishReason).toEqual({
          raw: undefined,
          unified: "other",
        });
      });

      it("should flush tool calls that never received input-start", async () => {
        await setStreamChunksForApi(api, [
          createMockStreamChunk({
            deltaToolCalls: [
              {
                function: { arguments: '{"partial":' },
                id: "call_no_start",
                index: 0,
              },
            ],
          }),
          createMockStreamChunk({
            deltaToolCalls: [
              {
                function: { arguments: '"value"}', name: "delayed_name" },
                index: 0,
              },
            ],
            finishReason: "tool_calls",
            usage: {
              completion_tokens: 5,
              prompt_tokens: 10,
              total_tokens: 15,
            },
          }),
        ]);

        const model = createModelForApi(api);
        const prompt = createPrompt("Test");

        const { stream } = await model.doStream({ prompt });
        const parts = await readAllParts(stream);

        const toolCall = parts.find((p) => p.type === "tool-call");
        expect(toolCall).toBeDefined();
        expect(toolCall).toEqual({
          input: '{"partial":"value"}',
          toolCallId: "call_no_start",
          toolName: "delayed_name",
          type: "tool-call",
        });
      });

      it("should throw converted error when doStream setup fails", async () => {
        const MockClient = await getMockClientForApi(api);
        if (!MockClient.setStreamSetupError) {
          throw new Error("mock missing setStreamSetupError");
        }

        const setupError = new Error("Stream setup failed");
        MockClient.setStreamSetupError(setupError);

        const model = createModelForApi(api);
        const prompt = createPrompt("Hello");

        await expect(model.doStream({ prompt })).rejects.toThrow("Stream setup failed");
      });
    });
  });

  describe("configuration", () => {
    describe("masking and filtering", () => {
      it.each([
        { property: "masking", settings: { masking: {} } },
        { property: "filtering", settings: { filtering: {} } },
      ])("should omit $property when empty object", async ({ property, settings }) => {
        const model = createOrchModel("gpt-4o", settings);

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).not.toHaveProperty(property);
      });

      it("should include masking module in orchestration config", async () => {
        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-email" }, { type: "profile-phone" }],
              method: "anonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const model = createOrchModel("gpt-4o", {
          masking,
        });

        const prompt = createPrompt("My email is test@example.com");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
      });

      it("should include filtering module in orchestration config", async () => {
        const filtering = {
          input: {
            filters: [
              {
                config: {
                  Hate: 0,
                  SelfHarm: 0,
                  Sexual: 0,
                  Violence: 0,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });

      it("should include both masking and filtering when configured", async () => {
        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-person" }],
              method: "pseudonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const filtering = {
          output: {
            filters: [
              {
                config: {
                  Hate: 2,
                  SelfHarm: 2,
                  Sexual: 2,
                  Violence: 2,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
          masking,
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });

      it("should include grounding module in orchestration config", async () => {
        const grounding = {
          config: {
            filters: [
              {
                chunk_ids: [],
                data_repositories: ["*"],
                document_names: ["product-docs"],
                id: "vector-store-1",
              },
            ],
            metadata_params: ["file_name"],
            placeholders: {
              input: ["?question"],
              output: "groundingOutput",
            },
          },
          type: "document_grounding_service",
        };

        const model = createOrchModel("gpt-4o", {
          grounding,
        });

        const prompt = createPrompt("What is SAP AI Core?");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("grounding");
        expect(request.grounding).toEqual(grounding);
      });

      it("should include translation module in orchestration config", async () => {
        const translation = {
          input: {
            source_language: "de",
            target_language: "en",
          },
          output: {
            target_language: "de",
          },
        };

        const model = createOrchModel("gpt-4o", {
          translation,
        });

        const prompt = createPrompt("Was ist SAP AI Core?");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("translation");
        expect(request.translation).toEqual(translation);
      });

      it.each([
        { property: "grounding", settings: { grounding: {} } },
        { property: "translation", settings: { translation: {} } },
      ])("should omit $property when empty object", async ({ property, settings }) => {
        const model = createOrchModel("gpt-4o", settings);

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).not.toHaveProperty(property);
      });

      it("should include grounding, translation, masking and filtering together", async () => {
        const grounding = {
          config: {
            filters: [
              {
                chunk_ids: [],
                data_repositories: ["*"],
                document_names: [],
                id: "vector-store-1",
              },
            ],
            placeholders: {
              input: ["?question"],
              output: "groundingOutput",
            },
          },
          type: "document_grounding_service",
        };

        const translation = {
          input: {
            source_language: "fr",
            target_language: "en",
          },
        };

        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-email" }],
              method: "anonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const filtering = {
          input: {
            filters: [
              {
                config: {
                  Hate: 0,
                  SelfHarm: 0,
                  Sexual: 0,
                  Violence: 0,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
          grounding,
          masking,
          translation,
        });

        const prompt = createPrompt("Quelle est SAP AI Core?");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("grounding");
        expect(request.grounding).toEqual(grounding);
        expect(request).toHaveProperty("translation");
        expect(request.translation).toEqual(translation);
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });

      it("should include masking module in stream request body", async () => {
        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-email" }, { type: "profile-phone" }],
              method: "anonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const model = createOrchModel("gpt-4o", {
          masking,
        });

        const prompt = createPrompt("My email is test@example.com");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
      });

      it("should include filtering module in stream request body", async () => {
        const filtering = {
          input: {
            filters: [
              {
                config: {
                  Hate: 0,
                  SelfHarm: 0,
                  Sexual: 0,
                  Violence: 0,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });

      it("should include both masking and filtering in stream request body", async () => {
        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-person" }],
              method: "pseudonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const filtering = {
          output: {
            filters: [
              {
                config: {
                  Hate: 2,
                  SelfHarm: 2,
                  Sexual: 2,
                  Violence: 2,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
          masking,
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });

      it("should include grounding module in stream request body", async () => {
        const grounding = {
          config: {
            filters: [
              {
                chunk_ids: [],
                data_repositories: ["*"],
                document_names: ["product-docs"],
                id: "vector-store-1",
              },
            ],
            metadata_params: ["file_name"],
            placeholders: {
              input: ["?question"],
              output: "groundingOutput",
            },
          },
          type: "document_grounding_service",
        };

        const model = createOrchModel("gpt-4o", {
          grounding,
        });

        const prompt = createPrompt("What is SAP AI Core?");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("grounding");
        expect(request.grounding).toEqual(grounding);
      });

      it("should include translation module in stream request body", async () => {
        const translation = {
          input: {
            source_language: "de",
            target_language: "en",
          },
          output: {
            target_language: "de",
          },
        };

        const model = createOrchModel("gpt-4o", {
          translation,
        });

        const prompt = createPrompt("Was ist SAP AI Core?");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("translation");
        expect(request.translation).toEqual(translation);
      });

      it("should include grounding, translation, masking and filtering together in stream request body", async () => {
        const grounding = {
          config: {
            filters: [
              {
                chunk_ids: [],
                data_repositories: ["*"],
                document_names: [],
                id: "vector-store-1",
              },
            ],
            placeholders: {
              input: ["?question"],
              output: "groundingOutput",
            },
          },
          type: "document_grounding_service",
        };

        const translation = {
          input: {
            source_language: "fr",
            target_language: "en",
          },
        };

        const masking = {
          masking_providers: [
            {
              entities: [{ type: "profile-email" }],
              method: "anonymization",
              type: "sap_data_privacy_integration",
            },
          ],
        };

        const filtering = {
          input: {
            filters: [
              {
                config: {
                  Hate: 0,
                  SelfHarm: 0,
                  Sexual: 0,
                  Violence: 0,
                },
                type: "azure_content_safety",
              },
            ],
          },
        };

        const model = createOrchModel("gpt-4o", {
          filtering,
          grounding,
          masking,
          translation,
        });

        const prompt = createPrompt("Quelle est SAP AI Core?");

        const result = await model.doStream({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();
        expect(request).toHaveProperty("grounding");
        expect(request.grounding).toEqual(grounding);
        expect(request).toHaveProperty("translation");
        expect(request.translation).toEqual(translation);
        expect(request).toHaveProperty("masking");
        expect(request.masking).toEqual(masking);
        expect(request).toHaveProperty("filtering");
        expect(request.filtering).toEqual(filtering);
      });
    });

    describe.each<APIType>(["orchestration", "foundation-models"])(
      "modelVersion propagation (%s API)",
      (api) => {
        beforeEach(async () => {
          await resetMockStateForApi(api);
        });

        it("should include modelVersion when configured", async () => {
          const modelVersion = "2024-05-13";
          const model = createModelForApi(api, "gpt-4o", { modelVersion });

          const prompt = createPrompt("Hello");
          await model.doGenerate({ prompt });

          if (api === "foundation-models") {
            const mockClient = await getMockFMClient();
            const constructorCall = mockClient.lastConstructorCall;
            expect(constructorCall).toBeDefined();
            expect(constructorCall?.modelDeployment).toHaveProperty("modelVersion", modelVersion);
          } else {
            const request = await getLastOrchRequest();
            expect(request.model?.version).toBe(modelVersion);
          }
        });

        it("should not include modelVersion when not configured", async () => {
          const model = createModelForApi(api, "gpt-4o");

          const prompt = createPrompt("Hello");
          await model.doGenerate({ prompt });

          if (api === "foundation-models") {
            const mockClient = await getMockFMClient();
            const constructorCall = mockClient.lastConstructorCall;
            expect(constructorCall).toBeDefined();
            expect(constructorCall?.modelDeployment).not.toHaveProperty("modelVersion");
          } else {
            const request = await getLastOrchRequest();
            expect(request.model?.version).toBeUndefined();
          }
        });
      },
    );

    describe.each([
      { api: "orchestration" as APIType, apiName: "Orchestration" },
      { api: "foundation-models" as APIType, apiName: "Foundation Models" },
    ])("model parameters ($apiName API)", ({ api }) => {
      const optionOverrideTestCases = [
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          expectedKey: "temperature",
          expectedValue: 0.9,
          optionKey: "temperature",
          optionValue: 0.9,
          settingsKey: "temperature",
          settingsValue: 0.5,
          testName: "temperature",
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "maxTokens",
          expectedKey: "max_tokens",
          expectedValue: 1000,
          optionKey: "maxOutputTokens",
          optionValue: 1000,
          settingsKey: "maxTokens",
          settingsValue: 500,
          testName: "maxOutputTokens",
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "topP",
          expectedKey: "top_p",
          expectedValue: 0.9,
          optionKey: "topP",
          optionValue: 0.9,
          settingsKey: "topP",
          settingsValue: 0.5,
          testName: "topP",
        },
        {
          apis: ["orchestration"] as APIType[],
          camelCaseKey: "topK",
          expectedKey: "top_k",
          expectedValue: 40,
          optionKey: "topK",
          optionValue: 40,
          settingsKey: "topK",
          settingsValue: 20,
          testName: "topK",
        },
      ].filter((tc) => tc.apis.includes(api));

      it.each(optionOverrideTestCases)(
        "should prefer options.$testName over settings.modelParams.$settingsKey",
        async ({
          camelCaseKey,
          expectedKey,
          expectedValue,
          optionKey,
          optionValue,
          settingsKey,
          settingsValue,
        }) => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              [settingsKey]: settingsValue,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            [optionKey]: optionValue,
            prompt,
          });

          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, expectedKey)).toBe(expectedValue);

          if (camelCaseKey && camelCaseKey !== expectedKey) {
            expect(getModelParamFromRequest(api, request, camelCaseKey)).toBeUndefined();
          }
        },
      );

      const paramPassthroughTestCases = [
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "topP",
          expectedKey: "top_p",
          expectedValue: 0.9,
          paramName: "topP",
          paramValue: 0.9,
        },
        {
          apis: ["orchestration"] as APIType[],
          camelCaseKey: "topK",
          expectedKey: "top_k",
          expectedValue: 40,
          paramName: "topK",
          paramValue: 40,
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "frequencyPenalty",
          expectedKey: "frequency_penalty",
          expectedValue: 0.5,
          paramName: "frequencyPenalty",
          paramValue: 0.5,
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "presencePenalty",
          expectedKey: "presence_penalty",
          expectedValue: 0.3,
          paramName: "presencePenalty",
          paramValue: 0.3,
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "stopSequences",
          expectedKey: "stop",
          expectedValue: ["END", "STOP"],
          paramName: "stopSequences",
          paramValue: ["END", "STOP"],
        },
        {
          apis: ["orchestration", "foundation-models"] as APIType[],
          camelCaseKey: "seed",
          expectedKey: "seed",
          expectedValue: 42,
          paramName: "seed",
          paramValue: 42,
        },
      ].filter((tc) => tc.apis.includes(api));

      it.each(paramPassthroughTestCases)(
        "should pass $paramName from options to model params",
        async ({ camelCaseKey, expectedKey, expectedValue, paramName, paramValue }) => {
          const model = createModelForApi(api);
          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            [paramName]: paramValue,
            prompt,
          });

          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, expectedKey)).toEqual(expectedValue);

          if (camelCaseKey !== expectedKey) {
            expect(getModelParamFromRequest(api, request, camelCaseKey)).toBeUndefined();
          }
        },
      );
    });

    describe.each<APIType>(["orchestration", "foundation-models"])(
      "unknown parameter preservation (%s API)",
      (api) => {
        beforeEach(async () => {
          await resetMockStateForApi(api);
        });

        it("should preserve unknown parameters from settings.modelParams", async () => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              customParam: "custom-value",
              maxTokens: 100,
              temperature: 0.7,
              topP: 0.8,
              unknownField: 123,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({ prompt });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.7);
          expect(getModelParamFromRequest(api, request, "customParam")).toBe("custom-value");
          expect(getModelParamFromRequest(api, request, "unknownField")).toBe(123);

          expect(getModelParamFromRequest(api, request, "max_tokens")).toBe(100);
          expect(getModelParamFromRequest(api, request, "maxTokens")).toBeUndefined();
          expect(getModelParamFromRequest(api, request, "top_p")).toBe(0.8);
          expect(getModelParamFromRequest(api, request, "topP")).toBeUndefined();
        });

        it("should preserve unknown parameters from providerOptions", async () => {
          const model = createModelForApi(api, "gpt-4o");

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            prompt,
            providerOptions: {
              "sap-ai": {
                modelParams: {
                  customProviderParam: "provider-value",
                  frequencyPenalty: 0.7,
                  presencePenalty: 0.2,
                  specialField: true,
                  temperature: 0.5,
                },
              },
            },
          });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.5);
          expect(getModelParamFromRequest(api, request, "customProviderParam")).toBe(
            "provider-value",
          );
          expect(getModelParamFromRequest(api, request, "specialField")).toBe(true);

          expect(getModelParamFromRequest(api, request, "frequency_penalty")).toBe(0.7);
          expect(getModelParamFromRequest(api, request, "frequencyPenalty")).toBeUndefined();
          expect(getModelParamFromRequest(api, request, "presence_penalty")).toBe(0.2);
          expect(getModelParamFromRequest(api, request, "presencePenalty")).toBeUndefined();
        });

        it("should merge unknown parameters from settings and providerOptions", async () => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              fromSettings: "settings-value",
              maxTokens: 800,
              sharedParam: "from-settings",
              temperature: 0.3,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            prompt,
            providerOptions: {
              "sap-ai": {
                modelParams: {
                  fromProvider: "provider-value",
                  sharedParam: "from-provider",
                  topP: 0.95,
                },
              },
            },
          });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.3);
          expect(getModelParamFromRequest(api, request, "fromSettings")).toBe("settings-value");
          expect(getModelParamFromRequest(api, request, "fromProvider")).toBe("provider-value");
          expect(getModelParamFromRequest(api, request, "sharedParam")).toBe("from-provider");

          expect(getModelParamFromRequest(api, request, "max_tokens")).toBe(800);
          expect(getModelParamFromRequest(api, request, "maxTokens")).toBeUndefined();
          expect(getModelParamFromRequest(api, request, "top_p")).toBe(0.95);
          expect(getModelParamFromRequest(api, request, "topP")).toBeUndefined();
        });

        it("should deep merge nested objects in modelParams", async () => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              nested: {
                a: 1,
                b: {
                  c: 2,
                  d: 3,
                },
              },
              temperature: 0.5,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            prompt,
            providerOptions: {
              "sap-ai": {
                modelParams: {
                  nested: {
                    b: {
                      d: 4,
                      e: 5,
                    },
                    f: 6,
                  },
                },
              },
            },
          });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.5);
          expect(getModelParamFromRequest(api, request, "nested")).toEqual({
            a: 1,
            b: {
              c: 2,
              d: 4,
              e: 5,
            },
            f: 6,
          });
        });

        it("should allow AI SDK standard options to override unknown params", async () => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              customParam: "custom-value",
              temperature: 0.3,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({
            maxOutputTokens: 500,
            prompt,
            temperature: 0.8,
          });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.8);
          expect(getModelParamFromRequest(api, request, "max_tokens")).toBe(500);
          expect(getModelParamFromRequest(api, request, "maxTokens")).toBeUndefined();
          expect(getModelParamFromRequest(api, request, "customParam")).toBe("custom-value");
        });

        it("should preserve complex unknown parameter types", async () => {
          const model = createModelForApi(api, "gpt-4o", {
            modelParams: {
              arrayParam: [1, 2, 3],
              nestedObject: {
                foo: "bar",
                nested: { deep: true },
              },
              nullParam: null,
              temperature: 0.5,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({ prompt });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.5);
          expect(getModelParamFromRequest(api, request, "arrayParam")).toEqual([1, 2, 3]);
          expect(getModelParamFromRequest(api, request, "nestedObject")).toEqual({
            foo: "bar",
            nested: { deep: true },
          });
          expect(getModelParamFromRequest(api, request, "nullParam")).toBe(null);
        });

        it("should preserve n parameter for all models including Amazon", async () => {
          const model = createModelForApi(api, "amazon--nova-pro", {
            modelParams: {
              customAmazonParam: "amazon-value",
              n: 2,
              temperature: 0.7,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({ prompt });
          expectRequestBodyHasMessages(result);

          const request = await getLastRequestForApi(api);

          expect(getModelParamFromRequest(api, request, "temperature")).toBe(0.7);
          expect(getModelParamFromRequest(api, request, "n")).toBe(2);
          expect(getModelParamFromRequest(api, request, "customAmazonParam")).toBe("amazon-value");
        });
      },
    );

    describe("placeholderValues", () => {
      beforeEach(async () => {
        await resetMockStateForApi("orchestration");
      });

      it("should omit placeholderValues when empty object", async () => {
        const model = createOrchModel("gpt-4o", { placeholderValues: {} });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request).not.toHaveProperty("placeholderValues");
      });

      it("should include placeholderValues from settings in request body", async () => {
        const model = createOrchModel("gpt-4o", {
          placeholderValues: {
            language: "English",
            product: "SAP Cloud SDK",
          },
        });

        const prompt = createPrompt("Describe the product.");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();

        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          language: "English",
          product: "SAP Cloud SDK",
        });
      });

      it("should include placeholderValues from providerOptions in request body", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Describe the product.");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              placeholderValues: {
                groundingInput: "What is SAP?",
                groundingOutput: "",
              },
            },
          },
        });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();

        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          groundingInput: "What is SAP?",
          groundingOutput: "",
        });
      });

      it("should merge placeholderValues from settings and providerOptions (shallow)", async () => {
        const model = createOrchModel("gpt-4o", {
          placeholderValues: {
            language: "English",
            product: "SAP Cloud SDK",
            version: "1.0",
          },
        });

        const prompt = createPrompt("Describe the product.");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              placeholderValues: {
                product: "SAP S/4HANA",
                region: "EMEA",
              },
            },
          },
        });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();

        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          language: "English",
          product: "SAP S/4HANA",
          region: "EMEA",
          version: "1.0",
        });
      });

      it("should not include placeholderValues when not provided", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();

        expect(request).not.toHaveProperty("placeholderValues");
      });

      it("should include placeholderValues in stream request body", async () => {
        const model = createOrchModel("gpt-4o", {
          placeholderValues: {
            language: "English",
            product: "SAP Cloud SDK",
          },
        });

        const prompt = createPrompt("Describe the product.");

        const result = await model.doStream({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();

        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          language: "English",
          product: "SAP Cloud SDK",
        });
      });

      it("should merge placeholderValues from settings and providerOptions in stream request body", async () => {
        const model = createOrchModel("gpt-4o", {
          placeholderValues: {
            language: "English",
            version: "1.0",
          },
        });

        const prompt = createPrompt("Describe the product.");

        const result = await model.doStream({
          prompt,
          providerOptions: {
            "sap-ai": {
              placeholderValues: {
                product: "SAP S/4HANA",
              },
            },
          },
        });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchStreamRequest();

        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          language: "English",
          product: "SAP S/4HANA",
          version: "1.0",
        });
      });
    });

    describe("promptTemplateRef", () => {
      beforeEach(async () => {
        await resetMockStateForApi("orchestration");
      });

      it("should include template_ref by ID in client config when set in settings", async () => {
        const model = createOrchModel("gpt-4o", {
          promptTemplateRef: { id: "my-template-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          id: "my-template-id",
        });
      });

      it("should include template_ref by scenario/name/version with scope in client config", async () => {
        const model = createOrchModel("gpt-4o", {
          promptTemplateRef: {
            name: "my-template",
            scenario: "my-scenario",
            scope: "resource_group",
            version: "1.0.0",
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          name: "my-template",
          scenario: "my-scenario",
          scope: "resource_group",
          version: "1.0.0",
        });
      });

      it("should include template_ref from providerOptions in client config", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              promptTemplateRef: { id: "provider-template-id" },
            },
          },
        });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          id: "provider-template-id",
        });
      });

      it("should override settings promptTemplateRef with providerOptions", async () => {
        const model = createOrchModel("gpt-4o", {
          promptTemplateRef: { id: "settings-template-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              promptTemplateRef: { id: "provider-template-id" },
            },
          },
        });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        // providerOptions should override settings
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          id: "provider-template-id",
        });
      });

      it("should not include template_ref when promptTemplateRef is not provided", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        // Without promptTemplateRef, should use messages (not messagesHistory)
        expectRequestBodyHasMessages(result);

        // Without promptTemplateRef, client config should use template array, not template_ref
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).not.toHaveProperty("template_ref");
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template");
      });

      it("should include template_ref in client config for stream request", async () => {
        const model = createOrchModel("gpt-4o", {
          promptTemplateRef: { id: "stream-template-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({ prompt });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          id: "stream-template-id",
        });
      });

      it("should override settings promptTemplateRef with providerOptions in stream request", async () => {
        const model = createOrchModel("gpt-4o", {
          promptTemplateRef: {
            name: "settings-template",
            scenario: "settings-scenario",
            version: "1.0.0",
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({
          prompt,
          providerOptions: {
            "sap-ai": {
              promptTemplateRef: { id: "provider-override-id" },
            },
          },
        });
        // promptTemplateRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // template_ref is in client config (not request body) when using promptTemplateRef
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig.promptTemplating?.prompt).toHaveProperty("template_ref");
        // providerOptions should override settings
        expect(
          (clientConfig.promptTemplating?.prompt as { template_ref: unknown }).template_ref,
        ).toEqual({
          id: "provider-override-id",
        });
      });
    });

    describe("orchestrationConfigRef", () => {
      beforeEach(async () => {
        await resetMockStateForApi("orchestration");
      });

      it("should use configRef by ID when set in settings", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: { id: "my-config-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "my-config-id" });
      });

      it("should use configRef by scenario/name/version when set in settings", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: {
            name: "my-config",
            scenario: "my-scenario",
            version: "1.0.0",
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({
          name: "my-config",
          scenario: "my-scenario",
          version: "1.0.0",
        });
      });

      it("should use configRef from providerOptions", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              orchestrationConfigRef: { id: "provider-config-id" },
            },
          },
        });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "provider-config-id" });
      });

      it("should override settings orchestrationConfigRef with providerOptions", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: { id: "settings-config-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              orchestrationConfigRef: { id: "provider-config-id" },
            },
          },
        });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // providerOptions should override settings
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "provider-config-id" });
      });

      it("should generate warnings when local settings are ignored due to configRef", async () => {
        const model = createOrchModel("gpt-4o", {
          filtering: {
            output: {
              filters: [{ config: {}, type: "azure_content_safety" as const }],
            },
          },
          orchestrationConfigRef: { id: "my-config-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        expect(result.warnings.length).toBeGreaterThan(0);
        expectWarningMessageContains(result.warnings, "orchestrationConfigRef is set");
        expectWarningMessageContains(result.warnings, "filtering");
      });

      it("should ignore promptTemplateRef when orchestrationConfigRef is set in settings", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: { id: "my-config-id" },
          promptTemplateRef: { id: "ignored-template-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "my-config-id" });

        // promptTemplateRef is ignored with warning when configRef is set
        expect(result.warnings.length).toBeGreaterThan(0);
        expectWarningMessageContains(result.warnings, "orchestrationConfigRef is set");
        expectWarningMessageContains(result.warnings, "promptTemplateRef");
      });

      it("should ignore promptTemplateRef when orchestrationConfigRef is set in providerOptions", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              orchestrationConfigRef: { id: "my-config-id" },
              promptTemplateRef: { id: "ignored-template-id" },
            },
          },
        });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "my-config-id" });

        // promptTemplateRef is ignored with warning when configRef is set
        expect(result.warnings.length).toBeGreaterThan(0);
        expectWarningMessageContains(result.warnings, "orchestrationConfigRef is set");
        expectWarningMessageContains(result.warnings, "providerOptions.promptTemplateRef");
      });

      it("should include placeholderValues when using configRef", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: { id: "my-config-id" },
          placeholderValues: {
            customerName: "Alice",
            topic: "billing",
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // placeholderValues are included in request body when using configRef
        const request = await getLastOrchRequest();
        expect(request).toHaveProperty("placeholderValues");
        expect(request.placeholderValues).toEqual({
          customerName: "Alice",
          topic: "billing",
        });
      });

      it("should use configRef in stream request", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: { id: "stream-config-id" },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({ prompt });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // configRef is passed to OrchestrationClient constructor
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "stream-config-id" });
      });

      it("should override settings orchestrationConfigRef with providerOptions in stream request", async () => {
        const model = createOrchModel("gpt-4o", {
          orchestrationConfigRef: {
            name: "settings-config",
            scenario: "settings-scenario",
            version: "1.0.0",
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doStream({
          prompt,
          providerOptions: {
            "sap-ai": {
              orchestrationConfigRef: { id: "provider-override-id" },
            },
          },
        });

        // configRef mode uses messagesHistory, not messages
        expectRequestBodyHasMessagesHistory(result);

        // providerOptions should override settings
        const clientConfig = await getLastOrchClientConfig();
        expect(clientConfig).toEqual({ id: "provider-override-id" });
      });
    });

    describe("Foundation Models specific parameters", () => {
      it.each([
        { expectedKey: "logprobs", paramName: "logprobs", paramValue: true },
        { expectedKey: "top_logprobs", paramName: "top_logprobs", paramValue: 5 },
        { expectedKey: "logit_bias", paramName: "logit_bias", paramValue: { "50256": -100 } },
        { expectedKey: "user", paramName: "user", paramValue: "user-123" },
        { expectedKey: "parallel_tool_calls", paramName: "parallel_tool_calls", paramValue: false },
      ])(
        "should pass $paramName from modelParams to FM API request",
        async ({ expectedKey, paramName, paramValue }) => {
          const model = createFMModel("gpt-4o", {
            modelParams: {
              [paramName]: paramValue,
            },
          });

          const prompt = createPrompt("Hello");

          const result = await model.doGenerate({ prompt });
          expectRequestBodyHasMessages(result);

          const request = await getLastFMRequest();

          expect(request[expectedKey]).toEqual(paramValue);
        },
      );

      it("should pass logprobs with top_logprobs together", async () => {
        const model = createFMModel("gpt-4o", {
          modelParams: {
            logprobs: true,
            top_logprobs: 3,
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMRequest();

        expect(request.logprobs).toBe(true);
        expect(request.top_logprobs).toBe(3);
      });

      it("should pass logit_bias with complex token mappings", async () => {
        const logitBias = {
          "1234": 50,
          "9999": 0,
          "50256": -100,
        };

        const model = createFMModel("gpt-4o", {
          modelParams: {
            logit_bias: logitBias,
          },
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMRequest();

        expect(request.logit_bias).toEqual(logitBias);
      });
    });

    describe("FM-only params with Orchestration API", () => {
      it("should pass FM-only modelParams through to Orchestration request without error", async () => {
        const model = createOrchModel("gpt-4o", {
          modelParams: {
            logit_bias: { "50256": -100 },
            logprobs: true,
            temperature: 0.7,
            top_logprobs: 3,
            user: "test-user",
          } as Record<string, unknown>,
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request.model?.params?.temperature).toBe(0.7);
        expect(request.model?.params?.logprobs).toBe(true);
        expect(request.model?.params?.top_logprobs).toBe(3);
        expect(request.model?.params?.logit_bias).toEqual({ "50256": -100 });
        expect(request.model?.params?.user).toBe("test-user");
      });

      it("should not throw when passing FM-only params via providerOptions to Orchestration", async () => {
        const model = createOrchModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({
          prompt,
          providerOptions: {
            "sap-ai": {
              modelParams: {
                logprobs: true,
                seed: 42,
              },
            },
          },
        });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        expect(request.model?.params?.logprobs).toBe(true);
        expect(request.model?.params?.seed).toBe(42);
      });
    });

    describe("Foundation Models dataSources (Azure On Your Data)", () => {
      it("should pass dataSources to FM API request", async () => {
        const dataSources = [
          {
            parameters: {
              authentication: {
                key: "api-key-123",
                type: "api_key",
              },
              endpoint: "https://search.windows.net",
              index_name: "my-index",
            },
            type: "azure_search",
          },
        ];

        const model = createFMModel("gpt-4o", {
          dataSources,
        });

        const prompt = createPrompt("What is SAP AI Core?");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMRequest();

        expect(request.data_sources).toEqual(dataSources);
      });

      it("should pass dataSources in stream request", async () => {
        const dataSources = [
          {
            parameters: {
              authentication: {
                type: "system_assigned_managed_identity",
              },
              endpoint: "https://search.windows.net",
              index_name: "products-index",
            },
            type: "azure_search",
          },
        ];

        const model = createFMModel("gpt-4o", {
          dataSources,
        });

        const prompt = createPrompt("List available products");

        const result = await model.doStream({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMStreamRequest();

        expect(request.data_sources).toEqual(dataSources);
      });

      it("should not include data_sources when dataSources is empty array", async () => {
        const model = createFMModel("gpt-4o", {
          dataSources: [],
        });

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMRequest();

        expect(request).not.toHaveProperty("data_sources");
      });

      it("should not include data_sources when dataSources is undefined", async () => {
        const model = createFMModel("gpt-4o");

        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        expectRequestBodyHasMessages(result);

        const request = await getLastFMRequest();

        expect(request).not.toHaveProperty("data_sources");
      });
    });

    describe.each<APIType>(["orchestration", "foundation-models"])(
      "toolChoice support (%s API)",
      (api) => {
        it.each([
          { expected: "auto", toolChoice: { type: "auto" as const } },
          { expected: "none", toolChoice: { type: "none" as const } },
          { expected: "required", toolChoice: { type: "required" as const } },
        ])("should pass tool_choice '$expected' in request", async ({ expected, toolChoice }) => {
          const model = createModelForApi(api);
          const prompt = createPrompt("Hello");

          const tools: LanguageModelV3FunctionTool[] = [
            {
              description: "A test tool",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "test_tool",
              type: "function",
            },
          ];

          await model.doGenerate({
            prompt,
            toolChoice,
            tools,
          });

          const request = await getLastRequestForApi(api);
          expect(request.tool_choice).toBe(expected);
        });

        it("should pass tool_choice with specific function name in request", async () => {
          const model = createModelForApi(api);
          const prompt = createPrompt("Hello");

          const tools: LanguageModelV3FunctionTool[] = [
            {
              description: "A test tool",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "test_tool",
              type: "function",
            },
          ];

          await model.doGenerate({
            prompt,
            toolChoice: { toolName: "test_tool", type: "tool" },
            tools,
          });

          const request = await getLastRequestForApi(api);
          expect(request.tool_choice).toEqual({
            function: { name: "test_tool" },
            type: "function",
          });
        });

        it("should not include tool_choice when not specified", async () => {
          const model = createModelForApi(api);
          const prompt = createPrompt("Hello");

          const tools: LanguageModelV3FunctionTool[] = [
            {
              description: "A test tool",
              inputSchema: { properties: {}, required: [], type: "object" },
              name: "test_tool",
              type: "function",
            },
          ];

          await model.doGenerate({
            prompt,
            tools,
          });

          const request = await getLastRequestForApi(api);
          expect(request).not.toHaveProperty("tool_choice");
        });
      },
    );

    describe.each<APIType>(["orchestration", "foundation-models"])("warnings (%s API)", (api) => {
      it("should emit a best-effort warning for responseFormat json", async () => {
        const model = createModelForApi(api);
        const prompt = createPrompt("Return JSON");

        const result = await model.doGenerate({
          prompt,
          responseFormat: { type: "json" },
        });
        const warnings = result.warnings as { message?: string; type: string }[];

        expect(warnings.length).toBeGreaterThan(0);
        expectWarningMessageContains(warnings, "responseFormat JSON mode");
      });

      it("should emit a best-effort warning for settings.responseFormat json", async () => {
        const model = createModelForApi(api, "gpt-4o", {
          responseFormat: {
            json_schema: {
              name: "test",
              schema: { type: "object" },
            },
            type: "json_schema",
          },
        });
        const prompt = createPrompt("Return JSON");

        const result = await model.doGenerate({ prompt });
        const warnings = result.warnings as { message?: string; type: string }[];

        expect(warnings.length).toBeGreaterThan(0);
        expectWarningMessageContains(warnings, "responseFormat JSON mode");
      });

      it("should not emit responseFormat warning when responseFormat is text", async () => {
        const model = createModelForApi(api, "gpt-4o", {
          responseFormat: { type: "text" },
        });
        const prompt = createPrompt("Hello");

        const result = await model.doGenerate({ prompt });
        const warnings = result.warnings as { message?: string; type: string }[];

        const hasResponseFormatWarning = warnings.some(
          (w) => typeof w.message === "string" && w.message.includes("responseFormat JSON mode"),
        );
        expect(hasResponseFormatWarning).toBe(false);
      });
    });

    describe("settings.tools (orchestration only)", () => {
      it("should prefer call options.tools over settings.tools (and warn)", async () => {
        const model = createOrchModel("gpt-4o", {
          tools: [
            {
              function: {
                description: "From settings",
                name: "settings_tool",
                parameters: {
                  properties: {},
                  required: [],
                  type: "object",
                },
              },
              type: "function",
            },
          ],
        });

        const prompt = createPrompt("Hello");

        const tools: LanguageModelV3FunctionTool[] = [
          {
            description: "From call options",
            inputSchema: {
              properties: {},
              required: [],
              type: "object",
            },
            name: "call_tool",
            type: "function",
          },
        ];

        const result = await model.doGenerate({ prompt, tools });
        const warnings = result.warnings;

        expectWarningMessageContains(warnings, "preferring call options.tools");

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();
        const requestTools = Array.isArray(request.tools) ? (request.tools as unknown[]) : [];

        expect(
          requestTools.some(
            (tool) =>
              typeof tool === "object" &&
              tool !== null &&
              (tool as { function?: { name?: unknown } }).function?.name === "call_tool",
          ),
        ).toBe(true);

        expect(
          requestTools.some(
            (tool) =>
              typeof tool === "object" &&
              tool !== null &&
              (tool as { function?: { name?: unknown } }).function?.name === "settings_tool",
          ),
        ).toBe(false);
      });

      it("should use tools from settings when provided", async () => {
        const model = createOrchModel("gpt-4o", {
          tools: [
            {
              function: {
                description: "A custom tool from settings",
                name: "custom_tool",
                parameters: {
                  properties: {
                    input: { type: "string" },
                  },
                  required: ["input"],
                  type: "object",
                },
              },
              type: "function",
            },
          ],
        });

        const prompt = createPrompt("Use a tool");

        const result = await model.doGenerate({ prompt });

        expectRequestBodyHasMessages(result);

        const request = await getLastOrchRequest();

        const tools = Array.isArray(request.tools) ? (request.tools as unknown[]) : undefined;

        expect(tools).toBeDefined();
        if (tools) {
          expect(tools).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "function",
              }),
            ]),
          );

          const customTool = tools.find(
            (tool): tool is { function?: { name?: string }; type?: string } =>
              typeof tool === "object" &&
              tool !== null &&
              (tool as { type?: unknown }).type === "function" &&
              typeof (tool as { function?: { name?: unknown } }).function?.name === "string" &&
              (tool as { function?: { name?: string } }).function?.name === "custom_tool",
          );

          expect(customTool).toBeDefined();
        }
      });
    });

    describe.each<APIType>(["orchestration", "foundation-models"])(
      "tool schema edge cases (%s API)",
      (api) => {
        beforeEach(async () => {
          await resetMockStateForApi(api);
        });

        it.each([
          {
            description: "Tool with array schema",
            inputSchema: { items: { type: "string" }, type: "array" },
            testName: "coerce non-object schema type to object (array)",
            toolName: "array_tool",
          },
          {
            description: "Tool with string schema",
            inputSchema: { type: "string" },
            testName: "handle tool with string type schema",
            toolName: "string_tool",
          },
          {
            description: "Tool with empty properties",
            inputSchema: { properties: {}, type: "object" },
            testName: "handle tool with schema that has no properties",
            toolName: "empty_props_tool",
          },
          {
            description: "Tool without schema",
            inputSchema: undefined as unknown as Record<string, unknown>,
            testName: "handle tool with undefined inputSchema",
            toolName: "no_schema_tool",
          },
        ])("should $testName", async ({ description, inputSchema, toolName }) => {
          const model = createModelForApi(api);
          const prompt = createPrompt("Use tool");

          const tools: LanguageModelV3FunctionTool[] = [
            {
              description,
              inputSchema,
              name: toolName,
              type: "function",
            },
          ];

          const result = await model.doGenerate({ prompt, tools });

          expectRequestBodyHasMessages(result);
        });
      },
    );
  });

  describe("Foundation Models deployment resolution", () => {
    it("should use deploymentId for deployment resolution when configured", async () => {
      const modelId = "gpt-4o-test";
      const deploymentId = "my-deployment-id";
      const model = new SAPAILanguageModel(
        modelId,
        { api: "foundation-models" },
        {
          deploymentConfig: { deploymentId },
          provider: "sap-ai",
        },
      );

      const prompt = createPrompt("Hello");
      await model.doGenerate({ prompt });

      const mockClient = await getMockFMClient();
      const constructorCall = mockClient.lastConstructorCall;

      expect(constructorCall).toBeDefined();
      expect(constructorCall?.modelDeployment).toHaveProperty("deploymentId", deploymentId);
      expect(constructorCall?.modelDeployment).not.toHaveProperty("modelName");
    });

    it("should use modelName for deployment resolution when no deploymentId is configured", async () => {
      const modelId = "gpt-4o-test";
      const model = new SAPAILanguageModel(
        modelId,
        { api: "foundation-models" },
        {
          deploymentConfig: { resourceGroup: "default" },
          provider: "sap-ai",
        },
      );

      const prompt = createPrompt("Hello");
      await model.doGenerate({ prompt });

      const mockClient = await getMockFMClient();
      const constructorCall = mockClient.lastConstructorCall;

      expect(constructorCall).toBeDefined();
      expect(constructorCall?.modelDeployment).toHaveProperty("modelName", modelId);
      expect(constructorCall?.modelDeployment).not.toHaveProperty("deploymentId");
    });

    it("should include resourceGroup when configured", async () => {
      const modelId = "gpt-4o-test";
      const model = new SAPAILanguageModel(
        modelId,
        { api: "foundation-models" },
        {
          deploymentConfig: { resourceGroup: "custom-group" },
          provider: "sap-ai",
        },
      );

      const prompt = createPrompt("Hello");
      await model.doGenerate({ prompt });

      const mockClient = await getMockFMClient();
      const constructorCall = mockClient.lastConstructorCall;

      expect(constructorCall).toBeDefined();
      expect(constructorCall?.modelDeployment).toHaveProperty("modelName", modelId);
      expect(constructorCall?.modelDeployment).toHaveProperty("resourceGroup", "custom-group");
      expect(constructorCall?.modelDeployment).not.toHaveProperty("deploymentId");
    });
  });
});
