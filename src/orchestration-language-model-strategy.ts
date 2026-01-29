/**
 * Orchestration Language Model Strategy - Implementation using `@sap-ai-sdk/orchestration`.
 *
 * This strategy is stateless - it holds only a reference to the OrchestrationClient class.
 * All tenant-specific configuration flows through method parameters for security.
 */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { LlmModelParams } from "@sap-ai-sdk/orchestration";
import type {
  ChatCompletionTool,
  ChatMessage,
  OrchestrationClient,
  OrchestrationModuleConfig,
} from "@sap-ai-sdk/orchestration";
import type { Template } from "@sap-ai-sdk/orchestration/dist/client/api/schema/template.js";

import { parseProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";

import type { OrchestrationModelSettings, SAPAIModelSettings } from "./sap-ai-settings.js";
import type { LanguageModelAPIStrategy, LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";
import { deepMerge } from "./deep-merge.js";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import {
  getProviderName,
  sapAILanguageModelProviderOptions,
  validateModelParamsWithWarnings,
} from "./sap-ai-provider-options.js";
import {
  applyParameterOverrides,
  buildSAPToolParameters,
  createAISDKRequestBodySummary,
  createInitialStreamState,
  type FunctionToolWithParameters,
  isZodSchema,
  mapFinishReason,
  type ParamMapping,
  type SAPToolParameters,
  StreamIdGenerator,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * Extended prompt templating structure with tools and response_format.
 * The SAP SDK type doesn't expose these properties, but they are set when building the config.
 * @internal
 */
interface ExtendedPromptTemplating {
  prompt: {
    response_format?: unknown;
    tools?: unknown;
  };
}

/**
 * Extended model parameters for SAP Orchestration API.
 * Includes standard LLM parameters plus SAP-specific extensions.
 * @internal
 */
type SAPModelParams = LlmModelParams & {
  parallel_tool_calls?: boolean;
  seed?: number;
  stop?: string[];
  top_k?: number;
};

/**
 * Response format configuration from the Orchestration template.
 * @internal
 */
type SAPResponseFormat = Template["response_format"];

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
 * Type for the OrchestrationClient class constructor.
 * @internal
 */
type OrchestrationClientClass = typeof OrchestrationClient;

/**
 * Orchestration Language Model Strategy.
 *
 * Implements language model operations using the SAP AI SDK Orchestration API.
 * This class is stateless - it only holds a reference to the OrchestrationClient class.
 * @internal
 */
export class OrchestrationLanguageModelStrategy implements LanguageModelAPIStrategy {
  private readonly ClientClass: OrchestrationClientClass;

  /**
   * Creates a new OrchestrationLanguageModelStrategy.
   * @param ClientClass - The OrchestrationClient class from `@sap-ai-sdk/orchestration`.
   */
  constructor(ClientClass: OrchestrationClientClass) {
    this.ClientClass = ClientClass;
  }

  /**
   * Generates a single completion (non-streaming).
   *
   * Builds orchestration configuration, converts messages, validates parameters,
   * calls SAP AI SDK, and processes the response.
   * @param config - The language model strategy configuration.
   * @param settings - The SAP AI model settings.
   * @param options - The Vercel AI SDK language model call options.
   * @returns A Promise resolving to the generation result.
   * @throws {Error} When the SAP AI SDK request fails.
   */
  async doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    try {
      const { messages, orchestrationConfig, warnings } = await this.buildOrchestrationConfig(
        config,
        settings,
        options,
      );

      const client = this.createClient(config, orchestrationConfig);

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

      const providerName = getProviderName(config.provider);

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
          modelId: config.modelId,
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
   * @param config - The language model strategy configuration.
   * @param settings - The SAP AI model settings.
   * @param options - The Vercel AI SDK language model call options.
   * @returns A Promise resolving to the streaming result.
   * @throws {Error} When the SAP AI SDK streaming request fails.
   */
  async doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    try {
      const { messages, orchestrationConfig, warnings } = await this.buildOrchestrationConfig(
        config,
        settings,
        options,
      );

      const client = this.createClient(config, orchestrationConfig);

      const requestBody = this.buildRequestBody(messages, orchestrationConfig);

      const streamResponse = await client.stream(requestBody, options.abortSignal, {
        promptTemplating: { include_usage: true },
      });

      const idGenerator = new StreamIdGenerator();

      // Client-generated UUID; TODO: use backend x-request-id when SDK exposes rawResponse
      const responseId = idGenerator.generateResponseId();

      let textBlockId: null | string = null;

      const streamState = createInitialStreamState();

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
      const modelId = config.modelId;
      const providerName = getProviderName(config.provider);

      const warningsSnapshot = [...warnings];

      const transformedStream = new ReadableStream<LanguageModelV3StreamPart>({
        cancel() {
          // No cleanup needed - SDK handles stream cancellation internally
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
   * Builds the SAP AI SDK orchestration configuration from Vercel AI SDK call options.
   * @param config - The language model strategy configuration.
   * @param settings - The SAP AI model settings.
   * @param options - The Vercel AI SDK language model call options.
   * @returns A Promise resolving to the messages, orchestration config, and warnings.
   * @internal
   */
  private async buildOrchestrationConfig(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<{
    messages: ChatMessage[];
    orchestrationConfig: OrchestrationModuleConfig;
    warnings: SharedV3Warning[];
  }> {
    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const warnings: SharedV3Warning[] = [];

    const orchSettings = settings as OrchestrationModelSettings;

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders:
        sapOptions?.escapeTemplatePlaceholders ?? orchSettings.escapeTemplatePlaceholders ?? true,
      includeReasoning: sapOptions?.includeReasoning ?? orchSettings.includeReasoning ?? false,
    });

    let tools: ChatCompletionTool[] | undefined;

    const settingsTools = orchSettings.tools;
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

    const modelParams: SAPModelParams = deepMerge(
      orchSettings.modelParams ?? {},
      sapOptions?.modelParams ?? {},
    );

    applyParameterOverrides(
      modelParams as Record<string, unknown>,
      options as Record<string, unknown>,
      sapOptions?.modelParams as Record<string, unknown> | undefined,
      orchSettings.modelParams as Record<string, unknown> | undefined,
      PARAM_MAPPINGS,
    );

    if (options.stopSequences && options.stopSequences.length > 0) {
      modelParams.stop = options.stopSequences;
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
    } else if (orchSettings.responseFormat) {
      responseFormat = orchSettings.responseFormat as SAPResponseFormat;
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
          name: config.modelId,
          params: modelParams,
          version: orchSettings.modelVersion ?? "latest",
        },
        prompt: {
          template: [],
          tools: tools && tools.length > 0 ? tools : undefined,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        },
      },
      ...(orchSettings.masking && Object.keys(orchSettings.masking as object).length > 0
        ? { masking: orchSettings.masking }
        : {}),
      ...(orchSettings.filtering && Object.keys(orchSettings.filtering as object).length > 0
        ? { filtering: orchSettings.filtering }
        : {}),
      ...(orchSettings.grounding && Object.keys(orchSettings.grounding as object).length > 0
        ? { grounding: orchSettings.grounding }
        : {}),
      ...(orchSettings.translation && Object.keys(orchSettings.translation as object).length > 0
        ? { translation: orchSettings.translation }
        : {}),
    };

    return { messages, orchestrationConfig, warnings };
  }

  /**
   * Builds the request body for SAP AI SDK chat completion or streaming.
   * @param messages - The chat messages to send.
   * @param orchestrationConfig - The orchestration module configuration.
   * @returns The request body object for the SAP AI SDK.
   * @internal
   */
  private buildRequestBody(
    messages: ChatMessage[],
    orchestrationConfig: OrchestrationModuleConfig,
  ): Record<string, unknown> {
    const promptTemplating = orchestrationConfig.promptTemplating as ExtendedPromptTemplating;

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
   * @param config - The language model strategy configuration.
   * @param orchConfig - The orchestration module configuration.
   * @returns A new OrchestrationClient instance.
   * @internal
   */
  private createClient(
    config: LanguageModelStrategyConfig,
    orchConfig: OrchestrationModuleConfig,
  ): InstanceType<OrchestrationClientClass> {
    return new this.ClientClass(orchConfig, config.deploymentConfig, config.destination);
  }
}
