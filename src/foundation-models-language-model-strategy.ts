/** Foundation Models language model strategy using `@sap-ai-sdk/foundation-models`. */
import type { LanguageModelV3CallOptions, SharedV3Warning } from "@ai-sdk/provider";
import type {
  AzureOpenAiChatClient,
  AzureOpenAiChatCompletionParameters,
  AzureOpenAiChatCompletionTool,
} from "@sap-ai-sdk/foundation-models";

import type { FoundationModelsModelSettings, SAPAIModelSettings } from "./sap-ai-settings.js";
import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import {
  BaseLanguageModelStrategy,
  type CommonBuildResult,
} from "./base-language-model-strategy.js";
import {
  type AISDKTool,
  buildModelDeployment,
  convertResponseFormat,
  convertToolsToSAPFormat,
  type ParamMapping,
  type SDKResponse,
  type SDKStreamChunk,
} from "./strategy-utils.js";

/**
 * Foundation Models API parameter mappings.
 * Extends common mappings with FM-specific parameters.
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
export class FoundationModelsLanguageModelStrategy extends BaseLanguageModelStrategy {
  private readonly ClientClass: typeof AzureOpenAiChatClient;

  constructor(ClientClass: typeof AzureOpenAiChatClient) {
    super();
    this.ClientClass = ClientClass;
  }

  protected buildRequest(
    config: LanguageModelStrategyConfig,
    settings: FoundationModelsModelSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult,
  ): Promise<{
    readonly request: AzureOpenAiChatCompletionParameters;
    readonly warnings: SharedV3Warning[];
  }> {
    const warnings: SharedV3Warning[] = [];

    // Tools conversion (FM doesn't support settings.tools)
    const toolsResult = convertToolsToSAPFormat<AzureOpenAiChatCompletionTool>(
      options.tools as AISDKTool[] | undefined,
    );
    warnings.push(...toolsResult.warnings);

    // Response format conversion
    const { responseFormat, warning: responseFormatWarning } = convertResponseFormat(
      options.responseFormat,
      settings.responseFormat,
    );
    if (responseFormatWarning) {
      warnings.push(responseFormatWarning);
    }

    // Build Azure OpenAI request
    const toolChoice = commonParts.toolChoice as
      | "auto"
      | "none"
      | "required"
      | undefined
      | { function: { name: string }; type: "function" };

    const request: AzureOpenAiChatCompletionParameters = {
      messages: commonParts.messages as AzureOpenAiChatCompletionParameters["messages"],
      ...commonParts.modelParams,
      ...(toolsResult.tools?.length ? { tools: toolsResult.tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(settings.dataSources?.length
        ? {
            data_sources:
              settings.dataSources as AzureOpenAiChatCompletionParameters["data_sources"],
          }
        : {}),
    };

    return Promise.resolve({ request, warnings });
  }

  protected createClient(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
  ): InstanceType<typeof AzureOpenAiChatClient> {
    const fmSettings = settings as FoundationModelsModelSettings;
    const modelDeployment = buildModelDeployment(config, fmSettings.modelVersion);
    return new this.ClientClass(modelDeployment, config.destination);
  }

  protected async executeApiCall(
    client: unknown,
    request: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<SDKResponse> {
    const fmClient = client as InstanceType<typeof AzureOpenAiChatClient>;
    const response = await fmClient.run(
      request as AzureOpenAiChatCompletionParameters,
      abortSignal ? { signal: abortSignal } : undefined,
    );

    return {
      getContent: () => response.getContent(),
      getFinishReason: () => response.getFinishReason(),
      getTokenUsage: () => response.getTokenUsage(),
      getToolCalls: () => response.getToolCalls(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SAP SDK types headers as any
      rawResponse: { headers: response.rawResponse.headers },
    };
  }

  protected async executeStreamCall(
    client: unknown,
    request: unknown,
    abortSignal: AbortSignal | undefined,
  ): Promise<{
    readonly getFinishReason: () => null | string | undefined;
    readonly getTokenUsage: () =>
      | null
      | undefined
      | { completion_tokens?: number; prompt_tokens?: number };
    readonly stream: AsyncIterable<SDKStreamChunk>;
  }> {
    const fmClient = client as InstanceType<typeof AzureOpenAiChatClient>;
    const streamResponse = await fmClient.stream(
      request as AzureOpenAiChatCompletionParameters,
      abortSignal,
    );

    return {
      getFinishReason: () => streamResponse.getFinishReason(),
      getTokenUsage: () => streamResponse.getTokenUsage(),
      stream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
    };
  }

  protected getEscapeTemplatePlaceholders(): boolean {
    // Foundation Models API doesn't use template placeholders
    return false;
  }

  protected getIncludeReasoning(
    sapOptions: Record<string, unknown> | undefined,
    settings: SAPAIModelSettings,
  ): boolean {
    const fmSettings = settings as FoundationModelsModelSettings;
    return (
      (sapOptions?.includeReasoning as boolean | undefined) ?? fmSettings.includeReasoning ?? false
    );
  }

  protected getParamMappings(): readonly ParamMapping[] {
    return FOUNDATION_MODELS_PARAM_MAPPINGS;
  }

  protected getUrl(): string {
    return "sap-ai:foundation-models";
  }
}
