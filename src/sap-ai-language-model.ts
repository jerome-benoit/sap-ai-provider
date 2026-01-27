/**
 * SAP AI Language Model - Vercel AI SDK LanguageModelV3 implementation for SAP AI Core Orchestration.
 *
 * This is the main implementation containing all business logic for SAP AI Core integration.
 */
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { LlmModelParams } from "@sap-ai-sdk/orchestration";
import type { Template } from "@sap-ai-sdk/orchestration/dist/client/api/schema/template.js";
import type { HttpDestinationOrFetchOptions } from "@sap-cloud-sdk/connectivity";

import {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import { parseProviderOptions } from "@ai-sdk/provider-utils";
import {
  ChatCompletionTool,
  ChatMessage,
  OrchestrationClient,
  OrchestrationModuleConfig,
} from "@sap-ai-sdk/orchestration";
import { z, type ZodType } from "zod";

import { deepMerge } from "./deep-merge.js";

/**
 * @internal
 */
interface FunctionToolWithParameters extends LanguageModelV3FunctionTool {
  readonly parameters?: unknown;
}

import { convertToSAPMessages } from "./convert-to-sap-messages";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error";
import {
  getProviderName,
  sapAILanguageModelProviderOptions,
  validateModelParamsSettings,
  validateModelParamsWithWarnings,
} from "./sap-ai-provider-options";
import { SAPAIModelId, SAPAISettings } from "./sap-ai-settings";
import { VERSION } from "./version.js";

/**
 * Parameter mapping for AI SDK options → SAP model params.
 * @internal
 */
interface ParamMapping {
  /** camelCase key in modelParams to read from and remove (e.g., 'maxTokens', 'topP') */
  readonly camelCaseKey?: string;
  /** AI SDK option key (e.g., 'maxOutputTokens', 'topP') */
  readonly optionKey?: string;
  /** Output key for SAP API (e.g., 'max_tokens', 'top_p') */
  readonly outputKey: string;
}

/**
 * Internal configuration for SAP AI Language Model.
 * @internal
 */
interface SAPAILanguageModelConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly destination?: HttpDestinationOrFetchOptions;
  readonly provider: string;
}

/**
 * @internal
 */
type SAPModelParams = LlmModelParams & {
  parallel_tool_calls?: boolean;
  seed?: number;
  stop?: string[];
  top_k?: number;
};

type SAPResponseFormat = Template["response_format"];

/**
 * @internal
 */
type SAPToolParameters = Record<string, unknown> & {
  type: "object";
};

/**
 * Parameter mappings for override resolution and camelCase conversion.
 * @internal
 */
const PARAM_MAPPINGS: readonly ParamMapping[] = [
  { camelCaseKey: "maxTokens", optionKey: "maxOutputTokens", outputKey: "max_tokens" },
  { camelCaseKey: "temperature", optionKey: "temperature", outputKey: "temperature" },
  { camelCaseKey: "topP", optionKey: "topP", outputKey: "top_p" },
  { camelCaseKey: "topK", optionKey: "topK", outputKey: "top_k" },
  {
    camelCaseKey: "frequencyPenalty",
    optionKey: "frequencyPenalty",
    outputKey: "frequency_penalty",
  },
  { camelCaseKey: "presencePenalty", optionKey: "presencePenalty", outputKey: "presence_penalty" },
  { camelCaseKey: "seed", optionKey: "seed", outputKey: "seed" },
  { camelCaseKey: "parallel_tool_calls", outputKey: "parallel_tool_calls" },
] as const;

/**
 * @internal
 */
class StreamIdGenerator {
  generateResponseId(): string {
    return crypto.randomUUID();
  }

  generateTextBlockId(): string {
    return crypto.randomUUID();
  }
}

