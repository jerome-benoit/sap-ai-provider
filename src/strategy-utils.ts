/**
 * Shared utilities for SAP AI Core strategy implementations.
 */
import type {
  EmbeddingModelV3CallOptions,
  EmbeddingModelV3Embedding,
  EmbeddingModelV3Result,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { DeploymentIdConfig, ResourceGroupConfig } from "@sap-ai-sdk/ai-api/internal.js";
import type { ZodType } from "zod";

import { TooManyEmbeddingValuesForCallError } from "@ai-sdk/provider";
import { parseProviderOptions } from "@ai-sdk/provider-utils";
import { z } from "zod";

import { deepMerge } from "./deep-merge.js";
import { getProviderName, sapAIEmbeddingProviderOptions } from "./sap-ai-provider-options.js";
import { validateModelParamsWithWarnings } from "./sap-ai-provider-options.js";

/**
 * @internal
 */
export interface AISDKTool {
  description?: string;
  inputSchema?: unknown;
  name: string;
  type: string;
}

/**
 * @internal
 */
export type AISDKToolChoice =
  | { toolName: string; type: "tool" }
  | { type: "auto" }
  | { type: "none" }
  | { type: "required" };

/**
 * @internal
 */
export interface BaseEmbeddingConfig {
  readonly maxEmbeddingsPerCall: number;
  readonly modelId: string;
  readonly provider: string;
}

/**
 * @internal
 */
export interface BaseModelDeploymentConfig {
  readonly deploymentConfig: DeploymentIdConfig | ResourceGroupConfig;
  readonly modelId: string;
}

/**
 * @internal
 */
export interface BuildModelParamsConfig {
  readonly options: LanguageModelV3CallOptions;
  readonly paramMappings: readonly ParamMapping[];
  readonly providerModelParams?: Record<string, unknown>;
  readonly settingsModelParams?: Record<string, unknown>;
}

/**
 * @internal
 */
export interface BuildModelParamsResult {
  readonly modelParams: Record<string, unknown>;
  readonly warnings: SharedV3Warning[];
}

/**
 * @internal
 */
export interface ConvertedResponseFormatResult {
  readonly responseFormat: SAPResponseFormat | undefined;
  readonly warning: SharedV3Warning | undefined;
}

/**
 * @internal
 */
export interface ConvertedToolsResult<T> {
  readonly tools: T[] | undefined;
  readonly warnings: SharedV3Warning[];
}

/**
 * Parsed embedding provider options from AI SDK call.
 * @internal
 */
export interface EmbeddingProviderOptions {
  readonly modelParams?: Record<string, unknown>;
  readonly type?: EmbeddingType;
}

/**
 * @internal
 */
export interface EmbeddingResultConfig {
  readonly embeddings: EmbeddingModelV3Embedding[];
  readonly modelId: string;
  readonly providerName: string;
  readonly totalTokens: number;
  readonly version: string;
}

/**
 * Valid embedding types for orchestration API.
 * @internal
 */
export type EmbeddingType = "document" | "query" | "text";

/**
 * @internal
 */
export interface ExtractedToolParameters {
  readonly parameters: SAPToolParameters;
  readonly warning?: SharedV3Warning;
}

/**
 * @internal
 */
export interface FunctionToolWithParameters extends LanguageModelV3FunctionTool {
  readonly parameters?: unknown;
}

/**
 * @internal
 */
export interface GenerateResultConfig {
  readonly modelId: string;
  readonly providerName: string;
  readonly requestBody: unknown;
  readonly response: SDKResponse;
  readonly responseHeaders: Record<string, string> | undefined;
  readonly version: string;
  readonly warnings: SharedV3Warning[];
}

/**
 * Parameter mapping for AI SDK options → SAP model params.
 * @internal
 */
export interface ParamMapping {
  readonly camelCaseKey?: string;
  readonly optionKey?: string;
  readonly outputKey: string;
}

/**
 * @internal
 */
export type SAPResponseFormat =
  | {
      json_schema: {
        description?: string;
        name: string;
        schema: Record<string, unknown>;
        strict: boolean | null;
      };
      type: "json_schema";
    }
  | { type: "json_object" }
  | { type: "text" };

/**
 * @internal
 */
export interface SAPTool<P = SAPToolParameters> {
  function: {
    description?: string;
    name: string;
    parameters?: P;
  };
  type: "function";
}

/**
 * @internal
 */
export type SAPToolChoice =
  | "auto"
  | "none"
  | "required"
  | { function: { name: string }; type: "function" };

/**
 * @internal
 */
export type SAPToolParameters = Record<string, unknown> & {
  type: "object";
};

/**
 * @internal
 */
export interface SDKResponse {
  getContent(): null | string | undefined;
  getFinishReason(): null | string | undefined;
  getTokenUsage(): undefined | { completion_tokens?: number; prompt_tokens?: number };
  getToolCalls():
    | null
    | undefined
    | {
        function: { arguments: string; name: string };
        id: string;
      }[];
  rawResponse: { headers: Headers | Record<string, string> };
}

/**
 * @internal
 */
export interface SDKStreamChunk {
  _data?: unknown;
  getDeltaContent(): null | string | undefined;
  getDeltaToolCalls():
    | null
    | undefined
    | {
        function?: { arguments?: string; name?: string };
        id?: string;
        index?: number;
      }[];
  getFinishReason(): null | string | undefined;
}

/**
 * @internal
 */
export interface StreamState {
  activeText: boolean;
  finishReason: LanguageModelV3FinishReason;
  isFirstChunk: boolean;
  usage: {
    inputTokens: {
      cacheRead: number | undefined;
      cacheWrite: number | undefined;
      noCache: number | undefined;
      total: number | undefined;
    };
    outputTokens: {
      reasoning: number | undefined;
      text: number | undefined;
      total: number | undefined;
    };
  };
}

/**
 * @internal
 */
export interface StreamTransformerConfig {
  readonly convertToAISDKError: (
    error: unknown,
    context: { operation: string; requestBody: unknown; url: string },
  ) => unknown;
  readonly idGenerator: StreamIdGenerator;
  readonly includeRawChunks: boolean;
  readonly modelId: string;
  readonly options: LanguageModelV3CallOptions;
  readonly providerName: string;
  readonly responseId: string;
  readonly sdkStream: AsyncIterable<SDKStreamChunk>;
  readonly streamResponseGetFinishReason: () => null | string | undefined;
  readonly streamResponseGetTokenUsage: () =>
    | null
    | undefined
    | { completion_tokens?: number; prompt_tokens?: number };
  readonly url: string;
  readonly version: string;
  readonly warnings: readonly SharedV3Warning[];
}

/**
 * @internal
 */
export interface ToolCallInProgress {
  arguments: string;
  didEmitCall: boolean;
  didEmitInputStart: boolean;
  id: string;
  toolName?: string;
}

/**
 * @internal
 */
export class StreamIdGenerator {
  /**
   * @returns A UUID string for identifying the response.
   */
  generateResponseId(): string {
    return crypto.randomUUID();
  }

  /**
   * @returns A UUID string for identifying a text block.
   */
  generateTextBlockId(): string {
    return crypto.randomUUID();
  }
}

/**
 * Applies parameter overrides from AI SDK options and modelParams.
 * @param modelParams - The model parameters object to modify.
 * @param options - AI SDK call options.
 * @param sapModelParams - Provider options model params.
 * @param settingsModelParams - Settings model params.
 * @param mappings - Parameter mappings for this strategy.
 * @internal
 */
export function applyParameterOverrides(
  modelParams: Record<string, unknown>,
  options: Record<string, unknown>,
  sapModelParams: Record<string, unknown> | undefined,
  settingsModelParams: Record<string, unknown> | undefined,
  mappings: readonly ParamMapping[],
): void {
  for (const mapping of mappings) {
    const value =
      (mapping.optionKey ? options[mapping.optionKey] : undefined) ??
      (mapping.camelCaseKey ? sapModelParams?.[mapping.camelCaseKey] : undefined) ??
      (mapping.camelCaseKey ? settingsModelParams?.[mapping.camelCaseKey] : undefined);

    if (value !== undefined) {
      modelParams[mapping.outputKey] = value;
    }

    if (mapping.camelCaseKey && mapping.camelCaseKey !== mapping.outputKey) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete modelParams[mapping.camelCaseKey];
    }
  }
}

