/** Foundation Models language model strategy using `@sap-ai-sdk/foundation-models`. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type {
  AzureOpenAiChatClient,
  AzureOpenAiChatCompletionParameters,
  AzureOpenAiChatCompletionTool,
} from "@sap-ai-sdk/foundation-models";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { FoundationModelsModelSettings, SAPAIModelSettings } from "./sap-ai-settings.js";
import type { LanguageModelAPIStrategy, LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import { getProviderName, sapAILanguageModelProviderOptions } from "./sap-ai-provider-options.js";
import {
  buildGenerateResult,
  buildModelDeployment,
  buildModelParams,
  convertResponseFormat,
  convertToolsToSAPFormat,
  createAISDKRequestBodySummary,
  createStreamTransformer,
  mapToolChoice,
  type ParamMapping,
  type SDKResponse,
  type SDKStreamChunk,
  StreamIdGenerator,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * @internal
 */
const PARAM_MAPPINGS: readonly ParamMapping[] = [
  { camelCaseKey: "maxTokens", optionKey: "maxOutputTokens", outputKey: "max_tokens" },
  { camelCaseKey: "temperature", optionKey: "temperature", outputKey: "temperature" },
  { camelCaseKey: "topP", optionKey: "topP", outputKey: "top_p" },
  {
    camelCaseKey: "frequencyPenalty",
    optionKey: "frequencyPenalty",
    outputKey: "frequency_penalty",
  },
  { camelCaseKey: "presencePenalty", optionKey: "presencePenalty", outputKey: "presence_penalty" },
  { camelCaseKey: "seed", optionKey: "seed", outputKey: "seed" },
  { camelCaseKey: "parallel_tool_calls", outputKey: "parallel_tool_calls" },
  { camelCaseKey: "logprobs", outputKey: "logprobs" },
  { camelCaseKey: "topLogprobs", outputKey: "top_logprobs" },
  { camelCaseKey: "logitBias", outputKey: "logit_bias" },
  { camelCaseKey: "user", outputKey: "user" },
  { camelCaseKey: "n", outputKey: "n" },
] as const;

/**
 * @internal
 */
type AzureOpenAiChatClientClass = typeof AzureOpenAiChatClient;

/**
 * @internal
 */
export class FoundationModelsLanguageModelStrategy implements LanguageModelAPIStrategy {
  private readonly ClientClass: AzureOpenAiChatClientClass;

  constructor(ClientClass: AzureOpenAiChatClientClass) {
    this.ClientClass = ClientClass;
  }

  async doGenerate(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    try {
      const { request, warnings } = await this.buildRequest(config, settings, options);

      const client = this.createClient(config, settings.modelVersion);

      const response = await client.run(
        request,
        options.abortSignal ? { signal: options.abortSignal } : undefined,
      );

      return buildGenerateResult({
        modelId: config.modelId,
        providerName: getProviderName(config.provider),
        requestBody: request,
        response: response as SDKResponse,
        responseHeaders: normalizeHeaders(response.rawResponse.headers),
        version: VERSION,
        warnings,
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doGenerate",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:foundation-models",
      });
    }
  }

  async doStream(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    try {
      const { request, warnings } = await this.buildRequest(config, settings, options);

      const client = this.createClient(config, settings.modelVersion);

      const streamResponse = await client.stream(request, options.abortSignal);

      const idGenerator = new StreamIdGenerator();
      const responseId = idGenerator.generateResponseId();

      const transformedStream = createStreamTransformer({
        convertToAISDKError,
        idGenerator,
        includeRawChunks: options.includeRawChunks ?? false,
        modelId: config.modelId,
        options,
        providerName: getProviderName(config.provider),
        responseId,
        sdkStream: streamResponse.stream as AsyncIterable<SDKStreamChunk>,
        streamResponseGetFinishReason: () => streamResponse.getFinishReason(),
        streamResponseGetTokenUsage: () => streamResponse.getTokenUsage(),
        url: "sap-ai:foundation-models",
        version: VERSION,
        warnings,
      });

      return {
        request: {
          body: request as unknown,
        },
        stream: transformedStream,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doStream",
        requestBody: createAISDKRequestBodySummary(options),
        url: "sap-ai:foundation-models",
      });
    }
  }

  private async buildRequest(
    config: LanguageModelStrategyConfig,
    settings: SAPAIModelSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<{
    request: AzureOpenAiChatCompletionParameters;
    warnings: SharedV3Warning[];
  }> {
    const providerName = getProviderName(config.provider);
    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const warnings: SharedV3Warning[] = [];

    const fmSettings = settings as FoundationModelsModelSettings;

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders: sapOptions?.escapeTemplatePlaceholders ?? false,
      includeReasoning: sapOptions?.includeReasoning ?? fmSettings.includeReasoning ?? false,
    });

    const toolsResult = convertToolsToSAPFormat<AzureOpenAiChatCompletionTool>(options.tools);
    const tools = toolsResult.tools;
    warnings.push(...toolsResult.warnings);

    const { modelParams, warnings: paramWarnings } = buildModelParams({
      options,
      paramMappings: PARAM_MAPPINGS,
      providerModelParams: sapOptions?.modelParams as Record<string, unknown> | undefined,
      settingsModelParams: fmSettings.modelParams as Record<string, unknown> | undefined,
    });
    warnings.push(...paramWarnings);

    const toolChoice = mapToolChoice(options.toolChoice);

    const { responseFormat, warning: responseFormatWarning } = convertResponseFormat(
      options.responseFormat,
      fmSettings.responseFormat,
    );
    if (responseFormatWarning) {
      warnings.push(responseFormatWarning);
    }

    const request: AzureOpenAiChatCompletionParameters = {
      messages: messages as AzureOpenAiChatCompletionParameters["messages"],
      ...modelParams,
      ...(tools && tools.length > 0 ? { tools } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
      ...(fmSettings.dataSources &&
      Array.isArray(fmSettings.dataSources) &&
      fmSettings.dataSources.length > 0
        ? {
            data_sources:
              fmSettings.dataSources as AzureOpenAiChatCompletionParameters["data_sources"],
          }
        : {}),
    };

    return { request, warnings };
  }

  private createClient(
    config: LanguageModelStrategyConfig,
    modelVersion?: string,
  ): InstanceType<AzureOpenAiChatClientClass> {
    const modelDeployment = buildModelDeployment(config, modelVersion);
    return new this.ClientClass(modelDeployment, config.destination);
  }
}
