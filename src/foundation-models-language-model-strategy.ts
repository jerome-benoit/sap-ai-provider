/** Foundation Models language model strategy using `@sap-ai-sdk/foundation-models`. */
import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import type {
  AzureOpenAiChatClient,
  AzureOpenAiChatCompletionParameters,
  AzureOpenAiChatCompletionTool,
} from "@sap-ai-sdk/foundation-models";
import type { ChatMessage } from "@sap-ai-sdk/orchestration";

import type { FoundationModelsModelSettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import {
  BaseLanguageModelStrategy,
  type CommonBuildResult,
  type StreamCallResponse,
} from "./base-language-model-strategy.js";
import { normalizeHeaders } from "./sap-ai-error.js";
import {
  buildModelDeployment,
  convertResponseFormat,
  convertToolsToSAPFormat,
  extractCompletionId,
  type ParamMapping,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
} from "./strategy-utils.js";

/** @internal */
type FoundationModelsClient = InstanceType<typeof AzureOpenAiChatClient>;

/**
 * Foundation Models API parameter mappings.
 * @internal
 */
const FOUNDATION_MODELS_PARAM_MAPPINGS: readonly ParamMapping[] = [
  ...BaseLanguageModelStrategy.COMMON_PARAM_MAPPINGS,
  { camelCaseKey: "logprobs", outputKey: "logprobs" },
  { camelCaseKey: "topLogprobs", outputKey: "top_logprobs" },
  { camelCaseKey: "logitBias", outputKey: "logit_bias" },
  { camelCaseKey: "user", outputKey: "user" },
  { camelCaseKey: "n", outputKey: "n" },
] as const;

/**
 * Language model strategy for the Foundation Models API.
 *
 * Provides direct access to Azure OpenAI models with parameters like:
 * - logprobs
 * - seed
 * - dataSources (On Your Data)
 * @internal
 */
export class FoundationModelsLanguageModelStrategy extends BaseLanguageModelStrategy<
  FoundationModelsClient,
  AzureOpenAiChatCompletionParameters,
  FoundationModelsModelSettings
> {
  private readonly ClientClass: typeof AzureOpenAiChatClient;

  constructor(ClientClass: typeof AzureOpenAiChatClient) {
    super();
    this.ClientClass = ClientClass;
  }

  protected buildRequest(
    _config: LanguageModelStrategyConfig,
    settings: FoundationModelsModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): {
    readonly request: AzureOpenAiChatCompletionParameters;
    readonly warnings: SharedV3Warning[];
  } {
    const warnings: SharedV3Warning[] = [];

    const toolsResult = convertToolsToSAPFormat<AzureOpenAiChatCompletionTool>(options.tools);
    warnings.push(...toolsResult.warnings);

    const { responseFormat, warning: responseFormatWarning } = convertResponseFormat(
      options.responseFormat,
      settings.responseFormat,
    );
    if (responseFormatWarning) {
      warnings.push(responseFormatWarning);
    }

    const { toolChoice } = commonParts;

    const request: AzureOpenAiChatCompletionParameters = {
      messages: commonParts.messages as AzureOpenAiChatCompletionParameters["messages"],
      ...commonParts.modelParams,
      ...(toolsResult.tools?.length ? { tools: toolsResult.tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(settings.dataSources?.length
        ? {
            data_sources: settings.dataSources,
          }
        : {}),
    };

    return { request, warnings };
  }

  protected createClient(
    config: LanguageModelStrategyConfig,
    settings: FoundationModelsModelSettings,
    _commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): FoundationModelsClient {
    const modelDeployment = buildModelDeployment(config, settings.modelVersion);
    return new this.ClientClass(modelDeployment, config.destination);
  }

  protected async executeApiCall(
    client: FoundationModelsClient,
    request: AzureOpenAiChatCompletionParameters,
    abortSignal: AbortSignal | undefined,
  ): Promise<SDKResponse> {
    const response = await client.run(request, abortSignal ? { signal: abortSignal } : undefined);

    const completionId = extractCompletionId(response, ["id"]);

    return {
      getContent: () => response.getContent(),
      getFinishReason: () => response.getFinishReason(),
      getTokenUsage: () => response.getTokenUsage(),
      getToolCalls: () => response.getToolCalls(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SAP SDK types headers as any
      rawResponse: { headers: response.rawResponse.headers },
      responseId: completionId,
    };
  }

  protected async executeStreamCall(
    client: FoundationModelsClient,
    request: AzureOpenAiChatCompletionParameters,
    abortSignal: AbortSignal | undefined,
    _settings: FoundationModelsModelSettings,
  ): Promise<StreamCallResponse> {
    const streamResponse = await client.stream(request, abortSignal);

    // `rawResponse` is unavailable when the stream was built via the deprecated 0-arg constructor.
    let responseHeaders: Record<string, string> | undefined;
    try {
      responseHeaders = normalizeHeaders(streamResponse.rawResponse.headers);
    } catch {
      responseHeaders = undefined;
    }

    return {
      getFinishReason: () => streamResponse.getFinishReason(),
      getTokenUsage: () => streamResponse.getTokenUsage(),
      responseHeaders,
      responseId: streamResponse.getRequestId(),
      stream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
    };
  }

  protected getParamMappings(): readonly ParamMapping[] {
    return FOUNDATION_MODELS_PARAM_MAPPINGS;
  }

  protected getUrl(): string {
    return "sap-ai:foundation-models";
  }
}