/**
 * Builds an EmbeddingModelV3Result from embedding data.
 * @param config - Configuration with embeddings and metadata.
 * @returns Complete embedding result for AI SDK.
 * @internal
 */
export function buildEmbeddingResult(config: EmbeddingResultConfig): EmbeddingModelV3Result {
  const { embeddings, modelId, providerName, totalTokens, version } = config;

  const providerMetadata: SharedV3ProviderMetadata = {
    [providerName]: {
      model: modelId,
      version,
    },
  };

  return {
    embeddings,
    providerMetadata,
    usage: { tokens: totalTokens },
    warnings: [],
  };
}

/**
 * Builds a LanguageModelV3GenerateResult from SDK response.
 * @param config - Configuration with response and metadata.
 * @returns Complete generate result for AI SDK.
 * @internal
 */
export function buildGenerateResult(config: GenerateResultConfig): LanguageModelV3GenerateResult {
  const { modelId, providerName, requestBody, response, responseHeaders, version, warnings } =
    config;

  const content = extractResponseContent(response);

  const tokenUsage = response.getTokenUsage();
  const finishReasonRaw = response.getFinishReason();
  const finishReason = mapFinishReason(finishReasonRaw);

  const textContent = response.getContent();
  const toolCalls = response.getToolCalls();

  const rawResponseBody = {
    content: textContent,
    finishReason: finishReasonRaw,
    tokenUsage,
    toolCalls,
  };

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
        version,
      },
    },
    request: {
      body: requestBody,
    },
    response: {
      body: rawResponseBody,
      headers: responseHeaders,
      modelId,
      timestamp: new Date(),
    },
    usage: {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: tokenUsage?.prompt_tokens,
        total: tokenUsage?.prompt_tokens,
      },
      outputTokens: {
        reasoning: undefined,
        text: tokenUsage?.completion_tokens,
        total: tokenUsage?.completion_tokens,
      },
    },
    warnings,
  };
}