/**
 * SAP AI Language Model implementing Vercel AI SDK LanguageModelV3.
 *
 * Features: text generation, tool calling, multi-modal input, data masking, content filtering.
 * Supports: Azure OpenAI, Google Vertex AI, AWS Bedrock, AI Core open source models.
 */
export class SAPAILanguageModel implements LanguageModelV3 {
  /** The model identifier. */
  readonly modelId: SAPAIModelId;
  /** The Vercel AI SDK specification version. */
  readonly specificationVersion = "v3";

  /** Whether the model supports image URLs in prompts. */
  readonly supportsImageUrls: boolean = true;
  /** Whether the model supports generating multiple completions. */
  readonly supportsMultipleCompletions: boolean = true;
  /** Whether the model supports parallel tool calls. */
  readonly supportsParallelToolCalls: boolean = true;
  /** Whether the model supports streaming responses. */
  readonly supportsStreaming: boolean = true;
  /** Whether the model supports structured JSON outputs. */
  readonly supportsStructuredOutputs: boolean = true;
  /** Whether the model supports tool/function calling. */
  readonly supportsToolCalls: boolean = true;

  /**
   * Gets the provider identifier string.
   * @returns The provider identifier.
   */
  get provider(): string {
    return this.config.provider;
  }

  /**
   * Gets the supported URL patterns for image input.
   * @returns A mapping of MIME type patterns to URL regex patterns.
   */
  get supportedUrls(): Record<string, RegExp[]> {
    return {
      "image/*": [/^https:\/\/.+$/i, /^data:image\/.*$/],
    };
  }

  /** @internal */
  private readonly config: SAPAILanguageModelConfig;

  /** @internal */
  private readonly settings: SAPAISettings;

  /**
   * Creates a new SAP AI Language Model instance.
   *
   * This is the main implementation that handles all SAP AI Core orchestration logic.
   * @param modelId - The model identifier (e.g., 'gpt-4o', 'claude-3-5-sonnet', 'gemini-2.0-flash').
   * @param settings - Model configuration settings (temperature, max tokens, filtering, etc.).
   * @param config - SAP AI Core deployment and destination configuration.
   * @internal
   */
  constructor(modelId: SAPAIModelId, settings: SAPAISettings, config: SAPAILanguageModelConfig) {
    if (settings.modelParams) {
      validateModelParamsSettings(settings.modelParams);
    }
    this.settings = settings;
    this.config = config;
    this.modelId = modelId;
  }

