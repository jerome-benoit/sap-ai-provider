/** Base class for language model strategies using the Template Method pattern. */
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from "@ai-sdk/provider";
import type { ChatMessage } from "@sap-ai-sdk/orchestration";

import { parseProviderOptions } from "@ai-sdk/provider-utils";

import type { SAPAIModelSettings } from "./sap-ai-settings.js";
import type { LanguageModelAPIStrategy, LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { convertToSAPMessages } from "./convert-to-sap-messages.js";
import { convertToAISDKError, normalizeHeaders } from "./sap-ai-error.js";
import { getProviderName, sapAILanguageModelProviderOptions } from "./sap-ai-provider-options.js";
import {
  buildGenerateResult,
  buildModelParams,
  createAISDKRequestBodySummary,
  createStreamTransformer,
  mapToolChoice,
  type ParamMapping,
  type SAPToolChoice,
  type SDKResponse,
  type SDKStreamChunk,
  StreamIdGenerator,
} from "./strategy-utils.js";
import { VERSION } from "./version.js";

/**
 * Result of building common parts for a language model request.
 * @template TMessages - The message array type (e.g., `ChatMessage[]`, `AzureOpenAiChatCompletionRequestMessage[]`)
 * @template TToolChoice - The tool choice type (e.g., `SAPToolChoice`)
 * @internal
 */
export interface CommonBuildResult<TMessages extends unknown[] = unknown[], TToolChoice = unknown> {
  readonly messages: TMessages;
  readonly modelParams: Record<string, unknown>;
  readonly providerName: string;
  readonly sapOptions: Record<string, unknown> | undefined;
  readonly toolChoice: TToolChoice;
  readonly warnings: SharedV3Warning[];
}

/**
 * Stream response shape returned by executeStreamCall.
 * @internal
 */
export interface StreamCallResponse {
  readonly getFinishReason: () => null | string | undefined;
  readonly getTokenUsage: () =>
    | null
    | undefined
    | { completion_tokens?: number; prompt_tokens?: number };
  readonly stream: AsyncIterable<SDKStreamChunk>;
}

/**
 * Abstract base class for language model strategies using the Template Method pattern.
 * @template TClient - The SDK client type (e.g., AzureOpenAiChatClient, OrchestrationClient).
 * @template TRequest - The API request type (e.g., AzureOpenAiChatCompletionParameters).
 * @template TSettings - The model settings type extending SAPAIModelSettings.
 * @internal
 */
export abstract class BaseLanguageModelStrategy<
  TClient,
  TRequest,
  TSettings extends SAPAIModelSettings = SAPAIModelSettings,
> implements LanguageModelAPIStrategy<TSettings> {
  /**
   * Common parameter mappings for language model APIs.
   * @internal
   */
  static readonly COMMON_PARAM_MAPPINGS: readonly ParamMapping[] = [
    { camelCaseKey: "maxTokens", optionKey: "maxOutputTokens", outputKey: "max_tokens" },
    { camelCaseKey: "temperature", optionKey: "temperature", outputKey: "temperature" },
    { camelCaseKey: "topP", optionKey: "topP", outputKey: "top_p" },
    {
      camelCaseKey: "frequencyPenalty",
      optionKey: "frequencyPenalty",
      outputKey: "frequency_penalty",
    },
    {
      camelCaseKey: "presencePenalty",
      optionKey: "presencePenalty",
      outputKey: "presence_penalty",
    },
    { camelCaseKey: "seed", optionKey: "seed", outputKey: "seed" },
    { camelCaseKey: "parallel_tool_calls", outputKey: "parallel_tool_calls" },
  ] as const;

  async doGenerate(
    config: LanguageModelStrategyConfig,
    settings: TSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    try {
      const commonParts = await this.buildCommonParts(config, settings, options);
      const { request, warnings } = this.buildRequest(config, settings, options, commonParts);

      const client = this.createClient(config, settings, commonParts);

      const response = await this.executeApiCall(client, request, options.abortSignal ?? undefined);

      return buildGenerateResult({
        modelId: config.modelId,
        providerName: commonParts.providerName,
        requestBody: request,
        response,
        responseHeaders: normalizeHeaders(response.rawResponse.headers),
        version: VERSION,
        warnings: [...commonParts.warnings, ...warnings],
      });
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doGenerate",
        requestBody: createAISDKRequestBodySummary(options),
        url: this.getUrl(),
      });
    }
  }

  async doStream(
    config: LanguageModelStrategyConfig,
    settings: TSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    try {
      const commonParts = await this.buildCommonParts(config, settings, options);
      const { request, warnings } = this.buildRequest(config, settings, options, commonParts);

      const client = this.createClient(config, settings, commonParts);

      const streamResponse = await this.executeStreamCall(
        client,
        request,
        options.abortSignal ?? undefined,
        settings,
      );

      const idGenerator = new StreamIdGenerator();
      const responseId = idGenerator.generateResponseId();

      const streamWarnings = this.collectStreamWarnings(settings, commonParts.sapOptions);

      const transformedStream = createStreamTransformer({
        convertToAISDKError,
        idGenerator,
        includeRawChunks: options.includeRawChunks ?? false,
        modelId: config.modelId,
        options,
        providerName: commonParts.providerName,
        responseId,
        sdkStream: streamResponse.stream,
        streamResponseGetFinishReason: streamResponse.getFinishReason,
        streamResponseGetTokenUsage: streamResponse.getTokenUsage,
        url: this.getUrl(),
        version: VERSION,
        warnings: [...commonParts.warnings, ...warnings, ...streamWarnings],
      });

      return {
        request: {
          body: request,
        },
        stream: transformedStream,
      };
    } catch (error) {
      throw convertToAISDKError(error, {
        operation: "doStream",
        requestBody: createAISDKRequestBodySummary(options),
        url: this.getUrl(),
      });
    }
  }

  /**
   * Builds common parts shared between doGenerate and doStream.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param options - AI SDK call options.
   * @returns Common build result with typed messages and tool choice.
   * @internal
   */
  protected async buildCommonParts(
    config: LanguageModelStrategyConfig,
    settings: TSettings,
    options: LanguageModelV3CallOptions,
  ): Promise<CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>> {
    const providerName = getProviderName(config.provider);

    const sapOptions = await parseProviderOptions({
      provider: providerName,
      providerOptions: options.providerOptions,
      schema: sapAILanguageModelProviderOptions,
    });

    const warnings: SharedV3Warning[] = [];

    const messages = convertToSAPMessages(options.prompt, {
      escapeTemplatePlaceholders: this.getEscapeTemplatePlaceholders(sapOptions, settings),
      includeReasoning: this.getIncludeReasoning(sapOptions, settings),
    });

    const { modelParams, warnings: paramWarnings } = buildModelParams({
      options,
      paramMappings: this.getParamMappings(),
      providerModelParams: sapOptions?.modelParams as Record<string, unknown> | undefined,
      settingsModelParams: settings.modelParams as Record<string, unknown> | undefined,
    });
    warnings.push(...paramWarnings);

    const toolChoice = mapToolChoice(options.toolChoice);

    return {
      messages,
      modelParams,
      providerName,
      sapOptions,
      toolChoice,
      warnings,
    };
  }

  /**
   * Builds the API-specific request body.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param options - AI SDK call options.
   * @param commonParts - Common build result from base class.
   * @returns Request body and accumulated warnings.
   * @internal
   */
  protected abstract buildRequest(
    config: LanguageModelStrategyConfig,
    settings: TSettings,
    options: LanguageModelV3CallOptions,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): { readonly request: TRequest; readonly warnings: SharedV3Warning[] };

  /**
   * Collects stream-specific warnings.
   * Override in subclasses to add API-specific streaming warnings.
   * @param _settings - Model settings (unused in base implementation).
   * @param _sapOptions - Provider options (unused in base implementation).
   * @returns Array of warnings for streaming operations.
   * @internal
   */
  protected collectStreamWarnings(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _settings: TSettings,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sapOptions?: Record<string, unknown>,
  ): SharedV3Warning[] {
    return [];
  }

  /**
   * Creates the appropriate SDK client for this API.
   * @param config - Strategy configuration.
   * @param settings - Model settings.
   * @param commonParts - Common build result (messages, options, etc.).
   * @returns SDK client instance.
   * @internal
   */
  protected abstract createClient(
    config: LanguageModelStrategyConfig,
    settings: TSettings,
    commonParts: CommonBuildResult<ChatMessage[], SAPToolChoice | undefined>,
  ): TClient;

  /**
   * Executes the non-streaming API call.
   * @param client - SDK client instance.
   * @param request - Request body.
   * @param abortSignal - Optional abort signal.
   * @returns SDK response.
   * @internal
   */
  protected abstract executeApiCall(
    client: TClient,
    request: TRequest,
    abortSignal: AbortSignal | undefined,
  ): Promise<SDKResponse>;

  /**
   * Executes the streaming API call.
   * @param client - SDK client instance.
   * @param request - Request body.
   * @param abortSignal - Optional abort signal.
   * @param settings - Model settings for API-specific stream options.
   * @returns Stream response with accessors.
   * @internal
   */
  protected abstract executeStreamCall(
    client: TClient,
    request: TRequest,
    abortSignal: AbortSignal | undefined,
    settings: TSettings,
  ): Promise<StreamCallResponse>;

  /**
   * Returns whether to escape template placeholders for this API.
   * @param _sapOptions - Parsed provider options (unused in base implementation).
   * @param _settings - Model settings (unused in base implementation).
   * @returns false by default; Orchestration strategy overrides to return true.
   * @internal
   */
  protected getEscapeTemplatePlaceholders(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sapOptions: Record<string, unknown> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _settings: TSettings,
  ): boolean {
    return false;
  }

  /**
   * Returns whether to include reasoning in the response.
   * @param sapOptions - Parsed provider options.
   * @param settings - Model settings.
   * @returns Whether to include reasoning (checks sapOptions then settings, defaults to false).
   * @internal
   */
  protected getIncludeReasoning(
    sapOptions: Record<string, unknown> | undefined,
    settings: TSettings,
  ): boolean {
    return (
      (sapOptions?.includeReasoning as boolean | undefined) ??
      (settings as SAPAIModelSettings & { includeReasoning?: boolean }).includeReasoning ??
      false
    );
  }

  /**
   * Returns the parameter mappings specific to this API strategy.
   * @returns Array of parameter mappings.
   * @internal
   */
  protected abstract getParamMappings(): readonly ParamMapping[];

  /**
   * Returns the URL identifier for this API (used in error messages).
   * @returns URL string identifier.
   * @internal
   */
  protected abstract getUrl(): string;
}