/**
 * Builds a ModelDeployment object for the Foundation Models API SDK.
 * @param config - The strategy configuration containing deployment info and model ID.
 * @param modelVersion - Optional model version for model-based resolution.
 * @returns A ModelDeployment object for the Foundation Models API SDK.
 * @internal
 */
export function buildModelDeployment(
  config: BaseModelDeploymentConfig,
  modelVersion?: string,
): { deploymentId: string } | { modelName: string; modelVersion?: string; resourceGroup?: string } {
  const deploymentConfig = config.deploymentConfig;

  if ("deploymentId" in deploymentConfig) {
    return { deploymentId: deploymentConfig.deploymentId };
  }

  const resourceGroup =
    "resourceGroup" in deploymentConfig ? deploymentConfig.resourceGroup : undefined;

  return {
    modelName: config.modelId,
    ...(modelVersion && { modelVersion }),
    ...(resourceGroup && { resourceGroup }),
  };
}

/**
 * Builds and validates model parameters from multiple sources.
 * @param config - Configuration with options, mappings, and source parameters.
 * @returns The merged model parameters and validation warnings.
 * @internal
 */
export function buildModelParams(config: BuildModelParamsConfig): BuildModelParamsResult {
  const { options, paramMappings, providerModelParams, settingsModelParams } = config;
  const warnings: SharedV3Warning[] = [];

  const modelParams: Record<string, unknown> = deepMerge(
    settingsModelParams ?? {},
    providerModelParams ?? {},
  );

  applyParameterOverrides(
    modelParams,
    options as Record<string, unknown>,
    providerModelParams,
    settingsModelParams,
    paramMappings,
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

  return { modelParams, warnings };
}

/**
 * Builds SAP AI SDK-compatible tool parameters from a JSON schema.
 * @param schema - The JSON schema to convert.
 * @returns The SAP-compatible tool parameters object.
 * @internal
 */
export function buildSAPToolParameters(schema: Record<string, unknown>): SAPToolParameters {
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
 * Converts AI SDK response format to SAP-compatible format.
 * @param optionsResponseFormat - The AI SDK response format from call options.
 * @param settingsResponseFormat - The fallback response format from settings.
 * @returns The converted response format and any warning.
 * @internal
 */
export function convertResponseFormat(
  optionsResponseFormat: LanguageModelV3CallOptions["responseFormat"],
  settingsResponseFormat?: unknown,
): ConvertedResponseFormatResult {
  let responseFormat: SAPResponseFormat | undefined;
  let warning: SharedV3Warning | undefined;

  if (optionsResponseFormat?.type === "json") {
    responseFormat = optionsResponseFormat.schema
      ? {
          json_schema: {
            description: optionsResponseFormat.description,
            name: optionsResponseFormat.name ?? "response",
            schema: optionsResponseFormat.schema as Record<string, unknown>,
            strict: null,
          },
          type: "json_schema" as const,
        }
      : { type: "json_object" as const };
  } else if (settingsResponseFormat) {
    responseFormat = settingsResponseFormat as SAPResponseFormat;
  }

  if (responseFormat && responseFormat.type !== "text") {
    warning = {
      message:
        "responseFormat JSON mode is forwarded to the underlying model; support and schema adherence depend on the model/deployment.",
      type: "other",
    };
  }

  return { responseFormat, warning };
}

/**
 * Converts AI SDK tools to SAP-compatible tool format.
 * @param tools - The AI SDK tools to convert.
 * @returns The converted tools and any warnings.
 * @internal
 */
export function convertToolsToSAPFormat<T extends SAPTool<unknown>>(
  tools: AISDKTool[] | undefined,
): ConvertedToolsResult<T> {
  const warnings: SharedV3Warning[] = [];

  if (!tools || tools.length === 0) {
    return { tools: undefined, warnings };
  }

  const convertedTools = tools
    .map((tool): null | T => {
      if (tool.type === "function") {
        const { parameters, warning } = extractToolParameters(tool as LanguageModelV3FunctionTool);
        if (warning) {
          warnings.push(warning);
        }

        return {
          function: {
            name: tool.name,
            parameters,
            ...(tool.description ? { description: tool.description } : {}),
          },
          type: "function",
        } as T;
      } else {
        warnings.push({
          details: "Only 'function' tool type is supported.",
          feature: `tool type for ${tool.name}`,
          type: "unsupported",
        });
        return null;
      }
    })
    .filter((t): t is T => t !== null);

  return {
    tools: convertedTools.length > 0 ? convertedTools : undefined,
    warnings,
  };
}

/**
 * Creates a summary of Vercel AI SDK request options for error context.
 * @param options - The language model call options to summarize.
 * @returns An object summarizing the request for debugging.
 * @internal
 */
export function createAISDKRequestBodySummary(options: LanguageModelV3CallOptions): {
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
 * Creates the initial stream state for processing streaming responses.
 * @returns The initial stream state object.
 * @internal
 */
export function createInitialStreamState(): StreamState {
  return {
    activeText: false,
    finishReason: {
      raw: undefined,
      unified: "other" as const,
    },
    isFirstChunk: true,
    usage: {
      inputTokens: {
        cacheRead: undefined,
        cacheWrite: undefined,
        noCache: undefined,
        total: undefined,
      },
      outputTokens: {
        reasoning: undefined,
        text: undefined,
        total: undefined,
      },
    },
  };
}

/**
 * Creates a ReadableStream that transforms SAP AI SDK streaming responses
 * into Vercel AI SDK LanguageModelV3StreamPart events.
 * @param config - The stream transformer configuration containing all dependencies.
 * @returns A ReadableStream of LanguageModelV3StreamPart events.
 * @internal
 */
export function createStreamTransformer(
  config: StreamTransformerConfig,
): ReadableStream<LanguageModelV3StreamPart> {
  const {
    convertToAISDKError,
    idGenerator,
    includeRawChunks,
    modelId,
    options,
    providerName,
    responseId,
    sdkStream,
    streamResponseGetFinishReason,
    streamResponseGetTokenUsage,
    url,
    version,
    warnings,
  } = config;

  let textBlockId: null | string = null;
  const streamState = createInitialStreamState();
  const toolCallsInProgress = new Map<number, ToolCallInProgress>();

  return new ReadableStream<LanguageModelV3StreamPart>({
    cancel() {
      // No cleanup needed - SDK handles stream cancellation internally
    },
    async start(controller) {
      controller.enqueue({
        type: "stream-start",
        warnings: [...warnings],
      });

      try {
        for await (const chunk of sdkStream) {
          if (includeRawChunks) {
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

        const finalFinishReason = streamResponseGetFinishReason();
        if (finalFinishReason) {
          streamState.finishReason = mapFinishReason(finalFinishReason);
        } else if (didEmitAnyToolCalls) {
          streamState.finishReason = {
            raw: undefined,
            unified: "tool-calls",
          };
        }

        const finalUsage = streamResponseGetTokenUsage();
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
              version,
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
          url,
        });
        controller.enqueue({
          error: aiError instanceof Error ? aiError : new Error(String(aiError)),
          type: "error",
        });
        controller.close();
      }
    },
  });
}

/**
 * Extracts content (text and tool calls) from SDK response.
 * @param response - SDK response object.
 * @returns Content array for LanguageModelV3GenerateResult.
 * @internal
 */
export function extractResponseContent(response: SDKResponse): LanguageModelV3Content[] {
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

  return content;
}

/**
 * Extracts SAP-compatible tool parameters from an AI SDK function tool.
 * @param tool - The AI SDK function tool to extract parameters from.
 * @returns The extracted parameters and optional warning.
 * @internal
 */
export function extractToolParameters(tool: LanguageModelV3FunctionTool): ExtractedToolParameters {
  const inputSchema = tool.inputSchema as Record<string, unknown> | undefined;
  const toolWithParams = tool as FunctionToolWithParameters;

  if (toolWithParams.parameters && isZodSchema(toolWithParams.parameters)) {
    try {
      const jsonSchema = z.toJSONSchema(toolWithParams.parameters);
      const schemaRecord = jsonSchema as Record<string, unknown>;
      delete schemaRecord.$schema;
      return { parameters: buildSAPToolParameters(schemaRecord) };
    } catch (error) {
      return {
        parameters: buildSAPToolParameters({}),
        warning: {
          details: `Failed to convert tool Zod schema: ${error instanceof Error ? error.message : String(error)}. Falling back to empty object schema.`,
          feature: `tool schema conversion for ${tool.name}`,
          type: "unsupported",
        },
      };
    }
  }

  if (inputSchema && hasKeys(inputSchema)) {
    const hasProperties =
      inputSchema.properties &&
      typeof inputSchema.properties === "object" &&
      hasKeys(inputSchema.properties);

    if (hasProperties) {
      return { parameters: buildSAPToolParameters(inputSchema) };
    }
  }

  return { parameters: buildSAPToolParameters({}) };
}

/**
 * Checks if an object has a callable parse method.
 * @param obj - The object to check for a parse method.
 * @returns True if the object has a callable parse method.
 * @internal
 */
export function hasCallableParse(
  obj: Record<string, unknown>,
): obj is Record<string, unknown> & { parse: (...args: unknown[]) => unknown } {
  return typeof obj.parse === "function";
}

/**
 * Checks if an object has at least one own enumerable property.
 * @param obj - The object to check.
 * @returns True if the object has one or more keys.
 * @internal
 */
export function hasKeys(obj: object): boolean {
  return Object.keys(obj).length > 0;
}

/**
 * Type guard for Zod schema objects.
 * @param obj - The object to check.
 * @returns True if the object is a Zod schema.
 * @internal
 */
export function isZodSchema(obj: unknown): obj is ZodType {
  if (obj === null || typeof obj !== "object") {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return "_def" in record && "parse" in record && hasCallableParse(record);
}

/**
 * Maps provider finish reasons to Vercel AI SDK LanguageModelV3FinishReason.
 * @param reason - The raw finish reason string from the provider.
 * @returns The unified finish reason with both raw and unified representations.
 * @internal
 */
export function mapFinishReason(reason: null | string | undefined): LanguageModelV3FinishReason {
  const raw = reason ?? undefined;

  if (!reason) {
    return { raw, unified: "other" };
  }

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

/**
 * Maps Vercel AI SDK toolChoice to SAP Foundation Models SDK tool_choice format.
 * @param toolChoice - The Vercel AI SDK tool choice.
 * @returns The SAP SDK tool_choice format, or undefined if no mapping needed.
 * @internal
 */
export function mapToolChoice(toolChoice: AISDKToolChoice | undefined): SAPToolChoice | undefined {
  if (!toolChoice) {
    return undefined;
  }

  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "none":
      return "none";
    case "required":
      return "required";
    case "tool":
      return {
        function: { name: toolChoice.toolName },
        type: "function",
      };
    default:
      return undefined;
  }
}

/**
 * Converts SAP AI SDK embedding to Vercel AI SDK format.
 * @param embedding - The embedding as number array or base64 string.
 * @returns The normalized embedding as a number array.
 * @internal
 */
export function normalizeEmbedding(embedding: number[] | string): EmbeddingModelV3Embedding {
  if (Array.isArray(embedding)) {
    return embedding;
  }
  const buffer = Buffer.from(embedding, "base64");
  const float32Array = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(float32Array);
}

/**
 * Prepares embedding call by parsing provider options and validating input count.
 * @param config - Base embedding configuration.
 * @param options - Embedding model call options.
 * @returns Parsed SAP options and provider name.
 * @throws {TooManyEmbeddingValuesForCallError} When input count exceeds maximum.
 * @internal
 */
export async function prepareEmbeddingCall(
  config: BaseEmbeddingConfig,
  options: EmbeddingModelV3CallOptions,
): Promise<{ embeddingOptions: EmbeddingProviderOptions | undefined; providerName: string }> {
  const { maxEmbeddingsPerCall, modelId, provider } = config;
  const { providerOptions, values } = options;

  const providerName = getProviderName(provider);
  const sapOptions = await parseProviderOptions({
    provider: providerName,
    providerOptions,
    schema: sapAIEmbeddingProviderOptions,
  });

  if (values.length > maxEmbeddingsPerCall) {
    throw new TooManyEmbeddingValuesForCallError({
      maxEmbeddingsPerCall,
      modelId,
      provider,
      values,
    });
  }

  return { embeddingOptions: sapOptions, providerName };
}