  /**
   * Generates a single completion (non-streaming).
   *
   * Builds orchestration configuration, converts messages, validates parameters,
   * calls SAP AI SDK, and processes the response.
   * Supports request cancellation via AbortSignal at the HTTP transport layer.
   * @param options - The Vercel AI SDK V3 generation call options.
   * @returns The generation result with content, usage, warnings, and provider metadata.
   */
  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    try {
      const { messages, orchestrationConfig, warnings } =
        await this.buildOrchestrationConfig(options);

      const client = this.createClient(orchestrationConfig);

      const requestBody = this.buildRequestBody(messages, orchestrationConfig);

      const response = await client.chatCompletion(
        requestBody,
        options.abortSignal ? { signal: options.abortSignal } : undefined,
      );
      const responseHeaders = normalizeHeaders(response.rawResponse.headers);

      const content: LanguageModelV3Content[] = [];

      const textContent = response.getContent();
      if (textContent) {
        content.push({
          text: textContent,
          type: "text",
        });
      }

      const toolCalls = response.getToolCalls();
      if (toolCalls) {
        for (const toolCall of toolCalls) {
          content.push({
            input: toolCall.function.arguments,
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            type: "tool-call",
          });
        }
      }

      const tokenUsage = response.getTokenUsage();

      const finishReasonRaw = response.getFinishReason();
      const finishReason = mapFinishReason(finishReasonRaw);

      const rawResponseBody = {
        content: textContent,
        finishReason: finishReasonRaw,
        tokenUsage,
        toolCalls,
      };

      const providerName = getProviderName(this.config.provider);

      return {
        content,
        finishReason,
        providerMetadata: {
          [providerName]: {
            finishReason: finishReasonRaw ?? "unknown",
            finishReasonMapped: finishReason,
            ...(typeof responseHeaders?.["x-request-id"] === "string"
              ? { requestId: responseHeaders["x-request-id"] }
              : {}),
            version: VERSION,
          },
        },
        request: {
          body: requestBody as unknown,
        },
        response: {
          body: rawResponseBody,
          headers: responseHeaders,
          modelId: this.modelId,
          timestamp: new Date(),
        },
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: tokenUsage.prompt_tokens,
            total: tokenUsage.prompt_tokens,
          },
          outputTokens: {
            reasoning: undefined,
            text: tokenUsage.completion_tokens,
            total: tokenUsage.completion_tokens,
          },
        },
        warnings,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doGenerate",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  /**
   * Generates a streaming completion.
   *
   * Builds orchestration configuration, creates streaming client, and transforms
   * the stream with proper event handling (text blocks, tool calls, finish reason).
   * Supports request cancellation via AbortSignal at the HTTP transport layer.
   * @param options - The Vercel AI SDK V3 generation call options.
   * @returns A stream result with async iterable stream parts.
   */
  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    try {
      const { messages, orchestrationConfig, warnings } =
        await this.buildOrchestrationConfig(options);

      const client = this.createClient(orchestrationConfig);

      const requestBody = this.buildRequestBody(messages, orchestrationConfig);

      const streamResponse = await client.stream(requestBody, options.abortSignal, {
        promptTemplating: { include_usage: true },
      });

      const idGenerator = new StreamIdGenerator();

      // Client-generated UUID; TODO: use backend x-request-id when SDK exposes rawResponse
      const responseId = idGenerator.generateResponseId();

      let textBlockId: null | string = null;

      const streamState = {
        activeText: false,
        finishReason: {
          raw: undefined,
          unified: "other" as const,
        } as LanguageModelV3FinishReason,
        isFirstChunk: true,
        usage: {
          inputTokens: {
            cacheRead: undefined,
            cacheWrite: undefined,
            noCache: undefined as number | undefined,
            total: undefined as number | undefined,
          },
          outputTokens: {
            reasoning: undefined,
            text: undefined as number | undefined,
            total: undefined as number | undefined,
          },
        },
      };

      const toolCallsInProgress = new Map<
        number,
        {
          arguments: string;
          didEmitCall: boolean;
          didEmitInputStart: boolean;
          id: string;
          toolName?: string;
        }
      >();

      const sdkStream = streamResponse.stream;
      const modelId = this.modelId;
      const providerName = getProviderName(this.config.provider);

      const warningsSnapshot = [...warnings];

      const transformedStream = new ReadableStream<LanguageModelV3StreamPart>({
        cancel(reason) {
          if (reason) {
            console.debug("SAP AI stream cancelled:", reason);
          }
        },
        async start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: warningsSnapshot,
          });

          try {
            for await (const chunk of sdkStream) {
              if (options.includeRawChunks) {
                controller.enqueue({
                  rawValue: (chunk as { _data?: unknown })._data ?? chunk,
                  type: "raw",
                });
              }

              if (streamState.isFirstChunk) {
                streamState.isFirstChunk = false;
                controller.enqueue({
                  id: responseId,
                  modelId,
                  timestamp: new Date(),
                  type: "response-metadata",
                });
              }

              const deltaToolCalls = chunk.getDeltaToolCalls();
              if (Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0) {
                streamState.finishReason = {
                  raw: undefined,
                  unified: "tool-calls",
                };
              }

              const deltaContent = chunk.getDeltaContent();
              if (
                typeof deltaContent === "string" &&
                deltaContent.length > 0 &&
                streamState.finishReason.unified !== "tool-calls"
              ) {
                if (!streamState.activeText) {
                  textBlockId = idGenerator.generateTextBlockId();
                  controller.enqueue({ id: textBlockId, type: "text-start" });
                  streamState.activeText = true;
                }
                if (textBlockId) {
                  controller.enqueue({
                    delta: deltaContent,
                    id: textBlockId,
                    type: "text-delta",
                  });
                }
              }

              if (Array.isArray(deltaToolCalls) && deltaToolCalls.length > 0) {
                for (const toolCallChunk of deltaToolCalls) {
                  const index = toolCallChunk.index;
                  if (typeof index !== "number" || !Number.isFinite(index)) {
                    continue;
                  }

                  if (!toolCallsInProgress.has(index)) {
                    toolCallsInProgress.set(index, {
                      arguments: "",
                      didEmitCall: false,
                      didEmitInputStart: false,
                      id: toolCallChunk.id ?? `tool_${String(index)}`,
                      toolName: toolCallChunk.function?.name,
                    });
                  }

                  const tc = toolCallsInProgress.get(index);
                  if (!tc) continue;

                  if (toolCallChunk.id) {
                    tc.id = toolCallChunk.id;
                  }

                  const nextToolName = toolCallChunk.function?.name;
                  if (typeof nextToolName === "string" && nextToolName.length > 0) {
                    tc.toolName = nextToolName;
                  }

                  if (!tc.didEmitInputStart && tc.toolName) {
                    tc.didEmitInputStart = true;
                    controller.enqueue({
                      id: tc.id,
                      toolName: tc.toolName,
                      type: "tool-input-start",
                    });
                  }

                  const argumentsDelta = toolCallChunk.function?.arguments;
                  if (typeof argumentsDelta === "string" && argumentsDelta.length > 0) {
                    tc.arguments += argumentsDelta;

                    if (tc.didEmitInputStart) {
                      controller.enqueue({
                        delta: argumentsDelta,
                        id: tc.id,
                        type: "tool-input-delta",
                      });
                    }
                  }
                }
              }

              const chunkFinishReason = chunk.getFinishReason();
              if (chunkFinishReason) {
                streamState.finishReason = mapFinishReason(chunkFinishReason);

                if (streamState.finishReason.unified === "tool-calls") {
                  const toolCalls = Array.from(toolCallsInProgress.values());
                  for (const tc of toolCalls) {
                    if (tc.didEmitCall) {
                      continue;
                    }
                    if (!tc.didEmitInputStart) {
                      tc.didEmitInputStart = true;
                      controller.enqueue({
                        id: tc.id,
                        toolName: tc.toolName ?? "",
                        type: "tool-input-start",
                      });
                    }

                    tc.didEmitCall = true;
                    controller.enqueue({ id: tc.id, type: "tool-input-end" });
                    controller.enqueue({
                      input: tc.arguments,
                      toolCallId: tc.id,
                      toolName: tc.toolName ?? "",
                      type: "tool-call",
                    });
                  }

                  if (streamState.activeText && textBlockId) {
                    controller.enqueue({ id: textBlockId, type: "text-end" });
                    streamState.activeText = false;
                  }
                }
              }
            }

            const toolCalls = Array.from(toolCallsInProgress.values());
            let didEmitAnyToolCalls = false;

            for (const tc of toolCalls) {
              if (tc.didEmitCall) {
                continue;
              }

              if (!tc.didEmitInputStart) {
                tc.didEmitInputStart = true;
                controller.enqueue({
                  id: tc.id,
                  toolName: tc.toolName ?? "",
                  type: "tool-input-start",
                });
              }

              didEmitAnyToolCalls = true;
              tc.didEmitCall = true;
              controller.enqueue({ id: tc.id, type: "tool-input-end" });
              controller.enqueue({
                input: tc.arguments,
                toolCallId: tc.id,
                toolName: tc.toolName ?? "",
                type: "tool-call",
              });
            }

            if (streamState.activeText && textBlockId) {
              controller.enqueue({ id: textBlockId, type: "text-end" });
            }

            const finalFinishReason = streamResponse.getFinishReason();
            if (finalFinishReason) {
              streamState.finishReason = mapFinishReason(finalFinishReason);
            } else if (didEmitAnyToolCalls) {
              streamState.finishReason = {
                raw: undefined,
                unified: "tool-calls",
              };
            }

            const finalUsage = streamResponse.getTokenUsage();
            if (finalUsage) {
              streamState.usage.inputTokens.total = finalUsage.prompt_tokens;
              streamState.usage.inputTokens.noCache = finalUsage.prompt_tokens;
              streamState.usage.outputTokens.total = finalUsage.completion_tokens;
              streamState.usage.outputTokens.text = finalUsage.completion_tokens;
            }

            controller.enqueue({
              finishReason: streamState.finishReason,
              providerMetadata: {
                [providerName]: {
                  finishReason: streamState.finishReason.raw,
                  responseId,
                  version: VERSION,
                },
              },
              type: "finish",
              usage: streamState.usage,
            });

            controller.close();
          } catch (error) {
            const aiError = convertToAISDKError(error, {
              operation: "doStream",
              requestBody: createAISDKRequestBodySummary(options),
              url: "sap-ai:orchestration",
            });
            controller.enqueue({
              error: aiError instanceof Error ? aiError : new Error(String(aiError)),
              type: "error",
            });
            controller.close();
          }
        },
      });

      return {
        request: {
          body: requestBody as unknown,
        },
        stream: transformedStream,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doStream",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:orchestration",
      });
    }
  }

  /**
   * Checks if a URL is supported for image input (HTTPS or data:image/*).
   * @param url - The URL to check.
   * @returns True if the URL is supported for image input.
   */
  supportsUrl(url: URL): boolean {
    if (url.protocol === "https:") return true;
    if (url.protocol === "data:") {
      return /^data:image\//i.test(url.href);
    }
    return false;
  }

  /**
   * Builds the SAP AI SDK orchestration configuration from Vercel AI SDK call options.
   * @param options - The Vercel AI SDK language model call options.
   * @returns The SAP AI SDK orchestration configuration, messages, and warnings.
   * @internal
   */
  private async buildOrchestrationConfig(options: LanguageModelV3CallOptions): Promise<{
    messages: ChatMessage[];
    orchestrationConfig: OrchestrationModuleConfig;
    warnings: SharedV3Warning[];
  }> {
    const providerName = getProviderName(this.config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const warnings: SharedV3Warning[] = [];

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders:
        sapOptions?.escapeTemplatePlaceholders ?? this.settings.escapeTemplatePlaceholders ?? true,
      includeReasoning: sapOptions?.includeReasoning ?? this.settings.includeReasoning ?? false,
    });

    let tools: ChatCompletionTool[] | undefined;

    const settingsTools = this.settings.tools;
    const optionsTools = options.tools;

    const shouldUseSettingsTools =
      settingsTools && settingsTools.length > 0 && (!optionsTools || optionsTools.length === 0);

    const shouldUseOptionsTools = !!(optionsTools && optionsTools.length > 0);

    if (settingsTools && settingsTools.length > 0 && optionsTools && optionsTools.length > 0) {
      warnings.push({
        message:
          "Both settings.tools and call options.tools were provided; preferring call options.tools.",
        type: "other",
      });
    }

    if (shouldUseSettingsTools) {
      tools = settingsTools;
    } else {
      const availableTools = shouldUseOptionsTools ? optionsTools : undefined;

      tools = availableTools
        ?.map((tool): ChatCompletionTool | null => {
          if (tool.type === "function") {
            const inputSchema = tool.inputSchema as Record<string, unknown> | undefined;
            const toolWithParams = tool as FunctionToolWithParameters;

            let parameters: SAPToolParameters;

            if (toolWithParams.parameters && isZodSchema(toolWithParams.parameters)) {
              try {
                const jsonSchema = z.toJSONSchema(toolWithParams.parameters);
                const schemaRecord = jsonSchema as Record<string, unknown>;
                delete schemaRecord.$schema;
                parameters = buildSAPToolParameters(schemaRecord);
              } catch (error) {
                warnings.push({
                  details: `Failed to convert tool Zod schema: ${error instanceof Error ? error.message : String(error)}. Falling back to empty object schema.`,
                  feature: `tool schema conversion for ${tool.name}`,
                  type: "unsupported",
                });
                parameters = buildSAPToolParameters({});
              }
            } else if (inputSchema && Object.keys(inputSchema).length > 0) {
              const hasProperties =
                inputSchema.properties &&
                typeof inputSchema.properties === "object" &&
                Object.keys(inputSchema.properties).length > 0;

              if (hasProperties) {
                parameters = buildSAPToolParameters(inputSchema);
              } else {
                parameters = buildSAPToolParameters({});
              }
            } else {
              parameters = buildSAPToolParameters({});
            }

            return {
              function: {
                description: tool.description,
                name: tool.name,
                parameters,
              },
              type: "function",
            };
          } else {
            warnings.push({
              details: "Only 'function' tool type is supported.",
              feature: `tool type for ${tool.name}`,
              type: "unsupported",
            });
            return null;
          }
        })
        .filter((t): t is ChatCompletionTool => t !== null);
    }

    const supportsN =
      !this.modelId.startsWith("amazon--") && !this.modelId.startsWith("anthropic--");

    const modelParams: SAPModelParams = deepMerge(
      this.settings.modelParams ?? {},
      sapOptions?.modelParams ?? {},
    );

    applyParameterOverrides(
      modelParams,
      options as Record<string, unknown>,
      sapOptions?.modelParams as Record<string, unknown> | undefined,
      this.settings.modelParams as Record<string, unknown> | undefined,
    );

    if (options.stopSequences && options.stopSequences.length > 0) {
      modelParams.stop = options.stopSequences;
    }

    if (supportsN) {
      const nValue = sapOptions?.modelParams?.n ?? this.settings.modelParams?.n;
      if (nValue !== undefined) {
        modelParams.n = nValue;
      }
    } else {
      delete modelParams.n;
    }

    validateModelParamsWithWarnings(
      {
        frequencyPenalty: options.frequencyPenalty,
        maxTokens: options.maxOutputTokens,
        presencePenalty: options.presencePenalty,
        temperature: options.temperature,
        topP: options.topP,
      },
      warnings,
    );

    if (options.toolChoice && options.toolChoice.type !== "auto") {
      warnings.push({
        details: `SAP AI SDK does not support toolChoice '${options.toolChoice.type}'. Using default 'auto' behavior.`,
        feature: "toolChoice",
        type: "unsupported",
      });
    }

    let responseFormat: SAPResponseFormat | undefined;
    if (options.responseFormat?.type === "json") {
      responseFormat = options.responseFormat.schema
        ? {
            json_schema: {
              description: options.responseFormat.description,
              name: options.responseFormat.name ?? "response",
              schema: options.responseFormat.schema as Record<string, unknown>,
              strict: null,
            },
            type: "json_schema" as const,
          }
        : { type: "json_object" as const };
    } else if (this.settings.responseFormat) {
      responseFormat = this.settings.responseFormat as SAPResponseFormat;
    }

    if (responseFormat && responseFormat.type !== "text") {
      warnings.push({
        message:
          "responseFormat JSON mode is forwarded to the underlying model; support and schema adherence depend on the model/deployment.",
        type: "other",
      });
    }

    const orchestrationConfig: OrchestrationModuleConfig = {
      promptTemplating: {
        model: {
          name: this.modelId,
          params: modelParams,
          version: this.settings.modelVersion ?? "latest",
        },
        prompt: {
          template: [],
          tools: tools && tools.length > 0 ? tools : undefined,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
      },
      ...(this.settings.masking && Object.keys(this.settings.masking).length > 0
        ? { masking: this.settings.masking }
        : {}),
      ...(this.settings.filtering && Object.keys(this.settings.filtering).length > 0
        ? { filtering: this.settings.filtering }
        : {}),
      ...(this.settings.grounding && Object.keys(this.settings.grounding).length > 0
        ? { grounding: this.settings.grounding }
        : {}),
      ...(this.settings.translation && Object.keys(this.settings.translation).length > 0
        ? { translation: this.settings.translation }
        : {}),
    };

    return { messages, orchestrationConfig, warnings };
  }

  /**
   * Builds the request body for SAP AI SDK chat completion or streaming.
   * @param messages - The chat messages to send.
   * @param orchestrationConfig - The orchestration configuration.
   * @returns The request body object.
   * @internal
   */
  private buildRequestBody(
    messages: ChatMessage[],
    orchestrationConfig: OrchestrationModuleConfig,
  ): Record<string, unknown> {
    const promptTemplating = orchestrationConfig.promptTemplating as unknown as {
      prompt: { response_format?: unknown; tools?: unknown };
    };

    return {
      messages,
      model: {
        ...orchestrationConfig.promptTemplating.model,
      },
      ...(promptTemplating.prompt.tools ? { tools: promptTemplating.prompt.tools } : {}),
      ...(promptTemplating.prompt.response_format
        ? { response_format: promptTemplating.prompt.response_format }
        : {}),
      ...(orchestrationConfig.masking && Object.keys(orchestrationConfig.masking).length > 0
        ? { masking: orchestrationConfig.masking }
        : {}),
      ...(orchestrationConfig.filtering && Object.keys(orchestrationConfig.filtering).length > 0
        ? { filtering: orchestrationConfig.filtering }
        : {}),
      ...(orchestrationConfig.grounding && Object.keys(orchestrationConfig.grounding).length > 0
        ? { grounding: orchestrationConfig.grounding }
        : {}),
      ...(orchestrationConfig.translation && Object.keys(orchestrationConfig.translation).length > 0
        ? { translation: orchestrationConfig.translation }
        : {}),
    };
  }

  /**
   * Creates an SAP AI SDK OrchestrationClient with the given configuration.
   * @param config - The SAP AI SDK orchestration module configuration.
   * @returns A configured SAP AI SDK orchestration client.
   * @internal
   */
  private createClient(config: OrchestrationModuleConfig): OrchestrationClient {
    return new OrchestrationClient(config, this.config.deploymentConfig, this.config.destination);
  }
}

/**
 * Applies parameter overrides from AI SDK options and modelParams, with camelCase → snake_case conversion.
 * @param modelParams - The model parameters object (modified in place).
 * @param options - AI SDK language model call options.
 * @param sapModelParams - SAP-specific modelParams from providerOptions.
 * @param settingsModelParams - modelParams from provider settings.
 * @internal
 */
function applyParameterOverrides(
  modelParams: SAPModelParams,
  options: Record<string, unknown>,
  sapModelParams: Record<string, unknown> | undefined,
  settingsModelParams: Record<string, unknown> | undefined,
): void {
  const params = modelParams as Record<string, unknown>;

  for (const mapping of PARAM_MAPPINGS) {
    const value =
      (mapping.optionKey ? options[mapping.optionKey] : undefined) ??
      (mapping.camelCaseKey ? sapModelParams?.[mapping.camelCaseKey] : undefined) ??
      (mapping.camelCaseKey ? settingsModelParams?.[mapping.camelCaseKey] : undefined);

    if (value !== undefined) {
      params[mapping.outputKey] = value;
    }

    if (mapping.camelCaseKey && mapping.camelCaseKey !== mapping.outputKey) {
      Reflect.deleteProperty(params, mapping.camelCaseKey);
    }
  }
}

/**
 * Builds SAP AI SDK-compatible tool parameters from a JSON schema.
 * @param schema - The JSON schema to convert.
 * @returns SAP AI SDK tool parameters with type 'object'.
 * @internal
 */
function buildSAPToolParameters(schema: Record<string, unknown>): SAPToolParameters {
  const schemaType = schema.type;

  if (schemaType !== undefined && schemaType !== "object") {
    return {
      properties: {},
      required: [],
      type: "object",
    };
  }

  const properties =
    schema.properties && typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : {};

  const required =
    Array.isArray(schema.required) && schema.required.every((item) => typeof item === "string")
      ? schema.required
      : [];

  const additionalFields = Object.fromEntries(
    Object.entries(schema).filter(
      ([key]) => key !== "type" && key !== "properties" && key !== "required",
    ),
  );

  return {
    properties,
    required,
    type: "object",
    ...additionalFields,
  };
}

/**
 * Creates a summary of Vercel AI SDK request options for error context.
 * @param options - The Vercel AI SDK language model call options.
 * @returns A summary object with key request parameters for debugging.
 * @internal
 */
function createAISDKRequestBodySummary(options: LanguageModelV3CallOptions): {
  hasImageParts: boolean;
  maxOutputTokens?: number;
  promptMessages: number;
  responseFormatType?: string;
  seed?: number;
  stopSequences?: number;
  temperature?: number;
  toolChoiceType?: string;
  tools: number;
  topK?: number;
  topP?: number;
} {
  return {
    hasImageParts: options.prompt.some(
      (message) =>
        message.role === "user" &&
        message.content.some((part) => part.type === "file" && part.mediaType.startsWith("image/")),
    ),
    maxOutputTokens: options.maxOutputTokens,
    promptMessages: options.prompt.length,
    responseFormatType: options.responseFormat?.type,
    seed: options.seed,
    stopSequences: options.stopSequences?.length,
    temperature: options.temperature,
    toolChoiceType: options.toolChoice?.type,
    tools: options.tools?.length ?? 0,
    topK: options.topK,
    topP: options.topP,
  };
}

/**
 * Type guard for objects with a callable parse method.
 * @param obj - The object to check.
 * @returns True if the object has a callable parse method.
 * @internal
 */
function hasCallableParse(
  obj: Record<string, unknown>,
): obj is Record<string, unknown> & { parse: (...args: unknown[]) => unknown } {
  return typeof obj.parse === "function";
}

/**
 * Type guard for Zod schema objects.
 * @param obj - The value to check.
 * @returns True if the value is a Zod schema with _def and parse properties.
 * @internal
 */
function isZodSchema(obj: unknown): obj is ZodType {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return "_def" in record && "parse" in record && hasCallableParse(record);
}

/**
 * Maps provider finish reasons to Vercel AI SDK LanguageModelV3FinishReason.
 * @param reason - The raw finish reason string from the model provider.
 * @returns The mapped Vercel AI SDK finish reason object.
 * @internal
 */
function mapFinishReason(reason: string | undefined): LanguageModelV3FinishReason {
  const raw = reason;

  if (!reason) return { raw, unified: "other" };

  switch (reason.toLowerCase()) {
    case "content_filter":
      return { raw, unified: "content-filter" };
    case "end_turn":
    case "eos":
    case "stop":
    case "stop_sequence":
      return { raw, unified: "stop" };
    case "error":
      return { raw, unified: "error" };
    case "function_call":
    case "tool_call":
    case "tool_calls":
      return { raw, unified: "tool-calls" };
    case "length":
    case "max_tokens":
    case "max_tokens_reached":
      return { raw, unified: "length" };
    default:
      return { raw, unified: "other" };
  }
}
